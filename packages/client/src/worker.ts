/**
 * The image work a mosaic does, kept off the main thread.
 *
 * Two jobs live here, both measured in tens of milliseconds and both pure pixel
 * pushing, which makes them exactly what a worker is for.
 *
 * **Stitching.** A pre-rendered cache has a fixed grid. Asked for the level a
 * 512 px pyramid wants, it answers with a 256 px image the renderer stretches,
 * and the imagery ends up a full zoom level behind the map. Fetching the four
 * children and recombining them fixes that, at about 68 ms a tile - four
 * dropped frames if it happened on the main thread.
 *
 * **Collar trimming.** A WMS asked for a tile that straddles the edge of its
 * coverage does not answer with a smaller image: it answers with the whole
 * rectangle and fills the uncovered part with flat white or black. JPEG has no
 * alpha channel, so that fill is opaque, and it lands on top of whatever the
 * map is drawing underneath. Measured along the Tuscan shoreline: **23 of 49
 * tiles** carried such a fill, 15 of them covering the tile almost completely.
 * Inland and over the Venetian lagoon, zero.
 *
 * The fill is found by flooding inwards from the tile border over near-flat
 * pixels. Connectivity is what makes this safe: asphalt, deep shadow, a white
 * roof and a snowfield are all flat, but they are surrounded by imagery, so the
 * flood never reaches them. Only a fill that touches the edge is treated as
 * one - which is the difference between this and keying every dark pixel to
 * transparent, a rule that would punch holes in every car park in Europe.
 */

/** One stitched tile, plus the size of the originals it was built from. */
export interface StitchedTile {
  data: ArrayBuffer;
  contentType: string;
  /**
   * Total bytes of the four children.
   *
   * The empty-tile test reads this rather than the re-encoded size: four blank
   * children are what actually says "no coverage here", and re-encoding changes
   * the byte count enough to defeat the threshold.
   */
  bytes: number;
}

export interface StitchRequest {
  /** URLs of the four children, in the order top-left, top-right, bottom-left, bottom-right. */
  urls: readonly string[];
  /** Edge length of the finished tile, in pixels. */
  tileSize: number;
  signal?: AbortSignal;
  /** Fetch priority for the four child requests. */
  priority?: RequestPriority;
}

/** What an inspection concluded about a tile. */
export type TileVerdict =
  /** No fill touching the border: the tile is drawn as it arrived. */
  | { verdict: "keep" }
  /** A fill was found and made transparent; `data` is the repaired PNG. */
  | { verdict: "trim"; data: ArrayBuffer; contentType: string; collar: number }
  /** The tile is essentially all fill: there is no imagery here at all. */
  | { verdict: "empty"; collar: number };

export interface InspectRequest {
  data: ArrayBuffer;
  contentType: string;
  /**
   * Share of the tile that must be border-connected fill before the tile counts
   * as having no imagery at all. Defaults to 0.9.
   */
  emptyAbove?: number;
  /**
   * Share below which a fill is ignored. Defaults to 0.02: a sliver along one
   * edge is usually a compression artefact rather than a coverage boundary, and
   * repairing it would cost a re-encode for nothing.
   */
  trimAbove?: number;
}

export interface TileWorker {
  /** Resolves to the stitched tile, or `undefined` when it could not be built. */
  stitch(request: StitchRequest): Promise<StitchedTile | undefined>;
  /**
   * Looks for a no-data fill around the border of a tile. Resolves to
   * `undefined` where pixels cannot be read at all, in which case the caller
   * falls back to its byte-size heuristic.
   */
  inspect(request: InspectRequest): Promise<TileVerdict | undefined>;
  /** True when the work happens off the main thread. */
  readonly offMainThread: boolean;
  /** Releases the worker. */
  dispose(): void;
}

/**
 * Body of the worker, and of the inline fallback.
 *
 * Written as a string so it can become a Blob URL, and evaluated in both places
 * so the two paths cannot drift apart.
 *
 * Behind a function rather than a module-level constant on purpose: a bundler
 * can then drop the whole thing from an application that only turns one
 * catalogue record into a source and never builds a mosaic.
 */
function workerBody(): string {
  return `
const QUADRANTS = [[0, 0], [1, 0], [0, 1], [1, 1]];

function isFlat(d, i) {
  const r = d[i], g = d[i + 1], b = d[i + 2];
  if (d[i + 3] < 16) return true;
  const near = (v, t) => v > t - 10 && v < t + 10;
  const uniform = Math.abs(r - g) < 6 && Math.abs(g - b) < 6 && Math.abs(r - b) < 6;
  return uniform && (near(r, 255) || near(r, 0));
}

/** Share of the tile covered by flat pixels connected to its border. */
function collarMask(data, size) {
  const seen = new Uint8Array(size * size);
  const stack = [];
  let count = 0;

  const push = (x, y) => {
    const p = y * size + x;
    if (seen[p] || !isFlat(data, p * 4)) return;
    seen[p] = 1;
    stack.push(p);
  };

  for (let i = 0; i < size; i += 1) {
    push(i, 0);
    push(i, size - 1);
    push(0, i);
    push(size - 1, i);
  }

  while (stack.length > 0) {
    const p = stack.pop();
    count += 1;
    const x = p % size;
    const y = (p / size) | 0;
    if (x > 0) push(x - 1, y);
    if (x < size - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < size - 1) push(x, y + 1);
  }

  return { seen: seen, share: count / (size * size) };
}

/** True when no border pixel is flat, which settles most tiles immediately. */
function borderIsClean(data, size) {
  for (let i = 0; i < size; i += 1) {
    if (isFlat(data, (i) * 4)) return false;
    if (isFlat(data, ((size - 1) * size + i) * 4)) return false;
    if (isFlat(data, (i * size) * 4)) return false;
    if (isFlat(data, (i * size + size - 1) * 4)) return false;
  }
  return true;
}

/** Pixels of the thumbnail the cheap pass works on. */
var PROBE_SIZE = 64;

async function inspect(request) {
  var blob = new Blob([request.data], { type: request.contentType });
  var emptyAbove = request.emptyAbove === undefined ? 0.9 : request.emptyAbove;
  var trimAbove = request.trimAbove === undefined ? 0.02 : request.trimAbove;

  // Cheap pass first. Decoding straight to a 64 px thumbnail costs a fraction
  // of the full tile - a 1 MB readback becomes 16 kB, and the flood fill runs
  // over 4096 pixels instead of 262144 - and it is ample to see a no-data fill,
  // which is a large flat region with a straight edge. Nearly every tile is
  // settled here, so the expensive path stays rare.
  var probe = await createImageBitmap(blob, {
    resizeWidth: PROBE_SIZE,
    resizeHeight: PROBE_SIZE,
    resizeQuality: "pixelated"
  });
  var probeCanvas = new OffscreenCanvas(PROBE_SIZE, PROBE_SIZE);
  var probeContext = probeCanvas.getContext("2d", { willReadFrequently: true });
  probeContext.drawImage(probe, 0, 0, PROBE_SIZE, PROBE_SIZE);
  probe.close();

  var probeData = probeContext.getImageData(0, 0, PROBE_SIZE, PROBE_SIZE).data;
  if (borderIsClean(probeData, PROBE_SIZE)) return { verdict: "keep" };

  var rough = collarMask(probeData, PROBE_SIZE);
  if (rough.share < trimAbove) return { verdict: "keep" };
  // Nothing but fill: the caller drops the tile, so there is no repair to make
  // and no reason to decode it at full size.
  if (rough.share >= emptyAbove) return { verdict: "empty", collar: rough.share };

  // A real boundary runs through this tile, so now it is worth the full pass:
  // a mask computed at 64 px would eat eight pixels of imagery along the edge.
  var bitmap = await createImageBitmap(blob);
  var size = bitmap.width;
  var canvas = new OffscreenCanvas(size, size);
  var context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);
  bitmap.close();

  var image = context.getImageData(0, 0, size, size);
  var data = image.data;
  var mask = collarMask(data, size);
  if (mask.share >= emptyAbove) return { verdict: "empty", collar: mask.share };
  if (mask.share < trimAbove) return { verdict: "keep" };

  for (var p = 0; p < mask.seen.length; p += 1) {
    if (mask.seen[p]) data[p * 4 + 3] = 0;
  }
  context.putImageData(image, 0, 0);

  var out = await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer();
  return { verdict: "trim", data: out, contentType: "image/png", collar: mask.share };
}

async function stitch(request) {
  const half = request.tileSize / 2;
  const parts = await Promise.all(request.urls.map(async (url) => {
    try {
      const response = await fetch(url, { priority: request.priority || "auto" });
      const type = response.headers.get("content-type") || "";
      if (!response.ok || type.indexOf("image/") !== 0) return null;
      return { data: await response.arrayBuffer(), contentType: type };
    } catch (error) {
      // A child that never arrives says nothing about the service. The caller
      // falls back to the single stretched tile instead.
      return null;
    }
  }));

  if (parts.some((part) => part === null)) return null;

  const canvas = new OffscreenCanvas(request.tileSize, request.tileSize);
  const context = canvas.getContext("2d");
  let bytes = 0;

  for (let i = 0; i < QUADRANTS.length; i += 1) {
    const part = parts[i];
    bytes += part.data.byteLength;
    const bitmap = await createImageBitmap(new Blob([part.data], { type: part.contentType }));
    context.drawImage(bitmap, QUADRANTS[i][0] * half, QUADRANTS[i][1] * half, half, half);
    bitmap.close();
  }

  // Keep the format the service already used: turning a PNG cache into JPEG
  // would be a lossy round trip for no gain.
  const type = parts[0].contentType === "image/png" ? "image/png" : "image/jpeg";
  const blob = await canvas.convertToBlob({ type: type, quality: 0.9 });
  return { data: await blob.arrayBuffer(), contentType: type, bytes: bytes };
}
`;
}

function workerSource(): string {
  return `${workerBody()}
self.onmessage = async (event) => {
  const message = event.data;
  try {
    if (message.op === "inspect") {
      const result = await inspect(message.request);
      const transfer = result && result.data ? [result.data] : [];
      self.postMessage({ id: message.id, result: result }, transfer);
      return;
    }
    const tile = await stitch(message.request);
    self.postMessage({ id: message.id, result: tile }, tile ? [tile.data] : []);
  } catch (error) {
    self.postMessage({ id: message.id, result: null });
  }
};
`;
}

export interface TileWorkerOptions {
  /**
   * Replacement for `fetch`, mostly for tests and server-side rendering.
   *
   * A function cannot cross a worker boundary, so supplying one keeps the work
   * inline. That is the right trade: anything passing a custom fetch is not the
   * case the worker exists to protect.
   */
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  /** Set `false` to keep the work on the calling thread. */
  worker?: boolean;
}

interface InlineScope {
  stitch(request: unknown): Promise<StitchedTile | null>;
  inspect(request: unknown): Promise<TileVerdict | null>;
}

/** True when this runtime can read pixels at all, on or off the thread. */
function canComposite(): boolean {
  return (
    typeof (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas === "function" &&
    typeof globalThis.createImageBitmap === "function"
  );
}

/** Evaluates the worker body in this thread, for runtimes without a worker. */
function inlineScope(
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response>
): InlineScope {
  // eslint-disable-next-line no-new-func
  const build = new Function(
    "fetch",
    `${workerBody()}\nreturn { stitch: stitch, inspect: inspect };`
  ) as (fetchArg: typeof fetchImpl) => InlineScope;
  return build(fetchImpl);
}

/**
 * Builds the tile worker, off the main thread where the runtime allows it.
 *
 * ```ts
 * const tiles = createTileWorker();
 * const stitched = await tiles.stitch({ urls, tileSize: 512 });
 * const verdict = await tiles.inspect({ data, contentType: "image/jpeg" });
 * ```
 */
export function createTileWorker(options: TileWorkerOptions = {}): TileWorker {
  const scope = globalThis as typeof globalThis & { Worker?: typeof Worker };
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  if (!canComposite()) {
    return {
      offMainThread: false,
      stitch: async () => undefined,
      inspect: async () => undefined,
      dispose: () => undefined
    };
  }

  const inline = inlineScope(fetchImpl);
  // Both paths answer `undefined` rather than throwing: a tile that could not
  // be examined falls back to the caller's byte-size heuristic, and a tile that
  // could not be stitched falls back to the single stretched one. Neither is a
  // reason to fail the tile.
  const inlineWorker: TileWorker = {
    offMainThread: false,
    async stitch(request) {
      try {
        return (await inline.stitch(request)) ?? undefined;
      } catch {
        return undefined;
      }
    },
    async inspect(request) {
      try {
        return (await inline.inspect(request)) ?? undefined;
      } catch {
        return undefined;
      }
    },
    dispose: () => undefined
  };

  // A custom fetch cannot be sent to a worker, and Node's `Worker` is not the
  // DOM one - neither case is what the worker is here for.
  const wantsWorker =
    options.worker !== false &&
    options.fetchImpl === undefined &&
    (globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node ===
      undefined;

  let worker: Worker | undefined;
  if (wantsWorker && typeof scope.Worker === "function" && typeof URL.createObjectURL === "function") {
    try {
      const url = URL.createObjectURL(new Blob([workerSource()], { type: "text/javascript" }));
      worker = new scope.Worker(url);
      URL.revokeObjectURL(url);
    } catch {
      // A strict `worker-src` policy, most likely.
      worker = undefined;
    }
  }

  if (!worker) return inlineWorker;

  const pending = new Map<number, (result: unknown) => void>();
  let nextId = 0;
  let broken = false;

  worker.onmessage = (event: MessageEvent<{ id: number; result: unknown }>) => {
    const resolve = pending.get(event.data.id);
    if (!resolve) return;
    pending.delete(event.data.id);
    resolve(event.data.result);
  };

  worker.onerror = () => {
    // Whatever went wrong, nothing hangs: every waiting caller falls back, and
    // later work runs inline.
    broken = true;
    for (const resolve of pending.values()) resolve(null);
    pending.clear();
  };

  const send = <T>(op: "stitch" | "inspect", request: unknown, signal?: AbortSignal): Promise<T | undefined> => {
    const id = nextId++;
    return new Promise<T | undefined>((resolve) => {
      const settle = (result: unknown) => {
        signal?.removeEventListener("abort", onAbort);
        resolve((result as T | null) ?? undefined);
      };
      function onAbort(): void {
        pending.delete(id);
        settle(null);
      }
      pending.set(id, settle);
      signal?.addEventListener("abort", onAbort, { once: true });
      worker?.postMessage({ id, op, request });
    });
  };

  return {
    offMainThread: true,
    stitch(request) {
      if (broken) return inlineWorker.stitch(request);
      return send<StitchedTile>("stitch", {
        urls: [...request.urls],
        tileSize: request.tileSize,
        priority: request.priority
      }, request.signal);
    },
    inspect(request) {
      if (broken) return inlineWorker.inspect(request);
      // The buffer is copied rather than transferred: the caller still needs it
      // if the verdict comes back `keep`.
      return send<TileVerdict>("inspect", {
        data: request.data.slice(0),
        contentType: request.contentType,
        emptyAbove: request.emptyAbove,
        trimAbove: request.trimAbove
      });
    },
    dispose() {
      worker?.terminate();
      worker = undefined;
      pending.clear();
    }
  };
}

/**
 * Recombining a 256 px tile cache into the 512 px tile the mosaic draws.
 *
 * A pre-rendered cache has a fixed grid. Asked for the level a 512 px pyramid
 * wants, it answers with a 256 px image the renderer then stretches, and the
 * imagery ends up a full zoom level behind the map. Fetching the four children
 * and stitching them fixes that - but the work is not free: four decodes, a
 * canvas composite and a re-encode measure about **68 ms per tile**, which at
 * 60 fps is four dropped frames. A viewport's worth of them is half a second
 * of stutter in the middle of a pan.
 *
 * So it happens in a worker. The main thread only computes the four URLs, which
 * costs microseconds; the fetching, decoding, compositing and encoding all
 * happen off it, and the finished tile comes back as a transferred buffer.
 *
 * The worker is built from a Blob URL rather than a separate file, so the
 * package stays a plain dependency-free import with no bundler configuration
 * and no asset to host. Where that is not possible - a strict `worker-src`
 * policy, a runtime without `Worker` or `OffscreenCanvas` - the same work runs
 * inline instead, and the caller sees no difference beyond the frame cost.
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

export interface Stitcher {
  /** Resolves to the stitched tile, or `undefined` when it could not be built. */
  stitch(request: StitchRequest): Promise<StitchedTile | undefined>;
  /** True when the work happens off the main thread. */
  readonly offMainThread: boolean;
  /** Releases the worker. */
  dispose(): void;
}

/**
 * Source of the worker.
 *
 * Written as a string so it can be turned into a Blob URL. It is deliberately
 * small and dependency-free: fetch four images, draw them into one canvas,
 * encode, transfer the result back.
 */
const WORKER_SOURCE = `
self.onmessage = async (event) => {
  const { id, urls, tileSize, priority } = event.data;
  const half = tileSize / 2;
  const quadrants = [[0, 0], [1, 0], [0, 1], [1, 1]];

  try {
    const parts = await Promise.all(urls.map(async (url) => {
      try {
        const response = await fetch(url, { priority: priority || "auto" });
        const type = response.headers.get("content-type") || "";
        if (!response.ok || type.indexOf("image/") !== 0) return null;
        return { data: await response.arrayBuffer(), contentType: type };
      } catch (error) {
        // A child that never arrives says nothing about the service. The
        // caller falls back to the single stretched tile instead.
        return null;
      }
    }));

    if (parts.some((part) => part === null)) {
      self.postMessage({ id, tile: null });
      return;
    }

    const canvas = new OffscreenCanvas(tileSize, tileSize);
    const context = canvas.getContext("2d");
    let bytes = 0;

    for (let i = 0; i < quadrants.length; i += 1) {
      const part = parts[i];
      bytes += part.data.byteLength;
      const bitmap = await createImageBitmap(new Blob([part.data], { type: part.contentType }));
      context.drawImage(bitmap, quadrants[i][0] * half, quadrants[i][1] * half, half, half);
      bitmap.close();
    }

    const type = parts[0].contentType === "image/png" ? "image/png" : "image/jpeg";
    const blob = await canvas.convertToBlob({ type: type, quality: 0.9 });
    const data = await blob.arrayBuffer();
    self.postMessage({ id, tile: { data: data, contentType: type, bytes: bytes } }, [data]);
  } catch (error) {
    self.postMessage({ id, tile: null });
  }
};
`;

/** True when this runtime can composite images at all, on or off the thread. */
function canComposite(scope: typeof globalThis): boolean {
  return (
    typeof (scope as { OffscreenCanvas?: unknown }).OffscreenCanvas === "function" &&
    typeof scope.createImageBitmap === "function"
  );
}

export interface StitcherOptions {
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

/** Does the work inline, for runtimes where a worker is not available. */
async function stitchInline(
  request: StitchRequest,
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response>
): Promise<StitchedTile | undefined> {
  const scope = globalThis as typeof globalThis & { OffscreenCanvas?: typeof OffscreenCanvas };
  if (!scope.OffscreenCanvas) return undefined;

  const half = request.tileSize / 2;
  const quadrants: readonly [number, number][] = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1]
  ];

  const parts = await Promise.all(
    request.urls.map(async (url) => {
      try {
        const response = await fetchImpl(url, {
          signal: request.signal,
          priority: request.priority
        } as RequestInit);
        const contentType = response.headers.get("content-type") ?? "";
        if (!response.ok || !contentType.startsWith("image/")) return undefined;
        return { data: await response.arrayBuffer(), contentType };
      } catch {
        return undefined;
      }
    })
  );
  if (parts.some((part) => part === undefined)) return undefined;

  const canvas = new scope.OffscreenCanvas(request.tileSize, request.tileSize);
  const context = canvas.getContext("2d");
  if (!context) return undefined;

  let bytes = 0;
  for (const [index, [dx, dy]] of quadrants.entries()) {
    const part = parts[index] as { data: ArrayBuffer; contentType: string };
    bytes += part.data.byteLength;
    const bitmap = await createImageBitmap(new Blob([part.data], { type: part.contentType }));
    context.drawImage(bitmap, dx * half, dy * half, half, half);
    bitmap.close();
  }

  const contentType =
    (parts[0] as { contentType: string }).contentType === "image/png" ? "image/png" : "image/jpeg";
  const blob = await canvas.convertToBlob({ type: contentType, quality: 0.9 });
  return { data: await blob.arrayBuffer(), contentType, bytes };
}

/**
 * Builds a stitcher, off the main thread where the runtime allows it.
 *
 * ```ts
 * const stitcher = createStitcher();
 * const tile = await stitcher.stitch({ urls, tileSize: 512 });
 * ```
 */
export function createStitcher(options: StitcherOptions = {}): Stitcher {
  const scope = globalThis as typeof globalThis & { Worker?: typeof Worker };
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const inline = (request: StitchRequest) => stitchInline(request, fetchImpl);

  if (!canComposite(globalThis)) {
    return {
      offMainThread: false,
      stitch: async () => undefined,
      dispose: () => undefined
    };
  }

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
      const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
      worker = new scope.Worker(url);
      // The worker holds its own reference to the source once constructed.
      URL.revokeObjectURL(url);
    } catch {
      // A strict `worker-src` policy, most likely. Fall back to inline work.
      worker = undefined;
    }
  }

  if (!worker) {
    return {
      offMainThread: false,
      stitch: inline,
      dispose: () => undefined
    };
  }

  const pending = new Map<number, (tile: StitchedTile | undefined) => void>();
  let nextId = 0;
  let broken = false;

  worker.onmessage = (event: MessageEvent<{ id: number; tile: StitchedTile | null }>) => {
    const resolve = pending.get(event.data.id);
    if (!resolve) return;
    pending.delete(event.data.id);
    resolve(event.data.tile ?? undefined);
  };

  worker.onerror = () => {
    // Whatever went wrong, every waiting tile falls back to the single-tile
    // path rather than hanging, and later tiles are stitched inline.
    broken = true;
    for (const resolve of pending.values()) resolve(undefined);
    pending.clear();
  };

  return {
    offMainThread: true,
    stitch(request) {
      if (broken) return inline(request);

      const id = nextId++;
      return new Promise<StitchedTile | undefined>((resolve) => {
        const settle = (tile: StitchedTile | undefined) => {
          request.signal?.removeEventListener("abort", onAbort);
          resolve(tile);
        };
        function onAbort(): void {
          pending.delete(id);
          settle(undefined);
        }

        pending.set(id, settle);
        request.signal?.addEventListener("abort", onAbort, { once: true });
        worker?.postMessage({
          id,
          urls: [...request.urls],
          tileSize: request.tileSize,
          priority: request.priority
        });
      });
    },
    dispose() {
      worker?.terminate();
      worker = undefined;
      pending.clear();
    }
  };
}

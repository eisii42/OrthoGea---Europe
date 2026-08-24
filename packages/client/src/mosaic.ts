import {
  EndpointUnavailableError,
  UnsupportedServiceError,
  bboxAreaSqKm,
  bboxContainsPoint,
  tileToBBox,
  type GeoBoundingBox,
  type OrthoGeaLayer
} from "@orthogea/core";
import { formatAttributions, type AttributionOptions } from "./attribution.js";
import { createTileUrlBuilder, type TileUrlBuilder, type TileUrlBuilderOptions } from "./tiles.js";
import type { RasterLayerSpecification, RasterSourceSpecification } from "./types.js";

/** URL scheme of the seamless imagery mosaic. */
export const MOSAIC_PROTOCOL = "orthogea-mosaic";

/**
 * Zoom from which local orthophotos are requested.
 *
 * Below it the whole of Europe is drawn from one background - Copernicus VHR
 * 2021 at about 2 m - which keeps the map fast, consistent and free of the
 * patchwork a dozen regional services would produce. Only when the reader zooms
 * in past this level, where 2 m starts to show, do the orthophotos take over.
 */
export const DEFAULT_ORTHOPHOTO_FROM_ZOOM = 15;

/**
 * Deepest zoom the mosaic requests tiles for.
 *
 * A 20 cm orthophoto has no more detail past this point, so MapLibre upscales
 * the tiles it already holds instead of asking the server again - zooming stays
 * instant and the network stays quiet.
 */
export const DEFAULT_MOSAIC_MAX_ZOOM = 19;

/** 1x1 fully transparent PNG, base64. */
const TRANSPARENT_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/** Placeholder reported when a tile is a hole rather than imagery. */
const EMPTY_LAYER = {
  id: "orthogea:empty",
  title: "No coverage",
  attribution: "",
  tags: [] as string[]
} as unknown as OrthoGeaLayer;

/** Categories the mosaic can draw from. */
const IMAGERY_CATEGORIES = new Set(["orthophoto", "satellite"]);

export interface MosaicOptions extends TileUrlBuilderOptions {
  /** Identifier used in the tile URL, so several mosaics can coexist. */
  id?: string;
  /** Candidate layers; anything that is not raster imagery is ignored. */
  layers: readonly OrthoGeaLayer[];
  /**
   * Global fallback drawn where nothing better exists and below
   * {@link MosaicOptions.orthophotoFromZoom}. Accepts a layer or its id.
   */
  fallback?: OrthoGeaLayer | string;
  orthophotoFromZoom?: number;
  /** Layers carrying any of these tags are skipped. Defaults to `["alternative"]`. */
  excludeTags?: readonly string[];
  /** Include layers whose status is not `active`. Defaults to `false`. */
  includeInactive?: boolean;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  /** Abort a tile request after this many milliseconds. Defaults to 12000. */
  timeoutMs?: number;
  /** How long a failing layer is skipped, in milliseconds. Defaults to 60000. */
  failureTtlMs?: number;
  /**
   * Tiles smaller than this are treated as empty and the next source is tried.
   *
   * A WMS asked for a tile outside its real footprint answers with a blank
   * image rather than an error - a few hundred bytes of uniform colour. The
   * last source in the chain is always accepted, so a genuinely uniform tile
   * (open sea, snow) still renders. Defaults to 9000 bytes for 512 px tiles and
   * 2500 for 256 px ones; set 0 to disable.
   */
  minTileBytes?: number;
  /**
   * Cache tiles in the browser Cache Storage, so a revisited area draws
   * instantly and keeps working on a poor connection. Ignored where the API is
   * unavailable (Node, insecure origins). Defaults to `true` in the browser.
   */
  cacheName?: string | false;
  /**
   * Maximum number of tiles kept in Cache Storage.
   *
   * Cache Storage is persistent and has no eviction of its own, so a long
   * session over a large area would grow it without bound until the browser
   * evicts the whole origin at once. The oldest entries are trimmed instead,
   * which keeps the working set - the area actually being read - resident.
   * Defaults to 1500 tiles, roughly 60 MB of 512 px JPEG. Set 0 to disable.
   */
  cacheLimit?: number;
  /**
   * Answer with a transparent tile instead of failing when nothing covers the
   * area. Lets a mosaic without a fallback sit on top of a base layer: the base
   * shows through the holes and the console stays quiet. Defaults to `true`
   * when the mosaic has no fallback.
   */
  transparentWhenUncovered?: boolean;
  /** Called whenever a tile is served, so a UI can show the live source. */
  onTile?: (info: { layer: OrthoGeaLayer; x: number; y: number; z: number }) => void;
}

export interface MosaicSelection {
  /** Candidates for the tile, best first, fallback last. */
  layers: OrthoGeaLayer[];
  /** True when only the global fallback applies, because of the zoom. */
  satelliteOnly: boolean;
}

/** One tile currently being loaded, shared between everyone who wants it. */
interface InFlightTile {
  promise: Promise<MosaicTile>;
  controller: AbortController;
  /** Callers still waiting; the request is dropped when this reaches zero. */
  refs: number;
}

/** A tile served by the mosaic, with the source it came from. */
export interface MosaicTile {
  layer: OrthoGeaLayer;
  data: ArrayBuffer;
  contentType: string;
  url: string;
}

/**
 * Ranks imagery for a tile: **locality first**.
 *
 * Coverage is modelled as a rectangle, and a regional rectangle always spills
 * over the border - the French national extent reaches into Liguria, the
 * Veneto one into Trentino. Sorting by extent before resolution keeps the
 * authority closest to the ground on top, which is what a reader expects;
 * resolution and vintage only break ties between comparable extents.
 */
/** Tile services answer from a cache; a WMS renders every request. */
function isTiled(layer: OrthoGeaLayer): boolean {
  return layer.service.type === "WMTS" || layer.service.type === "XYZ";
}

function compareImagery(a: OrthoGeaLayer, b: OrthoGeaLayer): number {
  const areaA = bboxAreaSqKm(a.bbox);
  const areaB = bboxAreaSqKm(b.bbox);
  // 5 % tolerance, so two flights over the same region rank by quality.
  if (Math.abs(areaA - areaB) > Math.min(areaA, areaB) * 0.05) return areaA - areaB;

  // Same ground, so speed decides: a pre-rendered tile beats a rendered one.
  if (isTiled(a) !== isTiled(b)) return isTiled(a) ? -1 : 1;

  const resolutionA = a.resolutionMeters ?? Number.POSITIVE_INFINITY;
  const resolutionB = b.resolutionMeters ?? Number.POSITIVE_INFINITY;
  if (resolutionA !== resolutionB) return resolutionA - resolutionB;

  const endA = a.temporal?.end ?? a.temporal?.start ?? "";
  const endB = b.temporal?.end ?? b.temporal?.start ?? "";
  if (endA !== endB) return endB.localeCompare(endA);

  return a.id.localeCompare(b.id);
}

/**
 * A seamless imagery mosaic: one virtual raster layer that picks, for every
 * tile, the best official source covering it.
 *
 * This is what makes an open-data map behave like a commercial satellite
 * basemap: pan across a border and the tiles switch from one regional
 * orthophoto to the next, zoom out and everything becomes the Sentinel-2
 * mosaic, with no gap and no visible loss of quality.
 */
export class Mosaic {
  readonly id: string;
  readonly orthophotoFromZoom: number;
  readonly fallback?: OrthoGeaLayer;
  /**
   * Pixel size of the tiles the mosaic asks services for.
   *
   * 512 px covers four times the ground per request. It also shifts the tile
   * pyramid by one level - MapLibre asks a 512 px source for zoom z-1 - which
   * {@link Mosaic.select} compensates for, so `orthophotoFromZoom` always means
   * the zoom the user sees.
   */
  readonly tileSize: 256 | 512;

  private readonly candidates: OrthoGeaLayer[];
  private readonly builders = new Map<string, TileUrlBuilder>();
  private readonly failures = new Map<string, number>();
  private readonly used = new Map<string, number>();
  /**
   * Areas where a layer answered with a blank image, keyed by a 4x4 tile block.
   * Coverage gaps are contiguous, so one empty answer is enough to stop asking
   * the same service for the whole neighbourhood - the single biggest saving
   * on a slow connection.
   */
  private readonly blankBlocks = new Map<string, Set<string>>();
  /**
   * Areas a layer has actually drawn, keyed at a fixed reference level so the
   * knowledge survives zooming. Once a service is known to cover the ground
   * here, its tiles are trusted even when they are small: a uniform roof or a
   * ploughed field at zoom 19 compresses to almost nothing, and dropping back
   * to the European base at that point is exactly what a reader notices.
   */
  private readonly confirmed = new Map<string, Set<string>>();
  /**
   * Tiles being loaded right now, keyed by `z/x/y`.
   *
   * A tile is often wanted twice at once - the renderer asks for it while the
   * idle prefetcher is already downloading it, or a pan brings back a tile
   * whose request is still open. Sharing the work halves the traffic on a slow
   * link; the request is only aborted once every caller has walked away.
   */
  private readonly inFlight = new Map<string, InFlightTile>();
  private tileCache?: Promise<Cache | undefined>;
  private cacheWrites = 0;
  private trimming?: Promise<void>;
  private readonly options: MosaicOptions;

  constructor(options: MosaicOptions) {
    this.options = options;
    this.id = options.id ?? "default";
    this.orthophotoFromZoom = options.orthophotoFromZoom ?? DEFAULT_ORTHOPHOTO_FROM_ZOOM;
    this.tileSize = options.tileSize ?? 512;

    const excluded = new Set(options.excludeTags ?? ["alternative"]);
    this.candidates = options.layers
      .filter((layer) => IMAGERY_CATEGORIES.has(layer.category))
      .filter((layer) => layer.service.type !== "WFS" && layer.service.type !== "COG")
      .filter((layer) => options.includeInactive || layer.status === "active")
      .filter((layer) => !layer.tags.some((tag) => excluded.has(tag)))
      .sort(compareImagery);

    this.fallback =
      typeof options.fallback === "string"
        ? options.layers.find((layer) => layer.id === options.fallback)
        : options.fallback;
  }

  /** Map zoom a tile of this pyramid is displayed at. */
  private mapZoom(z: number): number {
    return this.tileSize === 512 ? z + 1 : z;
  }

  /** Imagery available for a tile, best first. */
  select(x: number, y: number, z: number): MosaicSelection {
    if (this.mapZoom(z) < this.orthophotoFromZoom) {
      return { layers: this.fallback ? [this.fallback] : [], satelliteOnly: true };
    }

    const bbox = tileToBBox(x, y, z);
    const [lng, lat] = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];

    const covering = this.candidates.filter(
      (layer) =>
        layer.id !== this.fallback?.id &&
        this.mapZoom(z) >= layer.minZoom &&
        bboxContainsPoint(layer.bbox, lng, lat)
    );

    // Rectangles overlap across borders: North Rhine-Westphalia's reaches
    // Venlo, Bavaria's reaches Salzburg. Once the most local source is known,
    // imagery from another country goes to the back of the chain rather than in
    // front of the authority that actually surveys the ground. It stays in the
    // chain, though: dropping it outright would leave a hole wherever the
    // country's own service happens to answer blank.
    const local = covering.find((layer) => layer.country !== "EU");
    const filtered = local
      ? [
          ...covering.filter((layer) => layer.country === local.country || layer.country === "EU"),
          ...covering.filter((layer) => layer.country !== local.country && layer.country !== "EU")
        ]
      : covering;

    // The fallback is always last, and is never filtered out by its own zoom
    // range: it is what guarantees that every tile of the world has an image.
    if (this.fallback) filtered.push(this.fallback);
    return { layers: filtered, satelliteOnly: filtered.length <= 1 };
  }

  /** The layer that would actually be drawn, ignoring transient failures. */
  bestFor(x: number, y: number, z: number): OrthoGeaLayer | undefined {
    return this.select(x, y, z).layers[0];
  }

  /**
   * True when a service publishes a tile grid finer than the one the mosaic
   * draws on, so its tiles have to be stitched rather than stretched.
   */
  private canStitch(layer: OrthoGeaLayer): boolean {
    if (!isTiled(layer)) return false;
    const native = (layer.service as { options: { tileSize: number } }).options.tileSize;
    return native > 0 && this.tileSize / native === 2;
  }

  /**
   * Fetches one mosaic tile as the four native tiles below it.
   *
   * A pre-rendered cache has a fixed grid. Asked for the level a 512 px pyramid
   * wants, it answers with a 256 px image that the renderer then stretches, and
   * the imagery ends up a full zoom level behind the map - the reason
   * basemap.at, IGN and Veneto looked soft next to the WMS services. Their four
   * children cost four CDN hits, which is still faster than one WMS render, and
   * they stitch into a tile at the resolution the reader is actually at.
   */
  private async fetchStitched(
    layer: OrthoGeaLayer,
    x: number,
    y: number,
    z: number,
    signal: AbortSignal
  ): Promise<{ data: ArrayBuffer; contentType: string; bytes: number } | undefined> {
    const canvasCtor = (globalThis as { OffscreenCanvas?: typeof OffscreenCanvas }).OffscreenCanvas;
    if (!canvasCtor || typeof createImageBitmap !== "function") return undefined;

    const fetchImpl = this.options.fetchImpl ?? globalThis.fetch;
    const quadrants: readonly [number, number][] = [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1]
    ];

    const parts = await Promise.all(
      quadrants.map(async ([dx, dy]) => {
        const response = await fetchImpl(this.tileUrl(layer, x * 2 + dx, y * 2 + dy, z + 1), {
          signal
        });
        const contentType = response.headers.get("content-type") ?? "";
        if (!response.ok || !contentType.startsWith("image/")) return undefined;
        return response.arrayBuffer();
      })
    );
    // One missing child and the tile would have a hole: fall back to the
    // stretched single tile, which at least covers the whole ground.
    if (parts.some((part) => part === undefined)) return undefined;

    const canvas = new canvasCtor(this.tileSize, this.tileSize);
    const context = canvas.getContext("2d");
    if (!context) return undefined;

    const half = this.tileSize / 2;
    for (const [index, [dx, dy]] of quadrants.entries()) {
      const bitmap = await createImageBitmap(new Blob([parts[index] as ArrayBuffer]));
      context.drawImage(bitmap, dx * half, dy * half, half, half);
      bitmap.close();
    }

    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
    return {
      data: await blob.arrayBuffer(),
      contentType: "image/jpeg",
      // The blank test reads the originals: re-encoding changes the size, and
      // four empty children are what actually says "no coverage here".
      bytes: parts.reduce((total, part) => total + (part as ArrayBuffer).byteLength, 0)
    };
  }

  /** Request URL of a tile for one specific layer. */
  tileUrl(layer: OrthoGeaLayer, x: number, y: number, z: number): string {
    let builder = this.builders.get(layer.id);
    if (!builder) {
      // The request size must match the tile the renderer expects, or a 256 px
      // image would be stretched over a 512 px tile and halve the detail.
      builder = createTileUrlBuilder(layer, { ...this.options, tileSize: this.tileSize });
      this.builders.set(layer.id, builder);
    }
    return builder(x, y, z);
  }

  /** Attribution of every source the mosaic may draw from. */
  attribution(options: AttributionOptions = {}): string {
    const layers = this.fallback ? [...this.candidates, this.fallback] : [...this.candidates];
    return formatAttributions(layers, options);
  }

  /**
   * Sources actually drawn recently, most recent first.
   *
   * A mosaic can draw from dozens of providers, but only a handful are on
   * screen at any moment. Crediting those - and only those - keeps the
   * attribution line readable while still honouring the licences.
   */
  activeSources(withinMs = 120_000): OrthoGeaLayer[] {
    const now = Date.now();
    const byId = new Map(this.candidates.map((layer) => [layer.id, layer]));
    if (this.fallback) byId.set(this.fallback.id, this.fallback);

    return [...this.used.entries()]
      .filter(([, usedAt]) => now - usedAt <= withinMs)
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => byId.get(id))
      .filter((layer): layer is OrthoGeaLayer => layer !== undefined);
  }

  /**
   * Attribution of the sources currently on screen.
   *
   * `withinMs` decides how long a provider keeps being credited after its last
   * tile: short enough and the line follows the view, long enough and it does
   * not flicker while tiles arrive.
   */
  activeAttribution(options: AttributionOptions = {}, withinMs = 120_000): string {
    const active = this.activeSources(withinMs);
    return formatAttributions(active.length > 0 ? active : this.fallback ? [this.fallback] : [], options);
  }

  /** Layers the mosaic can draw, in ranking order. */
  get sources(): readonly OrthoGeaLayer[] {
    return this.candidates;
  }

  /** Extent covered by the mosaic, the fallback included. */
  get bounds(): GeoBoundingBox | undefined {
    return this.fallback?.bbox;
  }

  private isFailing(layerId: string): boolean {
    const until = this.failures.get(layerId);
    if (until === undefined) return false;
    if (Date.now() > until) {
      this.failures.delete(layerId);
      return false;
    }
    return true;
  }

  private markFailure(layerId: string): void {
    this.failures.set(layerId, Date.now() + (this.options.failureTtlMs ?? 60_000));
  }

  /** 4x4 tile block a tile belongs to, used to remember coverage gaps. */
  private static blockKey(x: number, y: number, z: number): string {
    return `${z}/${x >> 2}/${y >> 2}`;
  }

  /** Zoom-independent area key, so coverage learnt at one zoom holds at another. */
  private static areaKey(x: number, y: number, z: number): string {
    const reference = 12;
    if (z <= reference) return `${x << (reference - z)}/${y << (reference - z)}`;
    const shift = z - reference;
    return `${x >> shift}/${y >> shift}`;
  }

  private isConfirmedHere(layerId: string, x: number, y: number, z: number): boolean {
    return this.confirmed.get(layerId)?.has(Mosaic.areaKey(x, y, z)) ?? false;
  }

  private confirm(layerId: string, x: number, y: number, z: number): void {
    const areas = this.confirmed.get(layerId) ?? new Set<string>();
    areas.add(Mosaic.areaKey(x, y, z));
    this.confirmed.set(layerId, areas);
  }

  private isBlankHere(layerId: string, x: number, y: number, z: number): boolean {
    return this.blankBlocks.get(layerId)?.has(Mosaic.blockKey(x, y, z)) ?? false;
  }

  private markBlank(layerId: string, x: number, y: number, z: number): void {
    const blocks = this.blankBlocks.get(layerId) ?? new Set<string>();
    blocks.add(Mosaic.blockKey(x, y, z));
    this.blankBlocks.set(layerId, blocks);
  }

  /** Cache Storage handle, resolved once and reused. */
  private async cache(): Promise<Cache | undefined> {
    if (this.options.cacheName === false) return undefined;
    this.tileCache ??= (async () => {
      try {
        const storage = (globalThis as { caches?: CacheStorage }).caches;
        const name = typeof this.options.cacheName === "string" ? this.options.cacheName : "orthogea-tiles";
        return await storage?.open(name);
      } catch {
        return undefined;
      }
    })();
    return this.tileCache;
  }

  /**
   * Keeps Cache Storage bounded, oldest first.
   *
   * Cache Storage never evicts on its own: left alone it grows until the
   * browser drops the whole origin, losing the tiles being read right now
   * along with the rest. Trimming in batches, well away from the tile that
   * triggered it, keeps the working set resident and the cost off the hot path.
   */
  private trimCache(cache: Cache): void {
    const limit = this.options.cacheLimit ?? 1500;
    if (limit <= 0) return;
    this.cacheWrites += 1;
    if (this.cacheWrites < 100 || this.trimming) return;
    this.cacheWrites = 0;

    this.trimming = (async () => {
      try {
        const keys = await cache.keys();
        // `keys()` answers in insertion order, so the head is the oldest.
        for (const request of keys.slice(0, keys.length - limit)) {
          await cache.delete(request);
        }
      } catch {
        // A full or unavailable cache is not worth failing a tile over.
      } finally {
        this.trimming = undefined;
      }
    })();
  }

  /**
   * Fetches a tile, walking down the candidate list until one answers with an
   * image. A layer that fails is skipped for a while, so one broken national
   * service cannot slow the whole map down.
   *
   * Concurrent requests for the same tile share one download.
   */
  async fetchTile(x: number, y: number, z: number, signal?: AbortSignal): Promise<MosaicTile> {
    const tile = await this.share(x, y, z, signal);
    if (tile.layer !== EMPTY_LAYER) {
      this.used.set(tile.layer.id, Date.now());
      this.options.onTile?.({ layer: tile.layer, x, y, z });
    }
    return tile;
  }

  /**
   * Downloads a tile into the cache without drawing it and without crediting
   * its provider, so a viewport can be warmed ahead of a pan. Failures are
   * deliberately silent: a prefetch that does not arrive costs nothing.
   */
  prefetch(x: number, y: number, z: number): void {
    if (this.inFlight.has(`${z}/${x}/${y}`)) return;
    void this.share(x, y, z).catch(() => undefined);
  }

  /**
   * Warms the ring of tiles around one tile - the ground a reader is about to
   * pan into. Call it when the map goes idle, never while it is moving.
   */
  prefetchAround(x: number, y: number, z: number, radius = 1): void {
    const span = 2 ** z;
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        if (dx === 0 && dy === 0) continue;
        const ty = y + dy;
        if (ty < 0 || ty >= span) continue;
        this.prefetch(((x + dx) % span + span) % span, ty, z);
      }
    }
  }

  /** Joins the download of a tile, starting it if nobody else has. */
  private share(x: number, y: number, z: number, signal?: AbortSignal): Promise<MosaicTile> {
    const key = `${z}/${x}/${y}`;
    let entry = this.inFlight.get(key);
    if (!entry) {
      const controller = new AbortController();
      const created: InFlightTile = {
        controller,
        refs: 0,
        promise: undefined as unknown as Promise<MosaicTile>
      };
      created.promise = this.loadTile(x, y, z, controller.signal);
      void created.promise.catch(() => undefined).then(() => {
        if (this.inFlight.get(key) === created) this.inFlight.delete(key);
      });
      this.inFlight.set(key, created);
      entry = created;
    }

    const joined = entry;
    joined.refs += 1;
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      joined.refs -= 1;
      // Nobody is waiting any more: dropping the request frees the connection
      // for the tiles that are still on screen.
      if (joined.refs <= 0) joined.controller.abort();
    };

    return new Promise<MosaicTile>((resolve, reject) => {
      const onAbort = (): void => {
        release();
        reject(new DOMException(`Tile ${key} aborted`, "AbortError"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      joined.promise.then(
        (tile) => {
          signal?.removeEventListener("abort", onAbort);
          release();
          resolve(tile);
        },
        (error: Error) => {
          signal?.removeEventListener("abort", onAbort);
          release();
          reject(error);
        }
      );
      if (signal?.aborted) onAbort();
    });
  }

  private async loadTile(
    x: number,
    y: number,
    z: number,
    signal?: AbortSignal
  ): Promise<MosaicTile> {
    const { layers } = this.select(x, y, z);
    if (layers.length === 0) {
      if (this.transparentWhenUncovered) return this.emptyTile();
      throw new UnsupportedServiceError(
        `No imagery covers tile ${z}/${x}/${y} and the mosaic has no fallback layer`
      );
    }

    const fetchImpl = this.options.fetchImpl ?? globalThis.fetch;
    const timeoutMs = this.options.timeoutMs ?? 12_000;
    let lastError: Error | undefined;

    const cache = await this.cache();

    // The last candidate is normally taken as it comes, so that a genuinely
    // uniform tile - open sea, a snowfield - still renders instead of leaving a
    // hole. That only makes sense when a hole is not an option: a mosaic that
    // can draw one must never paint a neighbour's no-data fill over the map.
    // Coverage is a rectangle, and rectangles cross borders: Austria's reaches
    // Munich, France's reaches Frankfurt, and both services answer there with a
    // blank image rather than an error.
    const lenient = !this.transparentWhenUncovered;

    for (const layer of layers) {
      const isLast = lenient && layer === layers[layers.length - 1];
      if (!isLast && this.isFailing(layer.id)) continue;
      // Coverage gaps are contiguous: if this service was empty next door, do
      // not spend a round trip finding out again.
      if (!isLast && this.isBlankHere(layer.id, x, y, z)) continue;

      const url = this.tileUrl(layer, x, y, z);

      const cached = await cache?.match(url).catch(() => undefined);
      if (cached) {
        const data = await cached.arrayBuffer();
        return {
          layer,
          data,
          contentType: cached.headers.get("content-type") ?? "image/jpeg",
          url
        };
      }

      if (signal?.aborted) throw new DOMException(`Tile ${z}/${x}/${y} aborted`, "AbortError");

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort);

      try {
        const stitched = this.canStitch(layer)
          ? await this.fetchStitched(layer, x, y, z, controller.signal)
          : undefined;

        let data: ArrayBuffer;
        let contentType: string;
        let weight: number;

        if (stitched) {
          ({ data, contentType } = stitched);
          weight = stitched.bytes;
        } else {
          const response = await fetchImpl(url, { signal: controller.signal });
          contentType = response.headers.get("content-type") ?? "";
          // A tile cache answers 404 outside its own footprint. That is a
          // coverage gap, not a broken service: blacklisting basemap.at
          // because it has nothing over Munich would take Austria with it.
          if (response.status === 404 || response.status === 204) {
            this.markBlank(layer.id, x, y, z);
            continue;
          }
          if (!response.ok || !contentType.startsWith("image/")) {
            throw new EndpointUnavailableError(
              `${response.status} ${contentType || "no content type"} for ${layer.id}`,
              response.status
            );
          }
          data = await response.arrayBuffer();
          weight = data.byteLength;
        }

        // The threshold scales with the tile area: an empty 256 px JPEG is
        // about 1.6 kB, an empty 512 px one about 4.7 kB, while real imagery
        // starts around 20 kB at that size.
        const minBytes = this.options.minTileBytes ?? (this.tileSize === 512 ? 9000 : 2500);
        const trusted = this.isConfirmedHere(layer.id, x, y, z);
        if (!isLast && !trusted && minBytes > 0 && weight < minBytes) {
          // Blank tile: the service covers the rectangle but not the ground
          // here. It stays healthy for other tiles, so it is not blacklisted,
          // but the whole block is remembered as empty.
          this.markBlank(layer.id, x, y, z);
          continue;
        }

        if (cache) {
          void cache
            .put(url, new Response(data.slice(0), { headers: { "content-type": contentType } }))
            .then(() => this.trimCache(cache))
            .catch(() => undefined);
        }

        this.confirm(layer.id, x, y, z);
        return { layer, data, contentType, url };
      } catch (error) {
        lastError = error as Error;
        // A tile the caller walked away from says nothing about the health of
        // the service; a timeout, which aborts the inner controller only, does.
        if (signal?.aborted) throw error;
        this.markFailure(layer.id);
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      }
    }

    if (this.transparentWhenUncovered) return this.emptyTile();
    throw new EndpointUnavailableError(
      `No source could serve tile ${z}/${x}/${y}: ${lastError?.message ?? "unknown error"}`,
      undefined,
      lastError
    );
  }

  /** True when a hole should be drawn as transparent rather than raised. */
  private get transparentWhenUncovered(): boolean {
    return this.options.transparentWhenUncovered ?? this.fallback === undefined;
  }

  /** 1x1 transparent PNG, so the layer underneath shows through a hole. */
  private emptyTile(): MosaicTile {
    const bytes = Uint8Array.from(atob(TRANSPARENT_PNG), (char) => char.charCodeAt(0));
    return {
      layer: EMPTY_LAYER,
      data: bytes.buffer as ArrayBuffer,
      contentType: "image/png",
      url: "orthogea:empty"
    };
  }
}

/** Convenience wrapper around `new Mosaic(...)`. */
export function createMosaic(options: MosaicOptions): Mosaic {
  return new Mosaic(options);
}

/** Tile template served by {@link createMosaicProtocol}. */
export function mosaicTileTemplate(id = "default"): string {
  return `${MOSAIC_PROTOCOL}://${encodeURIComponent(id)}/{z}/{x}/{y}`;
}

const TILE_URL_RE = new RegExp(`^${MOSAIC_PROTOCOL}://([^/]+)/(\\d+)/(\\d+)/(\\d+)$`);

export interface MosaicProtocolResponse {
  data: ArrayBuffer;
  cacheControl?: string | null;
  expires?: string | null;
}

/**
 * MapLibre protocol handler for one or more mosaics.
 *
 * ```ts
 * maplibregl.addProtocol("orthogea-mosaic", createMosaicProtocol(mosaic));
 * map.addSource("imagery", toMosaicRasterSource(mosaic));
 * ```
 */
export function createMosaicProtocol(mosaics: Mosaic | readonly Mosaic[]) {
  const byId = new Map(
    (Array.isArray(mosaics) ? mosaics : [mosaics as Mosaic]).map((mosaic) => [mosaic.id, mosaic])
  );

  const load = async (url: string, signal: AbortSignal): Promise<MosaicProtocolResponse> => {
    const match = TILE_URL_RE.exec(url);
    if (!match) throw new UnsupportedServiceError(`Malformed mosaic tile URL: ${url}`);

    const [, rawId, z, x, y] = match;
    const mosaic = byId.get(decodeURIComponent(rawId ?? ""));
    if (!mosaic) throw new UnsupportedServiceError(`Unknown mosaic "${rawId}" in ${url}`);

    const tile = await mosaic.fetchTile(Number(x), Number(y), Number(z), signal);
    return { data: tile.data };
  };

  return function mosaicProtocol(
    params: { url: string },
    second?: AbortController | ((error?: Error | null, data?: ArrayBuffer | null) => void)
  ): Promise<MosaicProtocolResponse> | { cancel: () => void } {
    const controller = second instanceof AbortController ? second : new AbortController();
    const request = load(params.url, controller.signal);

    if (typeof second === "function") {
      request.then(
        (response) => second(null, response.data),
        (error: Error) => second(error, null)
      );
      return { cancel: () => controller.abort() };
    }
    return request;
  };
}

/** Registers the mosaic protocol on a MapLibre instance. */
export function registerMosaicProtocol(
  maplibre: { addProtocol: (scheme: string, handler: never) => void },
  mosaics: Mosaic | readonly Mosaic[]
): void {
  maplibre.addProtocol(MOSAIC_PROTOCOL, createMosaicProtocol(mosaics) as never);
}

export interface MosaicSourceOptions {
  attribution?: AttributionOptions | false;
  /**
   * `active` (default) credits only the sources drawn so far, which keeps the
   * attribution line short; `all` lists every provider the mosaic may use.
   */
  attributionMode?: "active" | "all";
  maxzoom?: number;
  tileSize?: 256 | 512;
}

/**
 * MapLibre raster source for a mosaic: one source, worldwide coverage, the
 * best available imagery at every zoom.
 */
export function toMosaicRasterSource(
  mosaic: Mosaic,
  options: MosaicSourceOptions = {}
): RasterSourceSpecification {
  return {
    type: "raster",
    tiles: [mosaicTileTemplate(mosaic.id)],
    // 512 px tiles cover four times the ground per request: fewer round trips
    // on a slow link, and a quarter of the server watermarks on screen.
    tileSize: options.tileSize ?? mosaic.tileSize,
    minzoom: 0,
    // Orthophotos are 20-30 cm, so their native detail is exhausted around
    // zoom 19-20. Capping the source there lets MapLibre upscale the tiles it
    // already has instead of firing new requests at every deeper zoom, which
    // keeps zooming instant. The layer is never hidden: raster sources
    // overzoom, they do not disappear.
    maxzoom: options.maxzoom ?? DEFAULT_MOSAIC_MAX_ZOOM,
    attribution:
      options.attribution === false
        ? undefined
        : options.attributionMode === "all"
          ? mosaic.attribution(options.attribution ?? {})
          : mosaic.activeAttribution(options.attribution ?? {})
  };
}

export interface MosaicLayerOptions {
  id?: string;
  sourceId?: string;
  /** Zoom at which the imagery starts to appear over the layer below. */
  fadeFromZoom?: number;
  /** Zoom at which it is fully opaque. */
  fadeToZoom?: number;
  /** Below this zoom no tile is requested at all. Defaults to `fadeFromZoom`. */
  minzoom?: number;
  /** Opacity once fully faded in. Defaults to 1. */
  opacity?: number;
}

/**
 * Style layer for a mosaic, with an optional fade over zoom.
 *
 * Put an orthophoto mosaic over a base layer and let it fade in across a couple
 * of zoom levels: the reader sees the detail arrive rather than the map flip,
 * and wherever an orthophoto is missing the base keeps showing through.
 *
 * ```ts
 * map.addLayer(toMosaicRasterLayer(orthophotos, { fadeFromZoom: 13.5, fadeToZoom: 15.5 }));
 * ```
 */
export function toMosaicRasterLayer(
  mosaic: Mosaic,
  options: MosaicLayerOptions = {}
): RasterLayerSpecification {
  const sourceId = options.sourceId ?? `orthogea-mosaic-${mosaic.id}`;
  const opacity = options.opacity ?? 1;
  const from = options.fadeFromZoom;
  const to = options.fadeToZoom;

  const rasterOpacity =
    from !== undefined && to !== undefined && to > from
      ? ["interpolate", ["linear"], ["zoom"], from, 0, to, opacity]
      : opacity;

  return {
    id: options.id ?? `${sourceId}-raster`,
    type: "raster",
    source: sourceId,
    ...(options.minzoom ?? from) !== undefined
      ? { minzoom: Math.floor(options.minzoom ?? from ?? 0) }
      : {},
    paint: {
      "raster-opacity": rasterOpacity,
      "raster-fade-duration": 150
    }
  };
}

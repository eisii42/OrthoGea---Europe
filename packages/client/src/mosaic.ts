import {
  EndpointUnavailableError,
  UnsupportedServiceError,
  bboxAreaSqKm,
  bboxContainsPoint,
  lngLatToTile,
  tileToBBox,
  zoomForResolutionAt,
  type GeoBoundingBox,
  type OrthoGeaLayer
} from "@orthogea/core";
import { formatAttributions, type AttributionOptions } from "./attribution.js";
import { createTileWorker, type StitchedTile, type TileWorker } from "./worker.js";
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

/**
 * 512x512 fully transparent PNG, base64 - 1.1 kB.
 *
 * Full size rather than a single pixel on purpose. A 1x1 texture stretched over
 * a 512 px tile quad is at the mercy of the renderer's filtering and wrapping
 * rules, and a hole is drawn often enough that it is not worth the kilobyte
 * saved to find out how each driver handles it.
 */
const TRANSPARENT_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAgAAAAIACAYAAAD0eNT6AAAED0lEQVR42u3BMQEAAADCoPVPbQdvoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4DcC8AABL9rASwAAAABJRU5ErkJggg==";

/** Placeholder reported when a tile is a hole rather than imagery. */
const EMPTY_LAYER = {
  id: "orthogea:empty",
  title: "No coverage",
  attribution: "",
  tags: [] as string[]
} as unknown as OrthoGeaLayer;

/** Categories the mosaic can draw from. */
const IMAGERY_CATEGORIES = /* @__PURE__ */ new Set(["orthophoto", "satellite"]);

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
   * image rather than an error - a few hundred bytes of uniform colour. When
   * the mosaic has a fallback, its last source is accepted as it comes, so a
   * genuinely uniform tile (open sea, snow) still renders; when it can draw a
   * hole instead, it always prefers the hole to a neighbour's no-data fill.
   * Defaults to 9000 bytes for 512 px tiles and 2500 for 256 px ones; set 0 to
   * disable.
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
   * Fetch the four native tiles of a 256 px tile cache and stitch them, rather
   * than stretching one over a 512 px slot. Defaults to `true`: it is what
   * keeps basemap.at, IGN, Veneto and Estonia at the resolution the reader is
   * at. Set `false` to trade that detail for a quarter of the requests.
   */
  stitchTiles?: boolean;
  /**
   * Make a service's no-data fill transparent instead of drawing it.
   *
   * A WMS asked for a tile straddling the edge of its coverage answers with the
   * whole rectangle and fills the uncovered part with flat white or black.
   * JPEG has no alpha, so that fill is opaque and lands on top of the layer
   * below. Along the Tuscan shoreline it affected 23 of 49 tiles; inland, none.
   *
   * The fill is found by flooding inwards from the tile border, so only a flat
   * region that reaches the edge is removed - a car park or a snowfield in the
   * middle of the tile is surrounded by imagery and is never touched. Costs a
   * decode per tile in the worker, and a re-encode only for the tiles that
   * actually have a fill. Defaults to `true`; needs `OffscreenCanvas`.
   */
  trimCollars?: boolean;
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

export interface DetailZoomOptions {
  /**
   * Zoom levels of magnification accepted past the native resolution of the
   * imagery. Defaults to 1, so a 2 m base is readable to about zoom 16.5 and a
   * 20 cm orthophoto to about 20 - roughly where a commercial basemap stops
   * too. Set 0 to be strict, 2 to let readers push further.
   */
  upscale?: number;
  /** Never cap below this, so a coarse dataset cannot lock the reader out. */
  min?: number;
  /** Never allow past this. Defaults to 22, MapLibre's own ceiling. */
  max?: number;
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
   * The same knowledge as {@link Mosaic.blankBlocks}, at a zoom-independent
   * key. It is advisory only - it never stops a tile being requested, because
   * a 10 km square straddling a border would suppress the good side too - but
   * it is what lets {@link Mosaic.detailZoomAt} tell a rectangle that lies from
   * one that does not: Schleswig-Holstein's covers Hamburg on paper and holds
   * nothing there.
   */
  private readonly emptyAreas = new Map<string, Set<string>>();
  /**
   * Tiles being loaded right now, keyed by `z/x/y`.
   *
   * A tile is often wanted twice at once - the renderer asks for it while the
   * idle prefetcher is already downloading it, or a pan brings back a tile
   * whose request is still open. Sharing the work halves the traffic on a slow
   * link; the request is only aborted once every caller has walked away.
   */
  private readonly inFlight = new Map<string, InFlightTile>();
  /** Built on first use, so a mosaic that never needs pixels never spawns one. */
  private tileWorker?: TileWorker;
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
   * Deepest zoom worth showing over a point, from the resolution of the
   * imagery that actually covers it.
   *
   * Half of Europe has no open orthophoto, and there the map sits on the 2 m
   * European base. Letting a reader zoom to 20 over Sofia or Hamburg does not
   * reveal anything - it just enlarges pixels, and an upscaled satellite image
   * is the one thing that makes an open basemap look worse than a commercial
   * one. Capping the zoom instead is honest: the map stops where the data
   * stops.
   *
   * ```ts
   * mosaic.detailZoomAt(11.58, 48.14);   // 19.0 over Munich, 40 cm imagery
   * mosaic.detailZoomAt(9.99, 53.55);    // 16.6 over Hamburg, 2 m base only
   * ```
   */
  detailZoomAt(lng: number, lat: number, options: DetailZoomOptions = {}): number {
    const upscale = options.upscale ?? 1;
    const min = options.min ?? 12;
    const max = options.max ?? 22;

    // Ask at a deep level, where every candidate is in play: the answer is
    // about what covers the ground, not about the zoom the map happens to be
    // at. `orthophotoFromZoom` still applies, which is what makes a mosaic
    // that only draws the base report the base's own limit.
    const probeZoom = Math.max(0, Math.round(max) - (this.tileSize === 512 ? 1 : 0));
    const [x, y] = lngLatToTile(lng, lat, probeZoom);
    const area = Mosaic.areaKey(x, y, probeZoom);

    // A candidate that has already answered blank here does not set the limit:
    // its rectangle says it covers the ground, its tiles say otherwise, and the
    // tiles are right. Confirmed coverage always wins over one blank answer.
    const best =
      this.select(x, y, probeZoom).layers.find(
        (layer) =>
          !this.emptyAreas.get(layer.id)?.has(area) || (this.confirmed.get(layer.id)?.has(area) ?? false)
      ) ?? this.fallback;
    // Nothing here at all: this mosaic supports no detail over that ground.
    // Stacked mosaics are combined with `Math.max`, so the base layer's own
    // limit is what comes through.
    if (!best) return min;

    // Map zoom is always the 256 px scale, whatever size the tiles are served
    // at, so the comparison is made there.
    const resolution = best.resolutionMeters;
    const native =
      resolution && resolution > 0 ? zoomForResolutionAt(resolution, lat) : best.maxZoom;

    return Math.min(max, best.maxZoom, Math.max(min, native + upscale));
  }

  /**
   * True when a service publishes a tile grid finer than the one the mosaic
   * draws on, so its tiles have to be stitched rather than stretched.
   */
  private canStitch(layer: OrthoGeaLayer): boolean {
    if (this.options.stitchTiles === false) return false;
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
    signal: AbortSignal,
    priority: RequestPriority = "auto"
  ): Promise<StitchedTile | undefined> {
    // Only the four URLs are computed here - microseconds. Everything that
    // costs milliseconds happens in the worker.
    const urls = [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1]
    ].map(([dx, dy]) => this.tileUrl(layer, x * 2 + (dx as number), y * 2 + (dy as number), z + 1));

    return this.worker().stitch({ urls, tileSize: this.tileSize, signal, priority });
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

    const areas = this.emptyAreas.get(layerId) ?? new Set<string>();
    areas.add(Mosaic.areaKey(x, y, z));
    this.emptyAreas.set(layerId, areas);
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
    const tile = await this.share(x, y, z, signal, "high");
    if (tile.layer !== EMPTY_LAYER) {
      this.used.set(tile.layer.id, Date.now());
      this.options.onTile?.({ layer: tile.layer, x, y, z });
    }
    // Every caller gets its own buffer. A shared one is handed to an image
    // decoder that may transfer it to a worker, which would leave the other
    // callers holding a detached buffer - and a tile that never draws.
    return { ...tile, data: tile.data.slice(0) };
  }

  /**
   * Downloads a tile into the cache without drawing it and without crediting
   * its provider, so a viewport can be warmed ahead of a pan. Failures are
   * deliberately silent: a prefetch that does not arrive costs nothing.
   */
  prefetch(x: number, y: number, z: number): void {
    if (this.inFlight.has(`${z}/${x}/${y}`)) return;
    // Low priority: a tile nobody is looking at yet must never take bandwidth
    // from one that is on screen.
    void this.share(x, y, z, undefined, "low").catch(() => undefined);
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

  /**
   * Warms the tiles the reader is heading towards.
   *
   * A ring around the viewport is the right shape when the map is still, but
   * during a pan three quarters of it is behind the reader. Given the direction
   * of travel, only the leading edge is worth the bandwidth - and on a thin
   * connection that difference is the whole point.
   *
   * `heading` is a screen-space vector: x grows east, y grows south, and its
   * length does not matter.
   *
   * ```ts
   * map.on("moveend", () => {
   *   const [dx, dy] = panVelocity();          // however the host tracks it
   *   mosaic.prefetchAhead(x, y, z, dx, dy);
   * });
   * ```
   */
  prefetchAhead(
    x: number,
    y: number,
    z: number,
    headingX: number,
    headingY: number,
    depth = 2
  ): void {
    const length = Math.hypot(headingX, headingY);
    // Standing still: no direction to favour, so warm the whole ring instead.
    if (!Number.isFinite(length) || length < 1e-6) {
      this.prefetchAround(x, y, z);
      return;
    }

    const stepX = headingX / length;
    const stepY = headingY / length;
    const span = 2 ** z;
    const seen = new Set<string>();

    for (let step = 1; step <= depth; step += 1) {
      const leadX = Math.round(x + stepX * step);
      const leadY = Math.round(y + stepY * step);
      // A column across the direction of travel, so a diagonal pan still finds
      // the corners it is about to reveal.
      for (let across = -1; across <= 1; across += 1) {
        const tx = Math.round(leadX - stepY * across);
        const ty = Math.round(leadY + stepX * across);
        if (ty < 0 || ty >= span) continue;
        const key = `${tx}/${ty}`;
        if (seen.has(key)) continue;
        seen.add(key);
        this.prefetch(((tx % span) + span) % span, ty, z);
      }
    }
  }

  /** Keys of the tiles being loaded right now, for tests and diagnostics. */
  get inFlightTiles(): readonly string[] {
    return [...this.inFlight.keys()];
  }

  /** Releases the tile worker. Call when the mosaic is discarded. */
  dispose(): void {
    this.tileWorker?.dispose();
    this.tileWorker = undefined;
  }

  private worker(): TileWorker {
    this.tileWorker ??= createTileWorker({ fetchImpl: this.options.fetchImpl });
    return this.tileWorker;
  }

  /** Joins the download of a tile, starting it if nobody else has. */
  private share(
    x: number,
    y: number,
    z: number,
    signal?: AbortSignal,
    priority: RequestPriority = "auto"
  ): Promise<MosaicTile> {
    const key = `${z}/${x}/${y}`;
    let entry = this.inFlight.get(key);
    if (!entry) {
      const controller = new AbortController();
      const created: InFlightTile = {
        controller,
        refs: 0,
        promise: undefined as unknown as Promise<MosaicTile>
      };
      created.promise = this.loadTile(x, y, z, controller.signal, priority);
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
    signal?: AbortSignal,
    priority: RequestPriority = "auto"
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
          ? await this.fetchStitched(layer, x, y, z, controller.signal, priority)
          : undefined;

        let data: ArrayBuffer;
        let contentType: string;
        let weight: number;

        if (stitched) {
          ({ data, contentType } = stitched);
          weight = stitched.bytes;
        } else {
          const response = await fetchImpl(url, { signal: controller.signal, priority });
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

        // Look at the pixels before trusting the byte count. A service that
        // covers half the tile answers with the whole rectangle and fills the
        // rest flat, which is far too big to look empty and far too wrong to
        // draw.
        const verdict =
          this.options.trimCollars === false
            ? undefined
            : await this.worker().inspect({ data, contentType });

        if (verdict?.verdict === "empty") {
          if (!isLast) {
            this.markBlank(layer.id, x, y, z);
            continue;
          }
        } else if (verdict?.verdict === "trim") {
          data = verdict.data;
          contentType = verdict.contentType;
        }

        // The threshold scales with the tile area: an empty 256 px JPEG is
        // about 1.6 kB, an empty 512 px one about 4.7 kB, while real imagery
        // starts around 20 kB at that size. It is only a stand-in for looking
        // at the pixels, so it is skipped once they have been looked at.
        const minBytes = this.options.minTileBytes ?? (this.tileSize === 512 ? 9000 : 2500);
        const trusted = this.isConfirmedHere(layer.id, x, y, z);
        if (!verdict && !isLast && !trusted && minBytes > 0 && weight < minBytes) {
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

const TILE_URL_RE = /* @__PURE__ */ new RegExp(`^${MOSAIC_PROTOCOL}://([^/]+)/(\\d+)/(\\d+)/(\\d+)$`);

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
    // A hole is a fact about this moment, not about the ground: the service may
    // have been rate-limiting, or the connection may have dropped. Telling the
    // renderer not to store it means the area is asked for again on the next
    // pass, instead of staying empty for the rest of the session.
    return tile.layer.id === EMPTY_LAYER.id
      ? { data: tile.data, cacheControl: "no-store" }
      : { data: tile.data };
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

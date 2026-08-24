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
import type { RasterSourceSpecification } from "./types.js";

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
  /** Called whenever a tile is served, so a UI can show the live source. */
  onTile?: (info: { layer: OrthoGeaLayer; x: number; y: number; z: number }) => void;
}

export interface MosaicSelection {
  /** Candidates for the tile, best first, fallback last. */
  layers: OrthoGeaLayer[];
  /** True when only the global fallback applies, because of the zoom. */
  satelliteOnly: boolean;
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
  private tileCache?: Promise<Cache | undefined>;
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

    // National rectangles overlap across borders: once the most local source is
    // known, imagery from another country is dropped rather than shown over it.
    const local = covering.find((layer) => layer.country !== "EU");
    const filtered = local
      ? covering.filter((layer) => layer.country === local.country || layer.country === "EU")
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
   * Fetches a tile, walking down the candidate list until one answers with an
   * image. A layer that fails is skipped for a while, so one broken national
   * service cannot slow the whole map down.
   */
  async fetchTile(
    x: number,
    y: number,
    z: number,
    signal?: AbortSignal
  ): Promise<{ layer: OrthoGeaLayer; data: ArrayBuffer; contentType: string; url: string }> {
    const { layers } = this.select(x, y, z);
    if (layers.length === 0) {
      throw new UnsupportedServiceError(
        `No imagery covers tile ${z}/${x}/${y} and the mosaic has no fallback layer`
      );
    }

    const fetchImpl = this.options.fetchImpl ?? globalThis.fetch;
    const timeoutMs = this.options.timeoutMs ?? 12_000;
    let lastError: Error | undefined;

    const cache = await this.cache();

    for (const layer of layers) {
      const isLast = layer === layers[layers.length - 1];
      if (!isLast && this.isFailing(layer.id)) continue;
      // Coverage gaps are contiguous: if this service was empty next door, do
      // not spend a round trip finding out again.
      if (!isLast && this.isBlankHere(layer.id, x, y, z)) continue;

      const url = this.tileUrl(layer, x, y, z);

      const cached = await cache?.match(url).catch(() => undefined);
      if (cached) {
        const data = await cached.arrayBuffer();
        this.used.set(layer.id, Date.now());
        this.options.onTile?.({ layer, x, y, z });
        return {
          layer,
          data,
          contentType: cached.headers.get("content-type") ?? "image/jpeg",
          url
        };
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort);

      try {
        const response = await fetchImpl(url, { signal: controller.signal });
        const contentType = response.headers.get("content-type") ?? "";
        if (!response.ok || !contentType.startsWith("image/")) {
          throw new EndpointUnavailableError(
            `${response.status} ${contentType || "no content type"} for ${layer.id}`,
            response.status
          );
        }
        const data = await response.arrayBuffer();
        // The threshold scales with the tile area: an empty 256 px JPEG is
        // about 1.6 kB, an empty 512 px one about 4.7 kB, while real imagery
        // starts around 20 kB at that size.
        const minBytes = this.options.minTileBytes ?? (this.tileSize === 512 ? 9000 : 2500);
        if (!isLast && minBytes > 0 && data.byteLength < minBytes) {
          // Blank tile: the service covers the rectangle but not the ground
          // here. It stays healthy for other tiles, so it is not blacklisted,
          // but the whole block is remembered as empty.
          this.markBlank(layer.id, x, y, z);
          continue;
        }

        void cache
          ?.put(url, new Response(data.slice(0), { headers: { "content-type": contentType } }))
          .catch(() => undefined);

        this.used.set(layer.id, Date.now());
        this.options.onTile?.({ layer, x, y, z });
        return { layer, data, contentType, url };
      } catch (error) {
        lastError = error as Error;
        this.markFailure(layer.id);
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      }
    }

    throw new EndpointUnavailableError(
      `No source could serve tile ${z}/${x}/${y}: ${lastError?.message ?? "unknown error"}`,
      undefined,
      lastError
    );
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

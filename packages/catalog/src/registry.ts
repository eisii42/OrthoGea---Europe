import {
  bboxContainsPoint,
  bboxIntersects,
  isNutsWithin,
  isQueryableLayer,
  rankLayersForPoint,
  type GeoBoundingBox,
  type LayerCategory,
  type LayerCollection,
  type LayerStatus,
  type OrthoGeaLayer,
  type ServiceType
} from "@orthogea/core";
import bundled from "./generated/catalog.json";

/**
 * The bundled catalogue, validated and normalised by `scripts/build-data.mjs`.
 *
 * The check happens once, at build time, and the build fails if a record is
 * wrong - so the browser gets plain data and never loads a validator it does
 * not run. To validate a collection you did not author, import
 * `@orthogea/catalog/validate`.
 */
const allCollections: LayerCollection[] = (bundled as { collections: LayerCollection[] })
  .collections;
const allLayers: OrthoGeaLayer[] = allCollections.flatMap((collection) => collection.layers);

/** Every collection bundled with the package. */
export const collections: readonly LayerCollection[] = allCollections;

/**
 * Every validated layer of the bundled catalogue.
 * {@link registerCollection} appends to this list, so read it, do not keep a
 * private copy if you expect runtime additions.
 */
export const catalog: readonly OrthoGeaLayer[] = allLayers;

const byId = new Map(allLayers.map((layer) => [layer.id, layer]));

/** Looks a layer up by its stable id. */
export function getLayer(id: string): OrthoGeaLayer | undefined {
  return byId.get(id);
}

/** True when the catalogue contains the id. */
export function hasLayer(id: string): boolean {
  return byId.has(id);
}

/** Resolves several ids at once, skipping the unknown ones. */
export function getLayers(ids: readonly string[]): OrthoGeaLayer[] {
  return ids
    .map((id) => byId.get(id))
    .filter((layer): layer is OrthoGeaLayer => layer !== undefined);
}

export interface CatalogQuery {
  /** NUTS-0 code or `EU`. */
  country?: string;
  /** NUTS code of any level; matches the layer and all its descendants. */
  nuts?: string;
  category?: LayerCategory | readonly LayerCategory[];
  service?: ServiceType | readonly ServiceType[];
  status?: LayerStatus | readonly LayerStatus[];
  /** Every listed tag must be present. */
  tags?: readonly string[];
  /** Free-text match over id, title, description, region and tags. */
  text?: string;
  /** Keep only layers covering this coordinate. */
  point?: { lng: number; lat: number };
  /** Keep only layers whose extent intersects this box. */
  bbox?: GeoBoundingBox;
  /** Keep only layers that can answer GetFeatureInfo. */
  queryable?: boolean;
  /** Keep only layers visible at this zoom level. */
  zoom?: number;
}

const asArray = <T,>(value: T | readonly T[] | undefined): readonly T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value as T];

/** Filters the catalogue; every criterion is optional and combined with AND. */
export function findLayers(
  query: CatalogQuery = {},
  source: readonly OrthoGeaLayer[] = catalog
): OrthoGeaLayer[] {
  const categories = asArray(query.category);
  const services = asArray(query.service);
  const statuses = asArray(query.status);
  const text = query.text?.trim().toLowerCase();

  return source.filter((layer) => {
    if (query.country && layer.country !== query.country) return false;
    if (query.nuts && !(layer.nuts ? isNutsWithin(layer.nuts, query.nuts) : layer.country === query.nuts)) {
      return false;
    }
    if (categories.length > 0 && !categories.includes(layer.category)) return false;
    if (services.length > 0 && !services.includes(layer.service.type)) return false;
    if (statuses.length > 0 && !statuses.includes(layer.status)) return false;
    if (query.tags && !query.tags.every((tag) => layer.tags.includes(tag))) return false;
    if (query.queryable !== undefined && isQueryableLayer(layer) !== query.queryable) return false;
    if (query.zoom !== undefined && (query.zoom < layer.minZoom || query.zoom > layer.maxZoom)) {
      return false;
    }
    if (query.point && !bboxContainsPoint(layer.bbox, query.point.lng, query.point.lat)) {
      return false;
    }
    if (query.bbox && !bboxIntersects(layer.bbox, query.bbox)) return false;
    if (text) {
      const haystack = [
        layer.id,
        layer.title,
        layer.description ?? "",
        layer.regionName ?? "",
        layer.provider.name,
        ...layer.tags
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(text)) return false;
    }
    return true;
  });
}

/**
 * Layers covering a coordinate, most local first, so a portal can offer the
 * municipal orthophoto before the regional one and the EU-wide mosaic last.
 */
export function layersForPoint(
  lng: number,
  lat: number,
  query: Omit<CatalogQuery, "point"> = {}
): OrthoGeaLayer[] {
  const filtered = findLayers({ ...query, point: { lng, lat } });
  return rankLayersForPoint(filtered, {
    lng,
    lat,
    zoom: query.zoom,
    activeOnly: query.status === undefined
  });
}

/**
 * The single European background: Copernicus VHR 2021, about 2 m.
 *
 * One official European Union product, served by the EEA without an API key,
 * covers the whole continent. Keeping a single background is what makes the map
 * fast and consistent; orthophotos are asked for only at detail zoom.
 */
export const DEFAULT_SATELLITE_FALLBACK_ID = "eu.copernicus.vhr-2021";

export interface BestImageryOptions {
  zoom?: number;
  /**
   * Keep layers tagged as duplicates of a better record. Defaults to `false`,
   * which is what keeps a stack free of two views of the same ground.
   */
  includeAlternatives?: boolean;
  /**
   * Layer id used when no local orthophoto covers the point, or `false` to
   * return `undefined` instead. Defaults to {@link DEFAULT_SATELLITE_FALLBACK_ID}.
   */
  fallback?: string | false;
}

/**
 * The imagery to show at a coordinate, replacing a proprietary satellite
 * basemap: the most local official orthophoto covering the point, or the
 * pan-European Sentinel-2 mosaic when no national source is catalogued.
 *
 * ```ts
 * const layer = bestOrthophotoFor(11.2558, 43.7696); // Ortofoto 2013 - Toscana
 * const layer = bestOrthophotoFor(-8.0, 63.0);       // Sentinel-2 cloudless 2024
 * ```
 */
export function bestOrthophotoFor(
  lng: number,
  lat: number,
  options: BestImageryOptions = {}
): OrthoGeaLayer | undefined {
  const local = layersForPoint(lng, lat, {
    category: "orthophoto",
    ...(options.zoom === undefined ? {} : { zoom: options.zoom })
  }).filter((layer) => options.includeAlternatives || !layer.tags.includes("alternative"));
  if (local[0]) return local[0];

  if (options.fallback === false) return undefined;
  return byId.get(options.fallback ?? DEFAULT_SATELLITE_FALLBACK_ID);
}

/**
 * Imagery ranked from the most local source to the pan-European fallback, so a
 * portal can offer the user a "best available" stack in one call.
 */
export function imageryStackFor(
  lng: number,
  lat: number,
  options: BestImageryOptions = {}
): OrthoGeaLayer[] {
  const stack = layersForPoint(lng, lat, {
    category: ["orthophoto", "satellite"],
    ...(options.zoom === undefined ? {} : { zoom: options.zoom })
  }).filter((layer) => options.includeAlternatives || !layer.tags.includes("alternative"));

  const fallback =
    options.fallback === false
      ? undefined
      : byId.get(options.fallback ?? DEFAULT_SATELLITE_FALLBACK_ID);

  // The fallback closes the stack, wherever it ranked by extent.
  if (fallback) {
    const withoutFallback = stack.filter((layer) => layer.id !== fallback.id);
    return [...withoutFallback, fallback];
  }
  return stack;
}

/** Groups the catalogue by NUTS-0 country code. */
export function groupByCountry(
  source: readonly OrthoGeaLayer[] = catalog
): Map<string, OrthoGeaLayer[]> {
  const grouped = new Map<string, OrthoGeaLayer[]>();
  for (const layer of source) {
    const bucket = grouped.get(layer.country) ?? [];
    bucket.push(layer);
    grouped.set(layer.country, bucket);
  }
  return grouped;
}

/** Groups the catalogue by thematic category. */
export function groupByCategory(
  source: readonly OrthoGeaLayer[] = catalog
): Map<LayerCategory, OrthoGeaLayer[]> {
  const grouped = new Map<LayerCategory, OrthoGeaLayer[]>();
  for (const layer of source) {
    const bucket = grouped.get(layer.category) ?? [];
    bucket.push(layer);
    grouped.set(layer.category, bucket);
  }
  return grouped;
}

export interface CatalogStats {
  layers: number;
  collections: number;
  countries: number;
  byCategory: Record<string, number>;
  byService: Record<string, number>;
  queryable: number;
  /** Most recent `lastVerified` date in the catalogue. */
  lastVerified?: string;
}

/** Summary counters, handy for a portal footer or a CI report. */
export function catalogStats(source: readonly OrthoGeaLayer[] = catalog): CatalogStats {
  const byCategory: Record<string, number> = {};
  const byService: Record<string, number> = {};
  let queryable = 0;
  let lastVerified: string | undefined;

  for (const layer of source) {
    byCategory[layer.category] = (byCategory[layer.category] ?? 0) + 1;
    byService[layer.service.type] = (byService[layer.service.type] ?? 0) + 1;
    if (isQueryableLayer(layer)) queryable += 1;
    if (layer.lastVerified && (!lastVerified || layer.lastVerified > lastVerified)) {
      lastVerified = layer.lastVerified;
    }
  }

  return {
    layers: source.length,
    collections: collections.length,
    countries: new Set(source.map((layer) => layer.country)).size,
    byCategory,
    byService,
    queryable,
    lastVerified
  };
}

/**
 * Internals `@orthogea/catalog/validate` appends to when a host registers an
 * external collection. Not part of the public API.
 *
 * @internal
 */
export const mutableRegistry = {
  collections: allCollections,
  layers: allLayers,
  byId
};

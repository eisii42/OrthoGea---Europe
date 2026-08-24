import {
  UnsupportedServiceError,
  applyCorsProxy,
  bboxToMercator,
  buildQueryUrl,
  formatBBox,
  isSameCrs,
  isWmsLayer,
  lngLatToMercator,
  metersPerPixel,
  normalizeCrs,
  type GeoBoundingBox,
  type OrthoGeaLayer,
  type ProjectedBoundingBox,
  type WmsService
} from "@orthogea/core";
import type { AdapterOptions } from "../types.js";

export interface FeatureInfoQuery {
  /** Clicked position in WGS84 degrees, `[lng, lat]`. */
  lngLat: [number, number];
  /** Current map extent in WGS84 degrees. Required for pixel-accurate queries. */
  bbox?: GeoBoundingBox;
  /** Canvas size in CSS pixels. */
  width?: number;
  height?: number;
  /** Map zoom level, used to synthesise a window when `bbox` is unknown. */
  zoom?: number;
  /** Explicit pixel position of the click inside the canvas. */
  pixel?: { x: number; y: number };
  /** MIME type requested from the server; defaults to the layer's best format. */
  infoFormat?: string;
  featureCount?: number;
  /** Vendor tolerance in pixels (GeoServer `BUFFER`, MapServer `RADIUS`). */
  buffer?: number;
}

/** GetFeatureInfo window: a projected extent plus the pixel that was clicked. */
export interface FeatureInfoWindow {
  crs: string;
  bbox: ProjectedBoundingBox;
  width: number;
  height: number;
  i: number;
  j: number;
}

const DEFAULT_WINDOW_SIZE = 101;

/** Metres per degree of latitude, good enough to size a query window. */
const METRES_PER_DEGREE = 111320;

/** Picks the MIME type to request, preferring machine-readable formats. */
export function pickInfoFormat(
  available: readonly string[],
  requested?: string
): string {
  if (requested) return requested;
  // HTML is placed before GML on purpose: several INSPIRE services (the
  // Italian cadastre among them) return an attribute-less GML envelope but a
  // complete attribute table in HTML.
  const preference = [
    "application/geo+json",
    "application/json",
    "text/html",
    "application/vnd.ogc.gml",
    "text/xml",
    "text/plain"
  ];
  for (const candidate of preference) {
    const match = available.find((format) => format.toLowerCase().startsWith(candidate));
    if (match) return match;
  }
  return available[0] ?? "text/html";
}

/**
 * Resolves the click into a projected window in EPSG:3857.
 *
 * With `bbox`, `width` and `height` the real viewport is reused, so the server
 * sees exactly what the user sees. Without them a square window is synthesised
 * around the click from the zoom level, which is enough for point queries.
 */
export function resolveFeatureInfoWindow(query: FeatureInfoQuery): FeatureInfoWindow {
  const crs = "EPSG:3857";
  const [lng, lat] = query.lngLat;
  const [x, y] = lngLatToMercator(lng, lat);

  if (query.bbox && query.width && query.height) {
    const bbox = bboxToMercator(query.bbox);
    const [minX, minY, maxX, maxY] = bbox;
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const i = query.pixel?.x ?? Math.round(((x - minX) / spanX) * query.width);
    const j = query.pixel?.y ?? Math.round(((maxY - y) / spanY) * query.height);
    return {
      crs,
      bbox,
      width: query.width,
      height: query.height,
      // Keep the pixel inside the image, as required by the WMS specification.
      i: Math.min(Math.max(i, 0), query.width - 1),
      j: Math.min(Math.max(j, 0), query.height - 1)
    };
  }

  const zoom = query.zoom ?? 16;
  const size = query.width && query.height ? Math.min(query.width, query.height) : DEFAULT_WINDOW_SIZE;
  const half = (size / 2) * metersPerPixel(zoom);
  return {
    crs,
    bbox: [x - half, y - half, x + half, y + half],
    width: size,
    height: size,
    i: Math.floor(size / 2),
    j: Math.floor(size / 2)
  };
}

/**
 * Square window in a geographic CRS, centred on the click.
 *
 * Used for services that do not publish EPSG:3857: the request is written in
 * degrees and the clicked pixel sits exactly at the centre, so no
 * Mercator/equirectangular distortion can shift the query.
 */
export function resolveGeographicWindow(
  query: FeatureInfoQuery,
  crs: string
): FeatureInfoWindow {
  const [lng, lat] = query.lngLat;
  const size = DEFAULT_WINDOW_SIZE;
  const halfMetres = (size / 2) * metersPerPixel(query.zoom ?? 16);
  const halfLat = halfMetres / METRES_PER_DEGREE;
  const halfLng = halfMetres / (METRES_PER_DEGREE * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));

  return {
    crs,
    bbox: [lng - halfLng, lat - halfLat, lng + halfLng, lat + halfLat],
    width: size,
    height: size,
    i: Math.floor(size / 2),
    j: Math.floor(size / 2)
  };
}

export interface BuildFeatureInfoUrlOptions extends AdapterOptions {
  /** Overrides the CRS sent to the server; defaults to EPSG:3857. */
  crs?: string;
}

/** Geographic CRS accepted when a service cannot answer in Web Mercator. */
const GEOGRAPHIC_FALLBACKS = ["CRS:84", "EPSG:4326", "EPSG:4258", "EPSG:6706"] as const;

/** CRS the query will be written in: Web Mercator when available, else geographic. */
export function resolveQueryCrs(service: WmsService, requested?: string): string {
  if (requested) return normalizeCrs(requested);

  const mercator = service.options.crs.find((crs) => isSameCrs(crs, "EPSG:3857"));
  if (mercator) return mercator;

  for (const candidate of GEOGRAPHIC_FALLBACKS) {
    const match = service.options.crs.find((crs) => isSameCrs(crs, candidate));
    if (match) return match;
  }

  throw new UnsupportedServiceError(
    `The service publishes neither EPSG:3857 nor a geographic CRS (${service.options.crs.join(", ")})`
  );
}

/**
 * Builds a WMS `GetFeatureInfo` URL for a queryable layer, using `I`/`J` on
 * 1.3.0 services and `X`/`Y` on 1.1.x ones, with the BBOX written in the axis
 * order the target CRS requires.
 */
export function buildGetFeatureInfoUrl(
  service: WmsService,
  query: FeatureInfoQuery,
  options: BuildFeatureInfoUrlOptions = {}
): string {
  const options_ = service.options;
  const crs = resolveQueryCrs(service, options.crs);
  const window = isSameCrs(crs, "EPSG:3857")
    ? resolveFeatureInfoWindow(query)
    : resolveGeographicWindow(query, crs);

  const version = options_.version;
  const params: Record<string, string | number | boolean> = {
    SERVICE: "WMS",
    VERSION: version,
    REQUEST: "GetFeatureInfo",
    LAYERS: options_.layers.join(","),
    QUERY_LAYERS: options_.layers.join(","),
    STYLES: options_.styles.join(","),
    FORMAT: options_.format,
    TRANSPARENT: options_.transparent ? "TRUE" : "FALSE",
    INFO_FORMAT: pickInfoFormat(options_.infoFormats, query.infoFormat),
    FEATURE_COUNT: query.featureCount ?? 10,
    WIDTH: window.width,
    HEIGHT: window.height
  };

  if (version === "1.3.0") {
    params.CRS = crs;
    params.I = window.i;
    params.J = window.j;
  } else {
    params.SRS = crs;
    params.X = window.i;
    params.Y = window.j;
  }

  params.BBOX = formatBBox(window.bbox, { crs, wmsVersion: version });

  if (query.buffer !== undefined) {
    params.BUFFER = query.buffer;
    params.RADIUS = query.buffer;
  }

  const url = buildQueryUrl(service.url, {
    ...params,
    ...options_.extraParams,
    ...options.extraParams
  });
  return applyCorsProxy(url, options.proxyUrl);
}

/** Narrows a catalogue layer to a queryable WMS service, or explains why not. */
export function assertQueryableWms(layer: OrthoGeaLayer): WmsService {
  if (!isWmsLayer(layer)) {
    throw new UnsupportedServiceError(
      `GetFeatureInfo needs a WMS layer; "${layer.id}" is a ${layer.service.type} service`
    );
  }
  if (!layer.service.options.queryable) {
    throw new UnsupportedServiceError(`Layer "${layer.id}" is not queryable`);
  }
  return layer.service;
}

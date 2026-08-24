import {
  applyCorsProxy,
  buildQueryUrl,
  formatBBox,
  isSameCrs,
  normalizeCrs,
  type GeoBoundingBox,
  type ProjectedBoundingBox,
  type WMSOptions,
  type WmsService,
  type WmsVersion
} from "@orthogea/core";
import type { AdapterOptions } from "../types.js";

/** MapLibre GL replaces this token with the tile extent in EPSG:3857 metres. */
export const MAPLIBRE_BBOX_PLACEHOLDER = "{bbox-epsg-3857}";

export interface WmsRequestOptions extends AdapterOptions {
  /** CRS requested from the server. Defaults to EPSG:3857 for tiled rendering. */
  crs?: string;
  format?: string;
  transparent?: boolean;
  styles?: string[];
  /** Value of the `TIME` dimension. */
  time?: string;
  /**
   * Send `SRS=` alongside `CRS=`. Harmless for compliant servers and required
   * by several 1.1.1-era Italian and Spanish endpoints. Defaults to `true`.
   */
  includeLegacySrs?: boolean;
}

function resolveTileCrs(options: WMSOptions, requested?: string): string {
  const crs = normalizeCrs(requested ?? "EPSG:3857");
  const supported = options.crs.find((candidate) => isSameCrs(candidate, crs));
  // Fall back to the exact spelling the service advertises, when it has one.
  return supported ?? crs;
}

function baseParams(
  options: WMSOptions,
  request: WmsRequestOptions,
  crs: string,
  width: number,
  height: number
): Record<string, string | number | boolean> {
  const version: WmsVersion = options.version;
  const styles = (request.styles ?? options.styles).join(",");
  const params: Record<string, string | number | boolean> = {
    SERVICE: "WMS",
    VERSION: version,
    REQUEST: "GetMap",
    LAYERS: options.layers.join(","),
    STYLES: styles,
    FORMAT: request.format ?? options.format,
    TRANSPARENT: (request.transparent ?? options.transparent) ? "TRUE" : "FALSE",
    WIDTH: width,
    HEIGHT: height
  };

  // WMS 1.1.1 spells it SRS, WMS 1.3.0 spells it CRS; sending both is the
  // pragmatic choice for endpoints that answer on either version.
  if (version === "1.3.0") {
    if (request.includeLegacySrs !== false) params.SRS = crs;
    params.CRS = crs;
  } else {
    params.SRS = crs;
    if (request.includeLegacySrs !== false) params.CRS = crs;
  }

  const time = request.time ?? options.time;
  if (time) params.TIME = time;

  return { ...params, ...options.extraParams, ...request.extraParams };
}

/**
 * Builds the tiled GetMap template consumed by MapLibre GL raster sources.
 *
 * The `BBOX` value is left as the `{bbox-epsg-3857}` placeholder, which the
 * renderer replaces per tile, so the template is generated for EPSG:3857 only.
 */
export function buildWmsTileUrlTemplate(
  service: WmsService,
  request: WmsRequestOptions = {}
): string {
  const tileSize = request.tileSize ?? service.options.tileSize;
  const crs = resolveTileCrs(service.options, request.crs ?? "EPSG:3857");
  const url = buildQueryUrl(
    service.url,
    baseParams(service.options, request, crs, tileSize, tileSize),
    { rawParams: { BBOX: MAPLIBRE_BBOX_PLACEHOLDER } }
  );
  return applyCorsProxy(url, request.proxyUrl);
}

export interface WmsGetMapRequest extends WmsRequestOptions {
  /** Extent to render, in the units of `crs` and in x/y order. */
  bbox: GeoBoundingBox | ProjectedBoundingBox;
  width: number;
  height: number;
}

/**
 * Builds a concrete GetMap URL, applying the axis-order rules of the target
 * CRS and protocol version to the `BBOX` parameter.
 */
export function buildWmsGetMapUrl(service: WmsService, request: WmsGetMapRequest): string {
  const crs = resolveTileCrs(service.options, request.crs);
  const params = baseParams(
    service.options,
    request,
    crs,
    request.width,
    request.height
  );
  const url = buildQueryUrl(service.url, {
    ...params,
    BBOX: formatBBox(request.bbox, { crs, wmsVersion: service.options.version })
  });
  return applyCorsProxy(url, request.proxyUrl);
}

/** Builds a GetLegendGraphic URL for the first layer of the service. */
export function buildWmsLegendUrl(
  service: WmsService,
  options: { style?: string; format?: string; proxyUrl?: string } = {}
): string {
  const url = buildQueryUrl(service.url, {
    SERVICE: "WMS",
    VERSION: service.options.version,
    REQUEST: "GetLegendGraphic",
    LAYER: service.options.layers[0] ?? "",
    STYLE: options.style ?? service.options.styles[0] ?? "",
    FORMAT: options.format ?? "image/png"
  });
  return applyCorsProxy(url, options.proxyUrl);
}

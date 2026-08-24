import {
  applyCorsProxy,
  buildQueryUrl,
  UnsupportedServiceError,
  type WmtsService,
  type XyzService
} from "@orthogea/core";
import type { AdapterOptions } from "../types.js";

export interface WmtsRequestOptions extends AdapterOptions {
  /**
   * Template for the `TILEMATRIX` value. Services that number their matrices
   * `0..n` need the default `{z}`; GeoServer-style services usually need
   * something like `EPSG:3857:{z}`.
   */
  tileMatrixTemplate?: string;
  style?: string;
  format?: string;
  /** Values for WMTS dimensions, e.g. `{ TIME: "2024-06-01" }`. */
  dimensions?: Record<string, string>;
}

const REST_PLACEHOLDERS: Record<string, string> = {
  tilematrix: "{z}",
  tilerow: "{y}",
  tilecol: "{x}"
};

/**
 * Fills a RESTful WMTS `ResourceURL` template with renderer placeholders and
 * the requested style, matrix set and dimension values.
 */
export function fillWmtsRestTemplate(
  template: string,
  values: { layer: string; style: string; tileMatrixSet: string; dimensions?: Record<string, string> }
): string {
  return template.replace(/\{([^}]+)\}/g, (match, rawKey: string) => {
    const key = rawKey.toLowerCase();
    if (REST_PLACEHOLDERS[key]) return REST_PLACEHOLDERS[key] as string;
    if (key === "layer") return values.layer;
    if (key === "style") return values.style;
    if (key === "tilematrixset") return values.tileMatrixSet;
    const dimension = Object.entries(values.dimensions ?? {}).find(
      ([name]) => name.toLowerCase() === key
    );
    return dimension ? dimension[1] : match;
  });
}

/**
 * Builds the tile URL template for a WMTS layer, in either KVP or REST
 * encoding, ready for a MapLibre raster source.
 */
export function buildWmtsTileUrlTemplate(
  service: WmtsService,
  request: WmtsRequestOptions = {}
): string {
  const options = service.options;
  const style = request.style ?? options.style;
  const format = request.format ?? options.format;
  const dimensions = { ...options.dimensions, ...request.dimensions };

  if (options.requestEncoding === "REST") {
    const template = options.urlTemplate ?? service.url;
    if (!template.includes("{")) {
      throw new UnsupportedServiceError(
        `WMTS layer "${options.layer}" is declared as REST but carries no ResourceURL template`
      );
    }
    return applyCorsProxy(
      fillWmtsRestTemplate(template, {
        layer: options.layer,
        style,
        tileMatrixSet: options.tileMatrixSet,
        dimensions
      }),
      request.proxyUrl
    );
  }

  const url = buildQueryUrl(
    service.url,
    {
      SERVICE: "WMTS",
      VERSION: options.version,
      REQUEST: "GetTile",
      LAYER: options.layer,
      STYLE: style,
      FORMAT: format,
      TILEMATRIXSET: options.tileMatrixSet,
      ...dimensions,
      ...request.extraParams
    },
    {
      rawParams: {
        TILEMATRIX: request.tileMatrixTemplate ?? options.tileMatrixTemplate ?? "{z}",
        TILEROW: "{y}",
        TILECOL: "{x}"
      }
    }
  );
  return applyCorsProxy(url, request.proxyUrl);
}

/**
 * Expands an XYZ template into one URL per subdomain, because MapLibre has no
 * `{s}` placeholder and expects the alternatives to be listed explicitly.
 */
export function buildXyzTileUrls(service: XyzService, options: AdapterOptions = {}): string[] {
  const template = service.options.urlTemplate;
  const withParams = options.extraParams
    ? buildQueryUrl(template, options.extraParams)
    : template;
  const subdomains = service.options.subdomains;

  const urls =
    subdomains.length > 0 && /\{[sa]\}/.test(withParams)
      ? subdomains.map((subdomain) => withParams.replace(/\{[sa]\}/g, subdomain))
      : [withParams];

  return urls.map((url) => applyCorsProxy(url, options.proxyUrl));
}

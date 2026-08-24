import {
  UnsupportedServiceError,
  applyCorsProxy,
  isSameCrs,
  tileToBBox,
  tileToMercatorBBox,
  type OrthoGeaLayer
} from "@orthogea/core";
import type { AdapterOptions } from "./types.js";
import { pickReprojectionCrs, supportsWebMercator } from "./maplibre/protocol.js";
import { buildWmsGetMapUrl, type WmsRequestOptions } from "./wms/url.js";
import { buildWmtsTileUrlTemplate, buildXyzTileUrls, type WmtsRequestOptions } from "./wmts/url.js";

/** Builds the URL of one tile of the standard Web Mercator pyramid. */
export type TileUrlBuilder = (x: number, y: number, z: number) => string;

export interface TileUrlBuilderOptions
  extends AdapterOptions,
    WmsRequestOptions,
    WmtsRequestOptions {}

/**
 * Returns a function that turns `{x, y, z}` tile indices into a request URL.
 *
 * This is the lowest common denominator every map library understands:
 * Leaflet through a `getTileUrl` override, OpenLayers through
 * `tileUrlFunction`, MapLibre through a custom protocol, and anything else
 * through a plain fetch. WMS services are asked for the exact extent of the
 * tile - in EPSG:3857 when they publish it, in the geographic CRS they do
 * publish otherwise - so layers such as the Italian cadastre work everywhere.
 */
export function createTileUrlBuilder(
  layer: OrthoGeaLayer,
  options: TileUrlBuilderOptions = {}
): TileUrlBuilder {
  switch (layer.service.type) {
    case "WMS": {
      const service = layer.service;
      const tileSize = options.tileSize ?? service.options.tileSize;
      const mercator = supportsWebMercator(service);
      const crs = mercator
        ? service.options.crs.find((code) => isSameCrs(code, "EPSG:3857")) ?? "EPSG:3857"
        : pickReprojectionCrs(service);

      return (x, y, z) =>
        buildWmsGetMapUrl(service, {
          ...options,
          crs,
          bbox: mercator ? tileToMercatorBBox(x, y, z) : tileToBBox(x, y, z),
          width: tileSize,
          height: tileSize
        });
    }

    case "WMTS": {
      const template = buildWmtsTileUrlTemplate(layer.service, options);
      return (x, y, z) => fillTileTemplate(template, x, y, z);
    }

    case "XYZ": {
      const templates = buildXyzTileUrls(layer.service, options);
      const tms = layer.service.options.scheme === "tms";
      return (x, y, z) => {
        const template = templates[Math.abs(x + y) % templates.length] ?? templates[0] ?? "";
        // TMS numbers rows from the south; libraries that already flip the row
        // should use the template directly instead of this builder.
        const row = tms ? Math.pow(2, z) - 1 - y : y;
        return fillTileTemplate(template, x, row, z);
      };
    }

    default:
      throw new UnsupportedServiceError(
        `Layer "${layer.id}" is a ${layer.service.type} service and has no tile pyramid`
      );
  }
}

/** Substitutes `{z}`, `{x}` and `{y}` in a tile template. */
export function fillTileTemplate(template: string, x: number, y: number, z: number): string {
  return template
    .replace(/\{z\}/g, String(z))
    .replace(/\{x\}/g, String(x))
    .replace(/\{y\}/g, String(y));
}

/**
 * Fetches one tile and returns its bytes, mostly useful for tests, thumbnails
 * and server-side rendering.
 */
export async function fetchTile(
  layer: OrthoGeaLayer,
  tile: { x: number; y: number; z: number },
  options: TileUrlBuilderOptions & {
    fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
    signal?: AbortSignal;
  } = {}
): Promise<{ url: string; contentType: string; data: ArrayBuffer }> {
  const url = createTileUrlBuilder(layer, options)(tile.x, tile.y, tile.z);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const response = await fetchImpl(applyCorsProxy(url, undefined), { signal: options.signal });
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || !contentType.startsWith("image/")) {
    throw new UnsupportedServiceError(
      `Tile request failed for "${layer.id}": ${response.status} ${contentType}`
    );
  }
  return { url, contentType, data: await response.arrayBuffer() };
}

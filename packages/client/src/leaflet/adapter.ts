import {
  UnsupportedServiceError,
  applyCorsProxy,
  type OrthoGeaLayer
} from "@orthogea/core";
import { formatAttribution, type AttributionOptions } from "../attribution.js";
import { supportsWebMercator } from "../maplibre/protocol.js";
import { createTileUrlBuilder, type TileUrlBuilder } from "../tiles.js";
import type { AdapterOptions } from "../types.js";
import { buildWmtsTileUrlTemplate, type WmtsRequestOptions } from "../wmts/url.js";

/** Leaflet bounds, `[[south, west], [north, east]]`. */
export type LeafletBounds = [[number, number], [number, number]];

export interface LeafletCommonOptions {
  attribution?: string;
  minZoom: number;
  maxZoom: number;
  bounds: LeafletBounds;
  crossOrigin?: string | boolean;
}

/** Options for `L.tileLayer(url, options)`. */
export interface LeafletTileLayerDescriptor {
  kind: "tileLayer";
  url: string;
  options: LeafletCommonOptions & { tms?: boolean; subdomains?: string[] };
}

/** Options for `L.tileLayer.wms(url, options)`. */
export interface LeafletWmsDescriptor {
  kind: "tileLayer.wms";
  url: string;
  options: LeafletCommonOptions & {
    layers: string;
    styles: string;
    format: string;
    transparent: boolean;
    version: string;
    uppercase: true;
  };
}

/**
 * A layer Leaflet cannot address with its built-in classes, because the
 * service does not publish EPSG:3857. Extend `L.TileLayer` with the supplied
 * `getTileUrl`.
 */
export interface LeafletCustomDescriptor {
  kind: "tileLayer.custom";
  getTileUrl: TileUrlBuilder;
  options: LeafletCommonOptions;
}

export type LeafletSource =
  | LeafletTileLayerDescriptor
  | LeafletWmsDescriptor
  | LeafletCustomDescriptor;

export interface LeafletAdapterOptions extends AdapterOptions, WmtsRequestOptions {
  attribution?: AttributionOptions | false;
  crossOrigin?: string | boolean;
}

function commonOptions(
  layer: OrthoGeaLayer,
  options: LeafletAdapterOptions
): LeafletCommonOptions {
  return {
    attribution:
      options.attribution === false
        ? undefined
        : formatAttribution(layer, options.attribution ?? {}),
    minZoom: layer.minZoom,
    maxZoom: layer.maxZoom,
    bounds: [
      [layer.bbox[1], layer.bbox[0]],
      [layer.bbox[3], layer.bbox[2]]
    ],
    crossOrigin: options.crossOrigin ?? "anonymous"
  };
}

/**
 * Describes a catalogue layer for Leaflet.
 *
 * ```js
 * const source = toLeafletSource(layer);
 *
 * const leafletLayer =
 *   source.kind === "tileLayer.wms"
 *     ? L.tileLayer.wms(source.url, source.options)
 *     : source.kind === "tileLayer"
 *       ? L.tileLayer(source.url, source.options)
 *       : new (L.TileLayer.extend({
 *           getTileUrl: (coords) => source.getTileUrl(coords.x, coords.y, coords.z)
 *         }))("", source.options);
 *
 * leafletLayer.addTo(map);
 * ```
 */
export function toLeafletSource(
  layer: OrthoGeaLayer,
  options: LeafletAdapterOptions = {}
): LeafletSource {
  const common = commonOptions(layer, options);

  switch (layer.service.type) {
    case "WMS": {
      const service = layer.service;
      // Leaflet computes the BBOX itself, but only in the CRS of the map.
      // Services without Web Mercator need our own tile URL builder.
      if (!supportsWebMercator(service)) {
        return {
          kind: "tileLayer.custom",
          getTileUrl: createTileUrlBuilder(layer, options),
          options: common
        };
      }
      return {
        kind: "tileLayer.wms",
        url: applyCorsProxy(service.url, options.proxyUrl),
        options: {
          ...common,
          layers: service.options.layers.join(","),
          styles: service.options.styles.join(","),
          format: service.options.format,
          transparent: service.options.transparent,
          version: service.options.version,
          uppercase: true
        }
      };
    }

    case "WMTS":
      return {
        kind: "tileLayer",
        url: buildWmtsTileUrlTemplate(layer.service, options),
        options: common
      };

    case "XYZ": {
      const service = layer.service;
      return {
        kind: "tileLayer",
        url: applyCorsProxy(service.options.urlTemplate, options.proxyUrl),
        options: {
          ...common,
          tms: service.options.scheme === "tms",
          subdomains: service.options.subdomains.length > 0 ? service.options.subdomains : undefined
        }
      };
    }

    default:
      throw new UnsupportedServiceError(
        `Layer "${layer.id}" is a ${layer.service.type} service and has no Leaflet raster equivalent`
      );
  }
}

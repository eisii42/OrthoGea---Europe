import {
  UnsupportedServiceError,
  applyCorsProxy,
  type OrthoGeaLayer
} from "@orthogea/core";
import { formatAttribution, type AttributionOptions } from "../attribution.js";
import type { AdapterOptions } from "../types.js";
import { buildXyzTileUrls } from "../wmts/url.js";

export interface OpenLayersAdapterOptions extends AdapterOptions {
  attribution?: AttributionOptions | false;
  crossOrigin?: string | null;
  /** Vendor hint OpenLayers uses to build GetFeatureInfo requests. */
  serverType?: "geoserver" | "mapserver" | "qgis" | "carmentaserver";
}

/** Options for `new ol.source.TileWMS(...)`. */
export interface OpenLayersWmsSource {
  kind: "TileWMS";
  url: string;
  params: Record<string, string | number | boolean>;
  serverType?: string;
  crossOrigin?: string | null;
  attributions?: string;
  transition: number;
}

/** Options for `new ol.source.XYZ(...)`. */
export interface OpenLayersXyzSource {
  kind: "XYZ";
  urls: string[];
  tileSize: number;
  minZoom: number;
  maxZoom: number;
  crossOrigin?: string | null;
  attributions?: string;
}

/**
 * Options for `new ol.source.WMTS(...)`. The `tileGrid` must be built by the
 * host application, because it depends on the OpenLayers projection instance.
 */
export interface OpenLayersWmtsSource {
  kind: "WMTS";
  url: string;
  layer: string;
  matrixSet: string;
  format: string;
  style: string;
  requestEncoding: "KVP" | "REST";
  projection: string;
  dimensions?: Record<string, string>;
  crossOrigin?: string | null;
  attributions?: string;
}

export type OpenLayersSource =
  | OpenLayersWmsSource
  | OpenLayersXyzSource
  | OpenLayersWmtsSource;

function attributionFor(
  layer: OrthoGeaLayer,
  options: OpenLayersAdapterOptions
): string | undefined {
  return options.attribution === false
    ? undefined
    : formatAttribution(layer, options.attribution ?? {});
}

/**
 * Describes a WMS layer as `TileWMS` options.
 *
 * OpenLayers computes `BBOX`, `WIDTH`, `HEIGHT` and the axis order itself from
 * the view projection, so only the identifying parameters are provided here.
 */
export function toOpenLayersWmsSource(
  layer: OrthoGeaLayer,
  options: OpenLayersAdapterOptions = {}
): OpenLayersWmsSource {
  if (layer.service.type !== "WMS") {
    throw new UnsupportedServiceError(
      `Layer "${layer.id}" is a ${layer.service.type} service, not WMS`
    );
  }
  const wms = layer.service;
  return {
    kind: "TileWMS",
    url: applyCorsProxy(wms.url, options.proxyUrl),
    params: {
      LAYERS: wms.options.layers.join(","),
      STYLES: wms.options.styles.join(","),
      FORMAT: wms.options.format,
      TRANSPARENT: wms.options.transparent,
      VERSION: wms.options.version,
      TILED: true,
      ...(wms.options.time ? { TIME: wms.options.time } : {}),
      ...wms.options.extraParams,
      ...options.extraParams
    },
    serverType: options.serverType,
    crossOrigin: options.crossOrigin ?? "anonymous",
    attributions: attributionFor(layer, options),
    transition: 200
  };
}

/** Describes an XYZ layer as `XYZ` source options. */
export function toOpenLayersXyzSource(
  layer: OrthoGeaLayer,
  options: OpenLayersAdapterOptions = {}
): OpenLayersXyzSource {
  if (layer.service.type !== "XYZ") {
    throw new UnsupportedServiceError(
      `Layer "${layer.id}" is a ${layer.service.type} service, not XYZ`
    );
  }
  return {
    kind: "XYZ",
    urls: buildXyzTileUrls(layer.service, options),
    tileSize: options.tileSize ?? layer.service.options.tileSize,
    minZoom: layer.minZoom,
    maxZoom: layer.maxZoom,
    crossOrigin: options.crossOrigin ?? "anonymous",
    attributions: attributionFor(layer, options)
  };
}

/** Describes a WMTS layer as `WMTS` source options, minus the tile grid. */
export function toOpenLayersWmtsSource(
  layer: OrthoGeaLayer,
  options: OpenLayersAdapterOptions = {}
): OpenLayersWmtsSource {
  if (layer.service.type !== "WMTS") {
    throw new UnsupportedServiceError(
      `Layer "${layer.id}" is a ${layer.service.type} service, not WMTS`
    );
  }
  const wmts = layer.service;
  return {
    kind: "WMTS",
    url: applyCorsProxy(
      wmts.options.requestEncoding === "REST" && wmts.options.urlTemplate
        ? wmts.options.urlTemplate
        : wmts.url,
      options.proxyUrl
    ),
    layer: wmts.options.layer,
    matrixSet: wmts.options.tileMatrixSet,
    format: wmts.options.format,
    style: wmts.options.style,
    requestEncoding: wmts.options.requestEncoding,
    projection: wmts.options.crs,
    dimensions: wmts.options.dimensions,
    crossOrigin: options.crossOrigin ?? "anonymous",
    attributions: attributionFor(layer, options)
  };
}

/** Picks the right OpenLayers source descriptor for any raster layer. */
export function toOpenLayersSource(
  layer: OrthoGeaLayer,
  options: OpenLayersAdapterOptions = {}
): OpenLayersSource {
  switch (layer.service.type) {
    case "WMS":
      return toOpenLayersWmsSource(layer, options);
    case "WMTS":
      return toOpenLayersWmtsSource(layer, options);
    case "XYZ":
      return toOpenLayersXyzSource(layer, options);
    default:
      throw new UnsupportedServiceError(
        `Layer "${layer.id}" is a ${layer.service.type} service and has no OpenLayers raster source`
      );
  }
}

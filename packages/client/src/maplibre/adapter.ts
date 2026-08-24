import {
  UnsupportedServiceError,
  WEB_MERCATOR_BBOX,
  clampBBox,
  type OrthoGeaLayer
} from "@orthogea/core";
import { formatAttribution, type AttributionOptions } from "../attribution.js";
import type {
  AdapterOptions,
  RasterLayerSpecification,
  RasterSourceSpecification
} from "../types.js";
import { buildWmsTileUrlTemplate, type WmsRequestOptions } from "../wms/url.js";
import { buildWmtsTileUrlTemplate, buildXyzTileUrls, type WmtsRequestOptions } from "../wmts/url.js";
import { needsTileReprojection, protocolTileTemplate } from "./protocol.js";

export interface ToRasterSourceOptions
  extends AdapterOptions,
    WmsRequestOptions,
    WmtsRequestOptions {
  attribution?: AttributionOptions | false;
  /**
   * What to do with WMS services that do not publish EPSG:3857, which
   * MapLibre's `{bbox-epsg-3857}` placeholder requires.
   *
   * `auto` (default) emits an `orthogea://` tile template served by
   * {@link createOrthoGeaProtocol}, which requests the tile extent in a
   * geographic CRS the service does support. `off` raises instead.
   */
  reprojection?: "auto" | "off";
}

/** Deterministic MapLibre source id for a catalogue layer. */
export function sourceIdFor(layer: OrthoGeaLayer): string {
  return `orthogea-${layer.id}`;
}

/** Deterministic MapLibre layer id for a catalogue layer. */
export function layerIdFor(layer: OrthoGeaLayer): string {
  return `orthogea-${layer.id}-raster`;
}

/**
 * Converts a catalogue layer into a MapLibre GL raster source.
 *
 * WMS layers become a tiled `GetMap` template in EPSG:3857, WMTS layers a KVP
 * or REST tile template, XYZ layers a plain template with the subdomains
 * expanded. Vector (WFS) and COG layers have no raster equivalent and raise
 * {@link UnsupportedServiceError}.
 */
export function toRasterSource(
  layer: OrthoGeaLayer,
  options: ToRasterSourceOptions = {}
): RasterSourceSpecification {
  const attribution =
    options.attribution === false
      ? undefined
      : formatAttribution(layer, options.attribution ?? {});

  const source: RasterSourceSpecification = {
    type: "raster",
    // MapLibre rejects bounds outside the Web Mercator domain.
    bounds: clampBBox(layer.bbox, WEB_MERCATOR_BBOX),
    minzoom: layer.minZoom,
    maxzoom: layer.maxZoom,
    tileSize: options.tileSize ?? 256,
    attribution
  };

  switch (layer.service.type) {
    case "WMS": {
      if (needsTileReprojection(layer)) {
        if (options.reprojection === "off") {
          throw new UnsupportedServiceError(
            `Layer "${layer.id}" does not publish EPSG:3857 (only ${layer.service.options.crs.join(", ")}). ` +
              "Register createOrthoGeaProtocol() and drop reprojection: \"off\" to render it."
          );
        }
        return {
          ...source,
          tileSize: options.tileSize ?? layer.service.options.tileSize,
          tiles: [protocolTileTemplate(layer.id)]
        };
      }
      return {
        ...source,
        tileSize: options.tileSize ?? layer.service.options.tileSize,
        tiles: [buildWmsTileUrlTemplate(layer.service, options)]
      };
    }
    case "WMTS":
      return {
        ...source,
        tileSize: options.tileSize ?? layer.service.options.tileSize,
        tiles: [buildWmtsTileUrlTemplate(layer.service, options)]
      };
    case "XYZ":
      return {
        ...source,
        tileSize: options.tileSize ?? layer.service.options.tileSize,
        scheme: layer.service.options.scheme,
        tiles: buildXyzTileUrls(layer.service, options)
      };
    case "WFS":
      throw new UnsupportedServiceError(
        `Layer "${layer.id}" is a WFS service: use toGeoJsonUrl() and a GeoJSON source instead`
      );
    case "COG":
      throw new UnsupportedServiceError(
        `Layer "${layer.id}" is a Cloud Optimized GeoTIFF: MapLibre needs a tiling service or a COG protocol plugin`
      );
    default: {
      const exhaustive: never = layer.service;
      throw new UnsupportedServiceError(`Unsupported service: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export interface ToRasterLayerOptions {
  id?: string;
  sourceId?: string;
  opacity?: number;
  visible?: boolean;
  minzoom?: number;
  maxzoom?: number;
  resampling?: "linear" | "nearest";
}

/** Converts a catalogue layer into a MapLibre GL raster style layer. */
export function toRasterLayer(
  layer: OrthoGeaLayer,
  options: ToRasterLayerOptions = {}
): RasterLayerSpecification {
  const spec: RasterLayerSpecification = {
    id: options.id ?? layerIdFor(layer),
    type: "raster",
    source: options.sourceId ?? sourceIdFor(layer),
    minzoom: options.minzoom ?? layer.minZoom,
    // No maxzoom on purpose: on a style layer it *hides* the layer above that
    // zoom, which is why an orthophoto used to vanish when zooming right in.
    // The data limit belongs to the source, where MapLibre overzooms instead.
    ...(options.maxzoom === undefined ? {} : { maxzoom: options.maxzoom }),
    layout: { visibility: options.visible === false ? "none" : "visible" },
    paint: {
      "raster-opacity": options.opacity ?? 1,
      "raster-fade-duration": 200
    }
  };
  if (options.resampling && spec.paint) spec.paint["raster-resampling"] = options.resampling;
  return spec;
}

export interface MapLibreBinding {
  sourceId: string;
  layerId: string;
  source: RasterSourceSpecification;
  layer: RasterLayerSpecification;
}

/**
 * One-call conversion returning the ids, the source and the style layer, ready
 * for `map.addSource()` / `map.addLayer()`.
 */
export function toMapLibreBinding(
  layer: OrthoGeaLayer,
  options: ToRasterSourceOptions & ToRasterLayerOptions = {}
): MapLibreBinding {
  const sourceId = options.sourceId ?? sourceIdFor(layer);
  return {
    sourceId,
    layerId: options.id ?? layerIdFor(layer),
    source: toRasterSource(layer, options),
    layer: toRasterLayer(layer, {
      id: options.id,
      sourceId,
      opacity: options.opacity,
      visible: options.visible,
      minzoom: options.minzoom,
      maxzoom: options.maxzoom,
      resampling: options.resampling
    })
  };
}

export interface StyleSpecificationLike {
  version: 8;
  name?: string;
  sources: Record<string, RasterSourceSpecification>;
  layers: RasterLayerSpecification[];
  glyphs?: string;
  sprite?: string;
}

/**
 * Builds a complete MapLibre style from catalogue layers, in the given draw
 * order. Useful to boot a map without hand-writing a style document.
 */
export function toStyleSpecification(
  layers: readonly OrthoGeaLayer[],
  options: ToRasterSourceOptions & { name?: string; visibleIds?: readonly string[] } = {}
): StyleSpecificationLike {
  const { name, visibleIds, ...sourceOptions } = options;
  const sources: Record<string, RasterSourceSpecification> = {};
  const styleLayers: RasterLayerSpecification[] = [];

  for (const layer of layers) {
    const binding = toMapLibreBinding(layer, {
      ...sourceOptions,
      visible: visibleIds ? visibleIds.includes(layer.id) : true
    });
    sources[binding.sourceId] = binding.source;
    styleLayers.push(binding.layer);
  }

  return {
    version: 8,
    name: name ?? "OrthoGea - Europe",
    sources,
    layers: styleLayers
  };
}

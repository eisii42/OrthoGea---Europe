import type { OrthoGeaLayer } from "./schemas/layer.js";
import type {
  CogService,
  Service,
  WfsService,
  WmsService,
  WmtsService,
  XyzService
} from "./schemas/service.js";

export const isWmsService = (service: Service): service is WmsService => service.type === "WMS";
export const isWmtsService = (service: Service): service is WmtsService => service.type === "WMTS";
export const isXyzService = (service: Service): service is XyzService => service.type === "XYZ";
export const isWfsService = (service: Service): service is WfsService => service.type === "WFS";
export const isCogService = (service: Service): service is CogService => service.type === "COG";

/** Layer bound to a specific service type, narrowed for safe option access. */
export type LayerWithService<T extends Service["type"]> = OrthoGeaLayer & {
  service: Extract<Service, { type: T }>;
};

export const isWmsLayer = (layer: OrthoGeaLayer): layer is LayerWithService<"WMS"> =>
  layer.service.type === "WMS";
export const isWmtsLayer = (layer: OrthoGeaLayer): layer is LayerWithService<"WMTS"> =>
  layer.service.type === "WMTS";
export const isXyzLayer = (layer: OrthoGeaLayer): layer is LayerWithService<"XYZ"> =>
  layer.service.type === "XYZ";
export const isWfsLayer = (layer: OrthoGeaLayer): layer is LayerWithService<"WFS"> =>
  layer.service.type === "WFS";
export const isCogLayer = (layer: OrthoGeaLayer): layer is LayerWithService<"COG"> =>
  layer.service.type === "COG";

/** True when the layer can answer feature queries (GetFeatureInfo / GetFeature). */
export function isQueryableLayer(layer: OrthoGeaLayer): boolean {
  switch (layer.service.type) {
    case "WMS":
    case "WMTS":
      return layer.service.options.queryable;
    case "WFS":
      return true;
    default:
      return false;
  }
}

/** GetFeatureInfo MIME types declared for the layer, best first. */
export function layerInfoFormats(layer: OrthoGeaLayer): string[] {
  switch (layer.service.type) {
    case "WMS":
    case "WMTS":
      return [...layer.service.options.infoFormats];
    case "WFS":
      return [layer.service.options.outputFormat];
    default:
      return [];
  }
}

/** True when the layer is a raster source that a map renderer can display. */
export function isRasterLayer(layer: OrthoGeaLayer): boolean {
  return layer.service.type !== "WFS";
}

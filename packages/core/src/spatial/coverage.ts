import type { OrthoGeaLayer } from "../schemas/layer.js";
import type { GeoBoundingBox } from "../schemas/bbox.js";
import {
  bboxAreaSqKm,
  bboxContainsBBox,
  bboxContainsPoint,
  bboxIntersects
} from "./bbox.js";

/** True when the coordinate falls inside the layer extent. */
export function layerCoversPoint(layer: OrthoGeaLayer, lng: number, lat: number): boolean {
  return bboxContainsPoint(layer.bbox, lng, lat);
}

/** True when the layer extent fully contains the given box. */
export function layerCoversBBox(layer: OrthoGeaLayer, bbox: GeoBoundingBox): boolean {
  return bboxContainsBBox(layer.bbox, bbox);
}

/** True when the layer extent overlaps the given box at all. */
export function layerIntersectsBBox(layer: OrthoGeaLayer, bbox: GeoBoundingBox): boolean {
  return bboxIntersects(layer.bbox, bbox);
}

/** True when the zoom level is inside the layer's declared range. */
export function isLayerVisibleAtZoom(layer: OrthoGeaLayer, zoom: number): boolean {
  return zoom >= layer.minZoom && zoom <= layer.maxZoom;
}

export interface CoverageQuery {
  lng: number;
  lat: number;
  zoom?: number;
  category?: OrthoGeaLayer["category"];
  /** Skip layers that are not `active`. */
  activeOnly?: boolean;
}

/**
 * Layers covering a coordinate, most local first: the smaller the extent, the
 * more detailed the source usually is (municipal > regional > national > EU).
 */
export function rankLayersForPoint(
  layers: readonly OrthoGeaLayer[],
  query: CoverageQuery
): OrthoGeaLayer[] {
  const { lng, lat, zoom, category, activeOnly = true } = query;
  return layers
    .filter((layer) => {
      if (activeOnly && layer.status !== "active") return false;
      if (category && layer.category !== category) return false;
      if (zoom !== undefined && !isLayerVisibleAtZoom(layer, zoom)) return false;
      return layerCoversPoint(layer, lng, lat);
    })
    .sort((a, b) => bboxAreaSqKm(a.bbox) - bboxAreaSqKm(b.bbox));
}

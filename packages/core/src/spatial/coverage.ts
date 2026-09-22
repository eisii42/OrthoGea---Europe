import type { OrthoGeaLayer } from "../schemas/layer.js";
import type { GeoBoundingBox } from "../schemas/bbox.js";
import {
  bboxAreaSqKm,
  bboxContainsBBox,
  bboxContainsPoint,
  bboxIntersects
} from "./bbox.js";

/**
 * The boxes describing where a layer holds imagery.
 *
 * `coverage` when the record narrows its advertised hull, otherwise the single
 * `bbox`. Everything that asks "is this ground covered" goes through here, so
 * the catalogue, the ranking and the mosaic cannot drift apart on the answer.
 */
export function layerExtents(layer: OrthoGeaLayer): readonly GeoBoundingBox[] {
  return layer.coverage ?? [layer.bbox];
}

/**
 * Ground the layer covers, in square kilometres.
 *
 * This is what "most local first" ranks on, so a record that narrows its hull
 * is also ranked by the narrowed area rather than by the hull it corrects.
 */
export function layerAreaSqKm(layer: OrthoGeaLayer): number {
  return layerExtents(layer).reduce((total, box) => total + bboxAreaSqKm(box), 0);
}

/** True when the coordinate falls inside the layer extent. */
export function layerCoversPoint(layer: OrthoGeaLayer, lng: number, lat: number): boolean {
  return layerExtents(layer).some((box) => bboxContainsPoint(box, lng, lat));
}

/** True when the layer extent fully contains the given box. */
export function layerCoversBBox(layer: OrthoGeaLayer, bbox: GeoBoundingBox): boolean {
  return layerExtents(layer).some((box) => bboxContainsBBox(box, bbox));
}

/** True when the layer extent overlaps the given box at all. */
export function layerIntersectsBBox(layer: OrthoGeaLayer, bbox: GeoBoundingBox): boolean {
  return layerExtents(layer).some((box) => bboxIntersects(box, bbox));
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
    .sort((a, b) => layerAreaSqKm(a) - layerAreaSqKm(b));
}

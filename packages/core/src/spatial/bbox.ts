import { getAxisOrder, type WmsVersion } from "../crs/normalize.js";
import {
  GeoBoundingBoxSchema,
  WORLD_BBOX,
  type GeoBoundingBox,
  type ProjectedBoundingBox
} from "../schemas/bbox.js";

/** Runtime guard for a well-formed geographic bounding box. */
export function isValidBBox(value: unknown): value is GeoBoundingBox {
  return GeoBoundingBoxSchema.safeParse(value).success;
}

/** Sorts the corners and clamps them to the valid WGS84 domain. */
export function normalizeBBox(bbox: readonly number[]): GeoBoundingBox {
  const [a = 0, b = 0, c = 0, d = 0] = bbox;
  const minLng = Math.max(-180, Math.min(a, c));
  const maxLng = Math.min(180, Math.max(a, c));
  const minLat = Math.max(-90, Math.min(b, d));
  const maxLat = Math.min(90, Math.max(b, d));
  return [minLng, minLat, maxLng, maxLat];
}

/** True when the coordinate falls inside (or on the edge of) the box. */
export function bboxContainsPoint(
  bbox: GeoBoundingBox,
  lng: number,
  lat: number
): boolean {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  if (lat < minLat || lat > maxLat) return false;
  if (minLng <= maxLng) return lng >= minLng && lng <= maxLng;
  // Antimeridian-crossing box: valid on either side of +/-180.
  return lng >= minLng || lng <= maxLng;
}

/** True when `inner` is fully contained in `outer`. */
export function bboxContainsBBox(outer: GeoBoundingBox, inner: GeoBoundingBox): boolean {
  return (
    bboxContainsPoint(outer, inner[0], inner[1]) &&
    bboxContainsPoint(outer, inner[2], inner[3])
  );
}

/** True when the two boxes share at least one point. */
export function bboxIntersects(a: GeoBoundingBox, b: GeoBoundingBox): boolean {
  if (a[1] > b[3] || b[1] > a[3]) return false;
  return a[0] <= b[2] && b[0] <= a[2];
}

/** Overlapping area of two boxes, or `null` when they are disjoint. */
export function bboxIntersection(
  a: GeoBoundingBox,
  b: GeoBoundingBox
): GeoBoundingBox | null {
  if (!bboxIntersects(a, b)) return null;
  return [
    Math.max(a[0], b[0]),
    Math.max(a[1], b[1]),
    Math.min(a[2], b[2]),
    Math.min(a[3], b[3])
  ];
}

/** Smallest box enclosing every input box. */
export function bboxUnion(...boxes: GeoBoundingBox[]): GeoBoundingBox {
  const first = boxes[0];
  if (!first) return [...WORLD_BBOX];
  return boxes.reduce<GeoBoundingBox>(
    (acc, box) => [
      Math.min(acc[0], box[0]),
      Math.min(acc[1], box[1]),
      Math.max(acc[2], box[2]),
      Math.max(acc[3], box[3])
    ],
    [...first]
  );
}

/** Centre point of the box as `[lng, lat]`. */
export function bboxCenter(bbox: GeoBoundingBox): [number, number] {
  return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
}

/** Width of the box in degrees of longitude. */
export function bboxWidth(bbox: GeoBoundingBox): number {
  return bbox[0] <= bbox[2] ? bbox[2] - bbox[0] : 360 - bbox[0] + bbox[2];
}

/** Height of the box in degrees of latitude. */
export function bboxHeight(bbox: GeoBoundingBox): number {
  return bbox[3] - bbox[1];
}

/** Approximate ground area of the box in square kilometres. */
export function bboxAreaSqKm(bbox: GeoBoundingBox): number {
  const meanLat = ((bbox[1] + bbox[3]) / 2) * (Math.PI / 180);
  const kmPerDegLat = 111.32;
  const kmPerDegLng = 111.32 * Math.cos(meanLat);
  return bboxWidth(bbox) * kmPerDegLng * bboxHeight(bbox) * kmPerDegLat;
}

/** Grows the box by `margin` degrees on every side (negative shrinks it). */
export function expandBBox(bbox: GeoBoundingBox, margin: number): GeoBoundingBox {
  return normalizeBBox([
    bbox[0] - margin,
    bbox[1] - margin,
    bbox[2] + margin,
    bbox[3] + margin
  ]);
}

/** Restricts a box to the extent of another one. */
export function clampBBox(bbox: GeoBoundingBox, bounds: GeoBoundingBox): GeoBoundingBox {
  return [
    Math.max(bbox[0], bounds[0]),
    Math.max(bbox[1], bounds[1]),
    Math.min(bbox[2], bounds[2]),
    Math.min(bbox[3], bounds[3])
  ];
}

/** Smallest box enclosing a list of `[lng, lat]` positions. */
export function bboxFromPositions(
  positions: readonly (readonly [number, number])[]
): GeoBoundingBox {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of positions) {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLng, minLat, maxLng, maxLat];
}

/** GeoJSON polygon ring for the box, useful for previews and masks. */
export function bboxToPolygon(bbox: GeoBoundingBox): {
  type: "Polygon";
  coordinates: [number, number][][];
} {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  return {
    type: "Polygon",
    coordinates: [
      [
        [minLng, minLat],
        [maxLng, minLat],
        [maxLng, maxLat],
        [minLng, maxLat],
        [minLng, minLat]
      ]
    ]
  };
}

/**
 * Reorders a `[minX, minY, maxX, maxY]` tuple into the axis order the service
 * expects. For latitude-first CRS in WMS 1.3.0/WMTS the result becomes
 * `[minY, minX, maxY, maxX]`. The operation is its own inverse.
 */
export function orderBBoxForCrs(
  bbox: GeoBoundingBox | ProjectedBoundingBox,
  crs: string,
  wmsVersion?: WmsVersion
): [number, number, number, number] {
  if (getAxisOrder(crs, wmsVersion) === "latlon") {
    return [bbox[1], bbox[0], bbox[3], bbox[2]];
  }
  return [bbox[0], bbox[1], bbox[2], bbox[3]];
}

export interface FormatBBoxOptions {
  crs?: string;
  wmsVersion?: WmsVersion;
  /** Decimal digits kept in the output; omit to keep full precision. */
  precision?: number;
  separator?: string;
}

/**
 * Serialises a bounding box for a `BBOX=` query parameter, honouring the axis
 * order rules of the target CRS and protocol version.
 */
export function formatBBox(
  bbox: GeoBoundingBox | ProjectedBoundingBox,
  options: FormatBBoxOptions = {}
): string {
  const { crs = "EPSG:4326", wmsVersion, precision, separator = "," } = options;
  const ordered = orderBBoxForCrs(bbox, crs, wmsVersion);
  return ordered
    .map((value) => (precision === undefined ? String(value) : value.toFixed(precision)))
    .join(separator);
}

/**
 * Parses a `BBOX=` string back into `[minX, minY, maxX, maxY]` order,
 * undoing the axis order of the source CRS/protocol version.
 */
export function parseBBox(
  value: string,
  options: { crs?: string; wmsVersion?: WmsVersion } = {}
): [number, number, number, number] | undefined {
  const parts = value
    .split(",")
    .map((part) => Number.parseFloat(part.trim()))
    .filter((part) => Number.isFinite(part));
  if (parts.length < 4) return undefined;
  const [a, b, c, d] = parts as [number, number, number, number];
  return orderBBoxForCrs([a, b, c, d], options.crs ?? "EPSG:4326", options.wmsVersion);
}

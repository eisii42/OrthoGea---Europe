import type { GeoBoundingBox, ProjectedBoundingBox } from "../schemas/bbox.js";

/** Semi-major axis of the sphere used by EPSG:3857 (metres). */
export const EARTH_RADIUS = 6378137;

/** Half of the EPSG:3857 world extent (metres). */
export const MERCATOR_HALF_WORLD = Math.PI * EARTH_RADIUS; // 20037508.342789244

/** Latitude beyond which EPSG:3857 is undefined. */
export const MAX_MERCATOR_LATITUDE = 85.0511287798066;

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/** Projects a WGS84 longitude/latitude pair to EPSG:3857 metres. */
export function lngLatToMercator(lng: number, lat: number): [number, number] {
  const clampedLat = clamp(lat, -MAX_MERCATOR_LATITUDE, MAX_MERCATOR_LATITUDE);
  const x = EARTH_RADIUS * lng * DEG_TO_RAD;
  const y = EARTH_RADIUS * Math.atanh(Math.sin(clampedLat * DEG_TO_RAD));
  return [x, y];
}

/** Inverse of {@link lngLatToMercator}. */
export function mercatorToLngLat(x: number, y: number): [number, number] {
  const lng = (x / EARTH_RADIUS) * RAD_TO_DEG;
  const lat = Math.asin(Math.tanh(y / EARTH_RADIUS)) * RAD_TO_DEG;
  return [lng, lat];
}

/** Projects a geographic bounding box to EPSG:3857 metres. */
export function bboxToMercator(bbox: GeoBoundingBox): ProjectedBoundingBox {
  const [minX, minY] = lngLatToMercator(bbox[0], bbox[1]);
  const [maxX, maxY] = lngLatToMercator(bbox[2], bbox[3]);
  return [minX, minY, maxX, maxY];
}

/** Converts an EPSG:3857 bounding box back to WGS84 degrees. */
export function bboxFromMercator(bbox: ProjectedBoundingBox): GeoBoundingBox {
  const [minLng, minLat] = mercatorToLngLat(bbox[0], bbox[1]);
  const [maxLng, maxLat] = mercatorToLngLat(bbox[2], bbox[3]);
  return [minLng, minLat, maxLng, maxLat];
}

/** Ground resolution (metres per pixel) of a slippy-map zoom level. */
export function metersPerPixel(zoom: number, tileSize = 256): number {
  return (2 * MERCATOR_HALF_WORLD) / (tileSize * Math.pow(2, zoom));
}

/** Nearest slippy-map zoom level for a target ground resolution. */
export function zoomFromMetersPerPixel(resolution: number, tileSize = 256): number {
  return Math.log2((2 * MERCATOR_HALF_WORLD) / (tileSize * resolution));
}

/** EPSG:3857 extent of an XYZ/WMTS tile in the Google/OSM tile scheme. */
export function tileToMercatorBBox(x: number, y: number, z: number): ProjectedBoundingBox {
  const size = (2 * MERCATOR_HALF_WORLD) / Math.pow(2, z);
  const minX = -MERCATOR_HALF_WORLD + x * size;
  const maxY = MERCATOR_HALF_WORLD - y * size;
  return [minX, maxY - size, minX + size, maxY];
}

/** WGS84 extent of an XYZ/WMTS tile in the Google/OSM tile scheme. */
export function tileToBBox(x: number, y: number, z: number): GeoBoundingBox {
  return bboxFromMercator(tileToMercatorBBox(x, y, z));
}

/** XYZ tile containing a coordinate at the given zoom. */
export function lngLatToTile(lng: number, lat: number, z: number): [number, number] {
  const scale = Math.pow(2, z);
  const clampedLat = clamp(lat, -MAX_MERCATOR_LATITUDE, MAX_MERCATOR_LATITUDE);
  const x = Math.floor(((lng + 180) / 360) * scale);
  const sin = Math.sin(clampedLat * DEG_TO_RAD);
  const y = Math.floor((0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale);
  return [clamp(x, 0, scale - 1), clamp(y, 0, scale - 1)];
}

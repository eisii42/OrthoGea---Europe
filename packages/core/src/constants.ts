/**
 * Plain values shared across the framework.
 *
 * They live apart from the schemas on purpose. Validation is a build-time and
 * catalogue-authoring concern, so `@orthogea/core` keeps Zod behind the
 * `@orthogea/core/schemas` entry and the drawing path - the code a web-GIS
 * actually ships - stays free of it. Anything here is a constant a renderer
 * needs at runtime.
 */

import type { GeoBoundingBox } from "./schemas/bbox.js";

/** Whole-world extent in WGS84 degrees. */
export const WORLD_BBOX: GeoBoundingBox = [-180, -90, 180, 90];

/** Extent covered by EPSG:3857, in WGS84 degrees. */
export const WEB_MERCATOR_BBOX: GeoBoundingBox = [-180, -85.0511287798066, 180, 85.0511287798066];

/** Raster MIME types frequently advertised by European services. */
export const IMAGE_FORMATS = [
  "image/png",
  "image/png8",
  "image/png; mode=8bit",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/tiff",
  "image/vnd.jpeg-png"
] as const;

/** MIME types accepted by GetFeatureInfo responses. */
export const INFO_FORMATS = [
  "application/json",
  "application/geo+json",
  "application/vnd.ogc.gml",
  "application/vnd.ogc.gml/3.1.1",
  "text/xml",
  "text/html",
  "text/plain"
] as const;

/** Pseudo-code used by pan-European datasets (Copernicus, EEA, Eurostat). */
export const EU_WIDE_CODE = "EU";

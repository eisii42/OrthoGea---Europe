import { z } from "zod";

const LongitudeSchema = z.number().finite().min(-180).max(180);
const LatitudeSchema = z.number().finite().min(-90).max(90);

/**
 * Geographic bounding box in WGS84 degrees, always
 * `[minLng, minLat, maxLng, maxLat]` (GeoJSON / CRS:84 order).
 */
export const GeoBoundingBoxSchema = z
  .tuple([LongitudeSchema, LatitudeSchema, LongitudeSchema, LatitudeSchema])
  .describe("[minLng, minLat, maxLng, maxLat] in WGS84 degrees")
  .refine((bbox) => bbox[1] <= bbox[3], {
    message: "minLat must be lower than or equal to maxLat"
  })
  .refine((bbox) => bbox[0] <= bbox[2] || bbox[0] > 0, {
    // minLng > maxLng is only tolerated for boxes crossing the antimeridian.
    message: "minLng must be lower than or equal to maxLng"
  });

export type GeoBoundingBox = [number, number, number, number];

/** Bounding box expressed in a projected CRS, `[minX, minY, maxX, maxY]`. */
export const ProjectedBoundingBoxSchema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
  z.number().finite()
]);

export type ProjectedBoundingBox = [number, number, number, number];

/** A projected bounding box together with the CRS it is expressed in. */
export const CrsBoundingBoxSchema = z.object({
  crs: z.string().min(1),
  bbox: ProjectedBoundingBoxSchema
});

export type CrsBoundingBox = z.infer<typeof CrsBoundingBoxSchema>;

/** Whole-world extent in WGS84 degrees. */
export const WORLD_BBOX: GeoBoundingBox = [-180, -90, 180, 90];

/** Extent covered by EPSG:3857, in WGS84 degrees. */
export const WEB_MERCATOR_BBOX: GeoBoundingBox = [
  -180, -85.0511287798066, 180, 85.0511287798066
];

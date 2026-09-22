import { z } from "zod";
import { EU_WIDE_CODE } from "../constants.js";
import { nutsCountry, nutsToIso } from "../nuts/index.js";
import { CountryCodeSchema, NutsCodeSchema } from "./nuts.js";
import { GeoBoundingBoxSchema } from "./bbox.js";
import {
  LayerCategorySchema,
  LayerStatusSchema,
  LicenseSchema,
  ProviderSchema
} from "./enums.js";
import { ServiceSchema } from "./service.js";

/** Stable, dot-separated identifier, e.g. `it.toscana.ortofoto-2023`. */
export const LayerIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:[-.][a-z0-9]+)*$/, {
    error: "ids are lowercase and dot/dash separated, e.g. it.toscana.ortofoto-2023"
  })
  .min(3)
  .max(120);
export type LayerId = z.infer<typeof LayerIdSchema>;

const IsoDateSchema = z
  .string()
  .regex(/^\d{4}(-\d{2}(-\d{2})?)?$/, { error: "use YYYY, YYYY-MM or YYYY-MM-DD" });

/** Acquisition period covered by the data. */
export const TemporalExtentSchema = z.object({
  start: IsoDateSchema.optional(),
  end: IsoDateSchema.optional()
});
export type TemporalExtent = z.infer<typeof TemporalExtentSchema>;

/**
 * A single renderable geodata layer: what it is, who publishes it, where it
 * applies, how to request it and under which licence it may be shown.
 */
export const OrthoGeaLayerSchema = z
  .object({
    id: LayerIdSchema,
    title: z.string().min(2),
    description: z.string().optional(),
    category: LayerCategorySchema,
    provider: ProviderSchema,
    /** ISO 3166-1 alpha-2 code, or `EU` for pan-European datasets. */
    country: CountryCodeSchema,
    /** Most specific NUTS code covered, e.g. `ITI1` for Toscana. */
    nuts: NutsCodeSchema.optional(),
    /** Local-language name of the covered area, e.g. `Toscana`. */
    regionName: z.string().optional(),
    bbox: GeoBoundingBoxSchema,
    /**
     * Boxes approximating the ground the service actually holds imagery for.
     *
     * `bbox` is the extent the service advertises, and for any region that is
     * not a rectangle it is the bounding hull - which overhangs into the
     * neighbours. The hull of Emilia-Romagna reaches south past Florence, so a
     * point in Tuscany looks covered by a Tuscany-less service. `bbox` stays
     * the hull, because that is what a `GetMap` is framed against; `coverage`
     * is what containment and ranking use when it is present.
     *
     * Every box must lie inside `bbox`: this narrows the extent, never widens
     * it. Leave it out when the hull is already a fair description.
     */
    coverage: z.array(GeoBoundingBoxSchema).min(1).optional(),
    service: ServiceSchema,
    license: LicenseSchema,
    /** Attribution string rendered by the map control. */
    attribution: z.string().min(2),
    minZoom: z.number().int().min(0).max(24).default(0),
    maxZoom: z.number().int().min(0).max(24).default(20),
    /** Ground sample distance in metres per pixel, when published. */
    resolutionMeters: z.number().positive().optional(),
    temporal: TemporalExtentSchema.optional(),
    tags: z.array(z.string().min(1)).default([]),
    status: LayerStatusSchema.default("active"),
    /** INSPIRE/CKAN metadata record. */
    metadataUrl: z.url().optional(),
    /** Human documentation, portal page or terms of use. */
    documentationUrl: z.url().optional(),
    /** Date the endpoint was last checked, `YYYY-MM-DD`. */
    lastVerified: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
  })
  .strict()
  .superRefine((layer, ctx) => {
    // `country` is ISO 3166-1 and `nuts` is NUTS, and the two disagree on
    // Greece (GR/EL) and the United Kingdom (GB/UK), so the codes are compared
    // through the conversion rather than as strings.
    if (layer.nuts && layer.country !== EU_WIDE_CODE) {
      const expected = nutsToIso(nutsCountry(layer.nuts));
      if (expected !== layer.country) {
        ctx.addIssue({
          code: "custom",
          path: ["nuts"],
          message:
            `NUTS code ${layer.nuts} belongs to ${expected ?? "an unknown country"}, ` +
            `not to ${layer.country}`
        });
      }
    }
    if (layer.minZoom > layer.maxZoom) {
      ctx.addIssue({
        code: "custom",
        path: ["minZoom"],
        message: "minZoom must be lower than or equal to maxZoom"
      });
    }
    // Coverage narrows the advertised extent. A box reaching outside `bbox`
    // would claim ground the service never offered, so it is rejected rather
    // than silently clipped.
    layer.coverage?.forEach((box, index) => {
      const [minLng, minLat, maxLng, maxLat] = layer.bbox;
      if (box[0] < minLng || box[1] < minLat || box[2] > maxLng || box[3] > maxLat) {
        ctx.addIssue({
          code: "custom",
          path: ["coverage", index],
          message: `coverage box [${box.join(", ")}] reaches outside bbox [${layer.bbox.join(", ")}]`
        });
      }
    });
  });

export type OrthoGeaLayer = z.infer<typeof OrthoGeaLayerSchema>;
/** Shape accepted by the parser, before defaults and CRS normalisation. */
export type OrthoGeaLayerInput = z.input<typeof OrthoGeaLayerSchema>;

/** A validated collection of layers, as stored in catalog JSON files. */
export const LayerCollectionSchema = z.object({
  $schema: z.string().optional(),
  /** Collection identifier, usually the NUTS code it covers. */
  scope: z.string().min(2),
  title: z.string().min(2),
  updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  layers: z.array(OrthoGeaLayerSchema)
});
export type LayerCollection = z.infer<typeof LayerCollectionSchema>;
export type LayerCollectionInput = z.input<typeof LayerCollectionSchema>;

/** Parses and validates a layer, throwing on the first problem. */
export function parseLayer(input: unknown): OrthoGeaLayer {
  return OrthoGeaLayerSchema.parse(input);
}

/** Non-throwing variant of {@link parseLayer}. */
export function safeParseLayer(input: unknown): z.ZodSafeParseResult<OrthoGeaLayer> {
  return OrthoGeaLayerSchema.safeParse(input);
}

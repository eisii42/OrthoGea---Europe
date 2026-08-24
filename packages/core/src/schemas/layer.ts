import { z } from "zod";
import { CountryCodeSchema, EU_WIDE_CODE, NutsCodeSchema, nutsCountry } from "../nuts/index.js";
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
    message: "ids are lowercase and dot/dash separated, e.g. it.toscana.ortofoto-2023"
  })
  .min(3)
  .max(120);
export type LayerId = z.infer<typeof LayerIdSchema>;

const IsoDateSchema = z
  .string()
  .regex(/^\d{4}(-\d{2}(-\d{2})?)?$/, { message: "use YYYY, YYYY-MM or YYYY-MM-DD" });

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
    /** NUTS-0 code, or `EU` for pan-European datasets. */
    country: CountryCodeSchema,
    /** Most specific NUTS code covered, e.g. `ITI1` for Toscana. */
    nuts: NutsCodeSchema.optional(),
    /** Local-language name of the covered area, e.g. `Toscana`. */
    regionName: z.string().optional(),
    bbox: GeoBoundingBoxSchema,
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
    metadataUrl: z.string().url().optional(),
    /** Human documentation, portal page or terms of use. */
    documentationUrl: z.string().url().optional(),
    /** Date the endpoint was last checked, `YYYY-MM-DD`. */
    lastVerified: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
  })
  .strict()
  .superRefine((layer, ctx) => {
    if (layer.nuts && layer.country !== EU_WIDE_CODE && nutsCountry(layer.nuts) !== layer.country) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nuts"],
        message: `NUTS code ${layer.nuts} does not belong to country ${layer.country}`
      });
    }
    if (layer.minZoom > layer.maxZoom) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minZoom"],
        message: "minZoom must be lower than or equal to maxZoom"
      });
    }
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
export function safeParseLayer(input: unknown): z.SafeParseReturnType<unknown, OrthoGeaLayer> {
  return OrthoGeaLayerSchema.safeParse(input);
}

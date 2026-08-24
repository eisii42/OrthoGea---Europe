import { z } from "zod";

/** Thematic family a layer belongs to. */
export const LayerCategorySchema = z.enum([
  "orthophoto",
  "satellite",
  "cadastre",
  "elevation",
  "land_use",
  "custom"
]);
export type LayerCategory = z.infer<typeof LayerCategorySchema>;

/** Transport protocol used to fetch the layer. */
export const ServiceTypeSchema = z.enum(["WMS", "WMTS", "XYZ", "WFS", "COG"]);
export type ServiceType = z.infer<typeof ServiceTypeSchema>;

/** WMS protocol versions handled by the harvester and the client. */
export const WmsVersionSchema = z.enum(["1.1.0", "1.1.1", "1.3.0"]);
export type WmsVersion = z.infer<typeof WmsVersionSchema>;

export const WmtsVersionSchema = z.enum(["1.0.0"]);
export type WmtsVersion = z.infer<typeof WmtsVersionSchema>;

export const WfsVersionSchema = z.enum(["1.0.0", "1.1.0", "2.0.0"]);
export type WfsVersion = z.infer<typeof WfsVersionSchema>;

export const ImageFormatSchema = z
  .string()
  .regex(/^image\/[a-z0-9+.\-]+(;\s*[a-z0-9\-]+=[a-z0-9\-]+)?$/i, {
    message: "must be an image MIME type such as image/png or image/jpeg"
  });
export type ImageFormat = z.infer<typeof ImageFormatSchema>;

export const InfoFormatSchema = z.string().min(3);
export type InfoFormat = z.infer<typeof InfoFormatSchema>;

/** Licences commonly attached to European open geodata. */
export const LicenseIdSchema = z.enum([
  "CC-BY-4.0",
  "CC-BY-SA-4.0",
  "CC-BY-3.0",
  "CC-BY-2.5",
  "CC0-1.0",
  "IODL-2.0",
  "IODL-1.0",
  "ODbL-1.0",
  "etalab-2.0",
  "etalab-1.0",
  "dl-de-by-2.0",
  "dl-de-zero-2.0",
  "OGL-3.0",
  "NLOD-2.0",
  "copernicus-free",
  "inspire-open",
  "proprietary",
  "custom",
  "unknown"
]);
export type LicenseId = z.infer<typeof LicenseIdSchema>;

export const LicenseSchema = z
  .object({
    id: LicenseIdSchema,
    /** Human readable label, required when `id` is `custom`. */
    name: z.string().min(2).optional(),
    url: z.string().url().optional(),
    /** Additional obligations, e.g. mandatory citation wording. */
    notes: z.string().optional()
  })
  .refine((license) => license.id !== "custom" || Boolean(license.name), {
    message: "custom licences must provide a name"
  });
export type License = z.infer<typeof LicenseSchema>;

/** Operational state of a catalogued layer. */
export const LayerStatusSchema = z.enum([
  "active",
  "experimental",
  "deprecated",
  "offline"
]);
export type LayerStatus = z.infer<typeof LayerStatusSchema>;

/** Organisation publishing the service. */
export const ProviderSchema = z.object({
  name: z.string().min(2),
  url: z.string().url().optional(),
  /** Short label used in map attributions, defaults to `name`. */
  shortName: z.string().min(1).optional()
});
export type Provider = z.infer<typeof ProviderSchema>;

import { z } from "zod";
import { normalizeCrs } from "../crs/normalize.js";
import {
  ImageFormatSchema,
  InfoFormatSchema,
  WfsVersionSchema,
  WmsVersionSchema,
  WmtsVersionSchema
} from "./enums.js";

/** Any CRS spelling, normalised to the canonical short code on parse. */
export const CrsCodeSchema = z
  .string()
  .min(3)
  .transform((value) => normalizeCrs(value));

export const TileSizeSchema = z.union([z.literal(256), z.literal(512)]);

/** Extra `KEY=value` pairs appended verbatim to every request. */
export const ExtraParamsSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));

const HttpUrlSchema = z
  .string()
  .url()
  .refine((url) => url.startsWith("http://") || url.startsWith("https://"), {
    message: "service URLs must use http(s)"
  });

/**
 * OGC Web Map Service options.
 *
 * `crs` lists the CRS advertised by the service; the first entry compatible
 * with the renderer is used. `version` drives axis-order handling
 * (`SRS=` in 1.1.1, `CRS=` in 1.3.0).
 */
export const WMSOptionsSchema = z.object({
  /** Value of the `LAYERS` parameter, in draw order. */
  layers: z.array(z.string().min(1)).min(1),
  /** Value of the `STYLES` parameter; empty strings select the default style. */
  styles: z.array(z.string()).default([]),
  format: ImageFormatSchema.default("image/png"),
  /** MIME types accepted by GetFeatureInfo, best first. */
  infoFormats: z.array(InfoFormatSchema).default([]),
  crs: z.array(CrsCodeSchema).min(1).default(["EPSG:3857"]),
  version: WmsVersionSchema.default("1.3.0"),
  queryable: z.boolean().default(false),
  transparent: z.boolean().default(true),
  tileSize: TileSizeSchema.default(256),
  /** Value of the `TIME` dimension, when the service is temporal. */
  time: z.string().optional(),
  /** Server-side maximum image size, used to keep GetMap requests legal. */
  maxWidth: z.number().int().positive().optional(),
  maxHeight: z.number().int().positive().optional(),
  extraParams: ExtraParamsSchema.optional()
});
export type WMSOptions = z.infer<typeof WMSOptionsSchema>;
export type WMSOptionsInput = z.input<typeof WMSOptionsSchema>;

/** OGC Web Map Tile Service options. */
export const WMTSOptionsSchema = z.object({
  layer: z.string().min(1),
  tileMatrixSet: z.string().min(1),
  style: z.string().default("default"),
  format: ImageFormatSchema.default("image/png"),
  version: WmtsVersionSchema.default("1.0.0"),
  requestEncoding: z.enum(["KVP", "REST"]).default("KVP"),
  /** RESTful template, required when `requestEncoding` is `REST`. */
  urlTemplate: z.string().min(1).optional(),
  crs: CrsCodeSchema.default("EPSG:3857"),
  tileSize: TileSizeSchema.default(256),
  /**
   * Template for the `TILEMATRIX` value when the matrix identifiers are not
   * plain zoom numbers. GeoWebCache, for instance, names them
   * `EPSG:900913:{z}`. Defaults to `{z}`.
   */
  tileMatrixTemplate: z.string().min(1).optional(),
  /** Extra WMTS dimensions such as `TIME` or `ELEVATION`. */
  dimensions: z.record(z.string(), z.string()).optional(),
  queryable: z.boolean().default(false),
  infoFormats: z.array(InfoFormatSchema).default([])
});
export type WMTSOptions = z.infer<typeof WMTSOptionsSchema>;

/** Plain slippy-map tile service. */
export const XYZOptionsSchema = z.object({
  /** Template containing `{x}`, `{y}` and `{z}` placeholders. */
  urlTemplate: z.string().min(1),
  scheme: z.enum(["xyz", "tms"]).default("xyz"),
  subdomains: z.array(z.string().min(1)).default([]),
  tileSize: TileSizeSchema.default(256),
  /** Query parameter carrying an API key, when the endpoint requires one. */
  apiKeyParam: z.string().optional()
});
export type XYZOptions = z.infer<typeof XYZOptionsSchema>;

/** OGC Web Feature Service options. */
export const WFSOptionsSchema = z.object({
  typeNames: z.array(z.string().min(1)).min(1),
  version: WfsVersionSchema.default("2.0.0"),
  outputFormat: z.string().default("application/json"),
  crs: CrsCodeSchema.default("EPSG:4326"),
  maxFeatures: z.number().int().positive().max(100000).optional(),
  extraParams: ExtraParamsSchema.optional()
});
export type WFSOptions = z.infer<typeof WFSOptionsSchema>;

/** Cloud Optimized GeoTIFF options. */
export const COGOptionsSchema = z.object({
  /** Direct URL of the `.tif`; ranges are fetched by the renderer. */
  url: HttpUrlSchema,
  bands: z.array(z.number().int().positive()).optional(),
  nodata: z.number().optional(),
  resampling: z.enum(["nearest", "bilinear", "cubic"]).default("nearest"),
  crs: CrsCodeSchema.default("EPSG:3857")
});
export type COGOptions = z.infer<typeof COGOptionsSchema>;

export const WmsServiceSchema = z.object({
  type: z.literal("WMS"),
  /** Base endpoint, without query string. */
  url: HttpUrlSchema,
  options: WMSOptionsSchema
});

export const WmtsServiceSchema = z.object({
  type: z.literal("WMTS"),
  url: HttpUrlSchema,
  options: WMTSOptionsSchema
});

export const XyzServiceSchema = z.object({
  type: z.literal("XYZ"),
  /** Kept for provenance; the template in `options` is what gets fetched. */
  url: HttpUrlSchema,
  options: XYZOptionsSchema
});

export const WfsServiceSchema = z.object({
  type: z.literal("WFS"),
  url: HttpUrlSchema,
  options: WFSOptionsSchema
});

export const CogServiceSchema = z.object({
  type: z.literal("COG"),
  url: HttpUrlSchema,
  options: COGOptionsSchema
});

/** Discriminated union of every supported service binding. */
export const ServiceSchema = z.discriminatedUnion("type", [
  WmsServiceSchema,
  WmtsServiceSchema,
  XyzServiceSchema,
  WfsServiceSchema,
  CogServiceSchema
]);

export type Service = z.infer<typeof ServiceSchema>;
export type ServiceInput = z.input<typeof ServiceSchema>;
export type WmsService = z.infer<typeof WmsServiceSchema>;
export type WmtsService = z.infer<typeof WmtsServiceSchema>;
export type XyzService = z.infer<typeof XyzServiceSchema>;
export type WfsService = z.infer<typeof WfsServiceSchema>;
export type CogService = z.infer<typeof CogServiceSchema>;

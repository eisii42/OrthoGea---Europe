import { OrthoGeaLayerSchema } from "@orthogea/core/schemas";
import {
  WEB_MERCATOR_BBOX,
  isSameCrs,
  type LayerCategory,
  type License,
  type OrthoGeaLayer,
  type Provider
} from "@orthogea/core";
import type { ParsedCapabilities, ParsedWmsLayer } from "./wms/types.js";
import type { ParsedWmtsCapabilities, ParsedWmtsLayer } from "./wmts/types.js";

/** Turns free text into a catalogue-safe id fragment. */
export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Joins id fragments with dots, e.g. `it`, `toscana`, `Ortofoto 2023`. */
export function buildLayerId(...parts: string[]): string {
  return parts
    .map((part) => slugify(part))
    .filter(Boolean)
    .join(".");
}

export interface ToOrthoGeaLayerOptions {
  id?: string;
  category: LayerCategory;
  provider: Provider;
  license: License;
  /** NUTS-0 code or `EU`. */
  country: string;
  nuts?: string;
  regionName?: string;
  attribution?: string;
  /** CRS to prefer, best first. Defaults to Web Mercator then WGS84. */
  preferredCrs?: readonly string[];
  /** Image formats to prefer, best first. */
  preferredFormats?: readonly string[];
  /** Overrides applied last, e.g. `{ maxZoom: 19 }`. */
  overrides?: Partial<Record<string, unknown>>;
}

const DEFAULT_CRS_PREFERENCE = ["EPSG:3857", "EPSG:4326", "CRS:84"] as const;
const DEFAULT_FORMAT_PREFERENCE = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif"
] as const;

function pickFormat(
  available: readonly string[],
  preferred: readonly string[] = DEFAULT_FORMAT_PREFERENCE
): string {
  for (const candidate of preferred) {
    const match = available.find((format) => format.toLowerCase().startsWith(candidate));
    if (match) return match;
  }
  return available[0] ?? "image/png";
}

function orderCrs(
  available: readonly string[],
  preferred: readonly string[] = DEFAULT_CRS_PREFERENCE
): string[] {
  const ordered: string[] = [];
  for (const candidate of preferred) {
    const match = available.find((crs) => isSameCrs(crs, candidate));
    if (match && !ordered.includes(match)) ordered.push(match);
  }
  for (const crs of available) {
    if (!ordered.includes(crs)) ordered.push(crs);
  }
  return ordered.length > 0 ? ordered : ["EPSG:3857"];
}

/**
 * Converts one harvested WMS layer into a catalogue-ready
 * {@link OrthoGeaLayer}, filling in what the capabilities document cannot
 * know (category, licence, provenance).
 */
export function wmsLayerToOrthoGea(
  capabilities: ParsedCapabilities,
  layer: ParsedWmsLayer,
  options: ToOrthoGeaLayerOptions
): OrthoGeaLayer {
  if (!layer.name) {
    throw new Error(`Layer "${layer.title}" has no Name and cannot be requested`);
  }

  const url = capabilities.operations.getMap?.url ?? capabilities.service.onlineResource;
  if (!url) {
    throw new Error("The capabilities document advertises no GetMap endpoint");
  }

  const draft = {
    id: options.id ?? buildLayerId(options.country, layer.name),
    title: layer.title,
    description: layer.abstract,
    category: options.category,
    provider: options.provider,
    country: options.country,
    nuts: options.nuts,
    regionName: options.regionName,
    bbox: layer.bbox ?? WEB_MERCATOR_BBOX,
    service: {
      type: "WMS" as const,
      url,
      options: {
        layers: [layer.name],
        styles: layer.styles.length > 0 ? [layer.styles[0]?.name ?? ""] : [],
        format: pickFormat(capabilities.operations.getMap?.formats ?? [], options.preferredFormats),
        infoFormats: capabilities.operations.getFeatureInfo?.formats ?? [],
        crs: orderCrs(layer.crs, options.preferredCrs),
        version: capabilities.version,
        queryable: layer.queryable,
        transparent: options.category !== "orthophoto" && options.category !== "satellite",
        maxWidth: capabilities.service.maxWidth,
        maxHeight: capabilities.service.maxHeight
      }
    },
    license: options.license,
    attribution:
      options.attribution ??
      layer.attribution?.title ??
      options.provider.shortName ??
      options.provider.name,
    tags: layer.keywords.slice(0, 12),
    metadataUrl: layer.metadataUrls[0]?.url,
    ...options.overrides
  };

  return OrthoGeaLayerSchema.parse(draft);
}

/** Converts one harvested WMTS layer into a catalogue-ready {@link OrthoGeaLayer}. */
export function wmtsLayerToOrthoGea(
  capabilities: ParsedWmtsCapabilities,
  layer: ParsedWmtsLayer,
  options: ToOrthoGeaLayerOptions & { tileMatrixSet?: string }
): OrthoGeaLayer {
  const url = capabilities.operations.getTile?.url ?? capabilities.operations.getCapabilities?.url;
  const restTemplate = layer.resourceUrls.find((resource) => resource.resourceType === "tile");
  if (!url && !restTemplate) {
    throw new Error("The capabilities document advertises no GetTile endpoint");
  }

  const tileMatrixSet =
    options.tileMatrixSet ??
    layer.tileMatrixSets.find((set) => {
      const crs = capabilities.tileMatrixSets[set]?.crs;
      return crs !== undefined && isSameCrs(crs, "EPSG:3857");
    }) ??
    layer.tileMatrixSets[0];

  if (!tileMatrixSet) {
    throw new Error(`WMTS layer "${layer.identifier}" declares no TileMatrixSet`);
  }

  const matrixSet = capabilities.tileMatrixSets[tileMatrixSet];
  const defaultStyle = layer.styles.find((style) => style.isDefault) ?? layer.styles[0];

  const draft = {
    id: options.id ?? buildLayerId(options.country, layer.identifier),
    title: layer.title,
    description: layer.abstract,
    category: options.category,
    provider: options.provider,
    country: options.country,
    nuts: options.nuts,
    regionName: options.regionName,
    bbox: layer.bbox ?? WEB_MERCATOR_BBOX,
    service: {
      type: "WMTS" as const,
      url: url ?? restTemplate?.template ?? "",
      options: {
        layer: layer.identifier,
        tileMatrixSet,
        style: defaultStyle?.identifier ?? "default",
        format: pickFormat(layer.formats, options.preferredFormats),
        version: "1.0.0" as const,
        requestEncoding: restTemplate && !url ? ("REST" as const) : ("KVP" as const),
        urlTemplate: restTemplate?.template,
        crs: matrixSet?.crs ?? "EPSG:3857",
        tileSize: (matrixSet?.tileMatrices[0]?.tileWidth === 512 ? 512 : 256) as 256 | 512,
        queryable: layer.queryable,
        infoFormats: layer.infoFormats
      }
    },
    license: options.license,
    attribution: options.attribution ?? options.provider.shortName ?? options.provider.name,
    tags: layer.keywords.slice(0, 12),
    ...options.overrides
  };

  return OrthoGeaLayerSchema.parse(draft);
}

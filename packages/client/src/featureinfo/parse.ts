import { XMLParser } from "fast-xml-parser";

export type FeatureInfoFormat = "geojson" | "json" | "gml" | "html" | "text" | "empty" | "unknown";

export interface FeatureInfoFeature {
  id?: string;
  /** Layer or feature-type the record belongs to, when the response says so. */
  layer?: string;
  properties: Record<string, unknown>;
  /** GeoJSON geometry, available for JSON responses only. */
  geometry?: unknown;
}

export interface FeatureInfoResult {
  format: FeatureInfoFormat;
  features: FeatureInfoFeature[];
  /** Original markup, for `text/html` responses meant to be shown as-is. */
  html?: string;
  text?: string;
  raw: string;
  contentType?: string;
  /** Set when the body could not be parsed into features. */
  warning?: string;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: true,
  parseAttributeValue: true,
  trimValues: true,
  // Same reasoning as the harvester: keep the anti-billion-laughs depth limit
  // but allow the many plain entities a real GML response carries.
  processEntities: {
    enabled: true,
    maxEntitySize: 10_000,
    maxExpansionDepth: 10,
    maxTotalExpansions: 1_000_000,
    maxExpandedLength: 10_000_000
  },
  ignoreDeclaration: true
});

const GEOMETRY_KEYS = new Set([
  "point",
  "linestring",
  "polygon",
  "multipoint",
  "multilinestring",
  "multipolygon",
  "multisurface",
  "multicurve",
  "surface",
  "curve",
  "geometry",
  "the_geom",
  "geom",
  "shape",
  "boundedby",
  "envelope",
  "msgeometry"
]);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toArray = <T,>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, "&");
}

const stripTags = (value: string): string => decodeEntities(value.replace(/<[^>]*>/g, "")).trim();

/** Flattens the leaf elements of a GML feature into a properties bag. */
function leafProperties(node: unknown, into: Record<string, unknown> = {}): Record<string, unknown> {
  if (!isPlainObject(node)) return into;
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("@_") || key === "#text") {
      if (key.startsWith("@_") && key !== "@_xmlns") {
        into[key.slice(2)] = value;
      }
      continue;
    }
    if (GEOMETRY_KEYS.has(key.toLowerCase())) continue;
    const entries = toArray(value);
    for (const entry of entries) {
      if (isPlainObject(entry)) {
        const text = entry["#text"];
        if (text !== undefined && Object.keys(entry).every((k) => k === "#text" || k.startsWith("@_"))) {
          into[key] = text;
        } else {
          leafProperties(entry, into);
        }
      } else if (entry !== undefined && entry !== null && entry !== "") {
        into[key] = entry;
      }
    }
  }
  return into;
}

function featureFromNode(name: string, node: unknown): FeatureInfoFeature {
  const properties = leafProperties(node);
  const id = properties["fid"] ?? properties["id"] ?? properties["gml:id"];
  return {
    layer: name,
    id: id === undefined ? undefined : String(id),
    properties
  };
}

/** Extracts features from GML, msGMLOutput and other XML info responses. */
export function parseGmlFeatureInfo(body: string): FeatureInfoFeature[] {
  const doc = xmlParser.parse(body) as Record<string, unknown>;
  const features: FeatureInfoFeature[] = [];

  const visit = (node: unknown, name: string): void => {
    if (!isPlainObject(node)) return;
    const lower = name.toLowerCase();

    // GML 2/3 collections wrap every feature in featureMember(s)/member.
    if (lower.endsWith("featurecollection") || lower === "featuremembers") {
      for (const key of ["featureMember", "featureMembers", "member"]) {
        for (const wrapper of toArray(node[key])) {
          if (!isPlainObject(wrapper)) continue;
          for (const [childName, childValue] of Object.entries(wrapper)) {
            if (childName.startsWith("@_") || childName === "#text") continue;
            for (const item of toArray(childValue)) {
              features.push(featureFromNode(childName, item));
            }
          }
        }
      }
    }

    // MapServer emits <prefix_layer><prefix_feature>...</prefix_feature>.
    if (lower.endsWith("_feature")) {
      features.push(featureFromNode(name.replace(/_feature$/i, ""), node));
      return;
    }

    for (const [childName, childValue] of Object.entries(node)) {
      if (childName.startsWith("@_") || childName === "#text") continue;
      for (const item of toArray(childValue)) visit(item, childName);
    }
  };

  for (const [name, value] of Object.entries(doc)) {
    for (const item of toArray(value)) visit(item, name);
  }

  return features;
}

interface ParsedHtmlRow {
  /** `th` or `td`, one entry per cell. */
  tags: string[];
  cells: string[];
}

function parseHtmlRows(table: string): ParsedHtmlRow[] {
  const rows = table.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  return rows.map((row) => {
    const cells = row.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) ?? [];
    return {
      tags: cells.map((cell) => (/^<th/i.test(cell) ? "th" : "td")),
      cells: cells.map((cell) => stripTags(cell))
    };
  });
}

/**
 * Extracts features from the HTML tables WMS servers return.
 *
 * Two shapes are common: GeoServer writes a header row of `th` followed by one
 * `td` row per feature, while MapServer based services (the Italian and
 * Croatian cadastres among them) write one `th`/`td` pair per attribute.
 */
export function parseHtmlFeatureInfo(body: string): FeatureInfoFeature[] {
  const features: FeatureInfoFeature[] = [];

  for (const table of body.match(/<table[\s\S]*?<\/table>/gi) ?? []) {
    const rows = parseHtmlRows(table);
    if (rows.length === 0) continue;

    // Shape 1: one attribute per row, label in a th, value in a td.
    const pairRows = rows.filter(
      (row) => row.cells.length === 2 && row.tags[0] === "th" && row.tags[1] === "td"
    );
    if (pairRows.length > 0) {
      const properties: Record<string, unknown> = {};
      for (const row of pairRows) {
        const key = row.cells[0];
        if (key) properties[key] = row.cells[1] ?? "";
      }
      if (Object.keys(properties).length > 0) features.push({ properties });
      continue;
    }

    // Shape 2: a header row followed by one row per feature.
    const headerRow = rows.find((row) => row.cells.length >= 2 && row.tags.every((tag) => tag === "th"));
    const dataRows = rows.filter((row) => row.cells.length >= 2 && row.tags.every((tag) => tag === "td"));

    if (headerRow && dataRows.length > 0) {
      for (const row of dataRows) {
        const properties: Record<string, unknown> = {};
        headerRow.cells.forEach((key, index) => {
          if (key) properties[key] = row.cells[index] ?? "";
        });
        if (Object.keys(properties).length > 0) features.push({ properties });
      }
      continue;
    }

    // Shape 3: two plain columns, treated as key/value.
    const properties: Record<string, unknown> = {};
    for (const row of dataRows) {
      const key = row.cells[0];
      if (key) properties[key] = row.cells[1] ?? "";
    }
    if (Object.keys(properties).length > 0) features.push({ properties });
  }

  return features;
}

/** Extracts `key = value` pairs from GeoServer style plain-text responses. */
export function parseTextFeatureInfo(body: string): FeatureInfoFeature[] {
  const features: FeatureInfoFeature[] = [];
  let current: Record<string, unknown> | undefined;
  let layer: string | undefined;

  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const typeMatch = /^Results for FeatureType '?([^']+)'?:?$/i.exec(trimmed);
    if (typeMatch) {
      layer = typeMatch[1];
      continue;
    }
    if (/^-{3,}$/.test(trimmed)) {
      if (current && Object.keys(current).length > 0) {
        features.push({ layer, properties: current });
      }
      current = undefined;
      continue;
    }
    const pair = /^([^=]+)=(.*)$/.exec(trimmed);
    if (pair?.[1] !== undefined) {
      current ??= {};
      current[pair[1].trim()] = (pair[2] ?? "").trim();
    }
  }

  if (current && Object.keys(current).length > 0) features.push({ layer, properties: current });
  return features;
}

function parseJsonFeatureInfo(body: string): { format: FeatureInfoFormat; features: FeatureInfoFeature[] } {
  const data = JSON.parse(body) as unknown;

  if (isPlainObject(data) && data["type"] === "FeatureCollection") {
    const features = toArray(data["features"] as unknown[]).map((entry) => {
      const feature = isPlainObject(entry) ? entry : {};
      return {
        id: feature["id"] === undefined ? undefined : String(feature["id"]),
        properties: isPlainObject(feature["properties"]) ? feature["properties"] : {},
        geometry: feature["geometry"]
      } satisfies FeatureInfoFeature;
    });
    return { format: "geojson", features };
  }

  if (Array.isArray(data)) {
    return {
      format: "json",
      features: data.map((entry) => ({
        properties: isPlainObject(entry) ? entry : { value: entry }
      }))
    };
  }

  return {
    format: "json",
    features: isPlainObject(data) ? [{ properties: data }] : []
  };
}

/**
 * Parses any GetFeatureInfo payload into a common shape.
 *
 * GeoJSON and JSON keep their geometry, GML and HTML are reduced to property
 * bags, and the original body is always preserved so a UI can fall back to
 * rendering the server's own markup.
 */
export function parseFeatureInfoResponse(
  body: string,
  contentType?: string
): FeatureInfoResult {
  const raw = body ?? "";
  const trimmed = raw.trim();
  const type = (contentType ?? "").toLowerCase();

  if (!trimmed) {
    return { format: "empty", features: [], raw, contentType };
  }

  try {
    if (type.includes("json") || trimmed.startsWith("{") || trimmed.startsWith("[")) {
      const { format, features } = parseJsonFeatureInfo(trimmed);
      return { format, features, raw, contentType };
    }

    if (type.includes("html") || /<html[\s>]|<table[\s>]/i.test(trimmed)) {
      const features = parseHtmlFeatureInfo(trimmed);
      return { format: "html", features, html: raw, raw, contentType };
    }

    if (type.includes("xml") || type.includes("gml") || trimmed.startsWith("<")) {
      const features = parseGmlFeatureInfo(trimmed);
      return { format: "gml", features, raw, contentType };
    }

    const features = parseTextFeatureInfo(trimmed);
    return { format: "text", features, text: raw, raw, contentType };
  } catch (error) {
    return {
      format: "unknown",
      features: [],
      raw,
      contentType,
      text: raw,
      warning: `Could not parse the response: ${(error as Error).message}`
    };
  }
}

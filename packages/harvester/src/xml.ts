import { XMLParser } from "fast-xml-parser";
import { CapabilitiesParseError } from "@orthogea/core";

/** Prefix fast-xml-parser puts in front of attribute names. */
export const ATTR_PREFIX = "@_";

export type XmlNode = Record<string, unknown>;

/**
 * Parser tuned for OGC capabilities documents: namespaces are stripped so
 * `wms:Layer` and `Layer` collapse to the same key, and values stay strings so
 * that codes such as `0512` are not silently turned into numbers.
 */
export function createXmlParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: ATTR_PREFIX,
    removeNSPrefix: true,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    // Real capabilities documents contain tens of thousands of legitimate
    // entities (&amp; in every URL, accented characters in titles). The parser
    // defaults cap total expansions at 1000, which rejects national services
    // such as IGN France or swisstopo; the depth and per-entity size limits
    // that actually stop billion-laughs attacks are kept tight.
    processEntities: {
      enabled: true,
      maxEntitySize: 10_000,
      maxExpansionDepth: 10,
      maxTotalExpansions: 5_000_000,
      maxExpandedLength: 50_000_000
    },
    ignoreDeclaration: true,
    ignorePiTags: true
  });
}

const sharedParser = createXmlParser();

/** Parses an XML document, raising a typed error on malformed input. */
export function parseXml(xml: string): XmlNode {
  if (typeof xml !== "string" || xml.trim().length === 0) {
    throw new CapabilitiesParseError("The capabilities document is empty");
  }
  try {
    const parsed = sharedParser.parse(xml) as unknown;
    if (!isNode(parsed)) {
      throw new CapabilitiesParseError("The capabilities document has no root element");
    }
    return parsed;
  } catch (error) {
    if (error instanceof CapabilitiesParseError) throw error;
    throw new CapabilitiesParseError("The capabilities document is not valid XML", error);
  }
}

/** True when the value is a plain XML element object. */
export function isNode(value: unknown): value is XmlNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Normalises "absent | single | repeated" element shapes to an array. */
export function asArray<T>(value: T | readonly T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? [...value] : [value as T];
}

/** Direct child element(s) of a node, as an array. */
export function children(node: unknown, name: string): unknown[] {
  if (!isNode(node)) return [];
  return asArray(node[name]);
}

/** First direct child element with the given name. */
export function child(node: unknown, name: string): unknown {
  return children(node, name)[0];
}

/** Text content of an element, whether or not it carries attributes. */
export function text(node: unknown): string | undefined {
  if (node === undefined || node === null) return undefined;
  if (typeof node === "string") return node.trim() || undefined;
  if (typeof node === "number" || typeof node === "boolean") return String(node);
  if (isNode(node)) {
    const value = node["#text"];
    if (typeof value === "string") return value.trim() || undefined;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  return undefined;
}

/** Text content of a named child element. */
export function childText(node: unknown, name: string): string | undefined {
  return text(child(node, name));
}

/** Attribute value of an element. */
export function attr(node: unknown, name: string): string | undefined {
  if (!isNode(node)) return undefined;
  const value = node[`${ATTR_PREFIX}${name}`];
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

/** Parses a numeric string, tolerating scientific notation and blanks. */
export function num(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Numeric attribute value. */
export function numAttr(node: unknown, name: string): number | undefined {
  return num(attr(node, name));
}

/** Reads the `xlink:href` of a nested `OnlineResource` element. */
export function onlineResourceHref(node: unknown): string | undefined {
  const resource = child(node, "OnlineResource");
  return attr(resource, "href") ?? attr(resource, "xlink:href");
}

/** Splits a whitespace or comma separated list, dropping empty entries. */
export function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Finds the first present key among several candidates. */
export function pickNode(node: unknown, ...names: string[]): unknown {
  for (const name of names) {
    const found = child(node, name);
    if (found !== undefined) return found;
  }
  return undefined;
}

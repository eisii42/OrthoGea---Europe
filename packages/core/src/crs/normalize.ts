import {
  CRS_DEFINITIONS,
  CRS_EQUIVALENCE_GROUPS,
  type AxisOrder,
  type CrsDefinition
} from "./definitions.js";

/** WMS protocol versions supported by the framework. */
export type WmsVersion = "1.1.0" | "1.1.1" | "1.3.0";

const byCode = new Map<string, CrsDefinition>();
const byAlias = new Map<string, string>();
const equivalence = new Map<string, ReadonlySet<string>>();

const upper = (value: string): string => value.trim().replace(/\s+/g, " ").toUpperCase();

function indexDefinition(def: CrsDefinition): void {
  byCode.set(def.code, def);
  byAlias.set(upper(def.code), def.code);
  byAlias.set(upper(def.code.replace(":", "::")), def.code);
  byAlias.set(upper(def.code.replace(":", "")), def.code);
  for (const alias of def.aliases) {
    byAlias.set(upper(alias), def.code);
    byAlias.set(upper(alias.replace(":", "::")), def.code);
  }
}

for (const def of CRS_DEFINITIONS) indexDefinition(def);

for (const group of CRS_EQUIVALENCE_GROUPS) {
  const members = new Set(group);
  for (const code of group) equivalence.set(code, members);
}

/**
 * Adds (or overrides) a CRS definition at runtime, so downstream projects can
 * teach OrthoGea about national grids that are not bundled.
 */
export function registerCrs(def: CrsDefinition): void {
  indexDefinition(def);
}

/** All CRS definitions currently known to the registry. */
export function listCrs(): CrsDefinition[] {
  return [...byCode.values()];
}

export interface ParsedCrs {
  /** Authority label as written by the service, e.g. `EPSG`, `OGC`, `IGNF`. */
  authority: string;
  /** Authority-specific identifier, e.g. `4326` or `CRS84`. */
  identifier: string;
}

const URN_RE = /^URN:(?:X-)?OGC:DEF:CRS:([A-Z0-9-]+)(?::[^:]*)?:{1,2}([A-Z0-9._-]+)$/;
const OGC_URL_RE = /^HTTPS?:\/\/(?:WWW\.)?OPENGIS\.NET\/DEF\/CRS\/([A-Z0-9-]+)\/[^/]*\/([A-Z0-9._-]+)$/;
const GML_SRS_URL_RE = /^HTTPS?:\/\/[^#]*EPSG[^#]*#([0-9]+)$/;
const SHORT_RE = /^([A-Z0-9-]+):{1,2}([A-Z0-9._-]+)$/;
const BARE_CODE_RE = /^([0-9]{3,6})$/;
const GLUED_RE = /^([A-Z]{3,6})([0-9]{3,6})$/;

/**
 * Splits any of the CRS spellings used in OGC documents into authority +
 * identifier. Returns `undefined` when the string cannot be understood.
 *
 * Handles `EPSG:4326`, `EPSG::4326`, `urn:ogc:def:crs:EPSG:6.18.3:4326`,
 * `urn:ogc:def:crs:OGC:1.3:CRS84`, `http://www.opengis.net/def/crs/EPSG/0/4326`,
 * `http://www.opengis.net/gml/srs/epsg.xml#4326`, `CRS84` and bare `4326`.
 */
export function parseCrs(input: string): ParsedCrs | undefined {
  const value = upper(input);
  if (!value) return undefined;

  const urn = URN_RE.exec(value);
  if (urn?.[1] && urn[2]) return { authority: urn[1], identifier: urn[2] };

  const ogcUrl = OGC_URL_RE.exec(value);
  if (ogcUrl?.[1] && ogcUrl[2]) return { authority: ogcUrl[1], identifier: ogcUrl[2] };

  const gml = GML_SRS_URL_RE.exec(value);
  if (gml?.[1]) return { authority: "EPSG", identifier: gml[1] };

  const short = SHORT_RE.exec(value);
  if (short?.[1] && short[2]) return { authority: short[1], identifier: short[2] };

  const bare = BARE_CODE_RE.exec(value);
  if (bare?.[1]) return { authority: "EPSG", identifier: bare[1] };

  const glued = GLUED_RE.exec(value);
  if (glued?.[1] && glued[2]) return { authority: glued[1], identifier: glued[2] };

  return undefined;
}

/**
 * Normalises any CRS spelling to the canonical short form used across
 * OrthoGea (`EPSG:4326`, `CRS:84`, ...).
 *
 * Unknown but well-formed codes are returned in `AUTHORITY:IDENTIFIER` form so
 * that exotic national grids still round-trip; unparseable input is returned
 * uppercased and trimmed.
 */
export function normalizeCrs(input: string): string {
  const value = upper(input);
  const direct = byAlias.get(value);
  if (direct) return direct;

  const parsed = parseCrs(value);
  if (!parsed) return value;

  const candidate =
    parsed.authority === "OGC" && /^(CRS)?84$/.test(parsed.identifier)
      ? "CRS:84"
      : `${parsed.authority}:${parsed.identifier}`;

  return byAlias.get(upper(candidate)) ?? candidate;
}

/** Same as {@link normalizeCrs} but returns `undefined` for unknown CRS. */
export function normalizeKnownCrs(input: string): string | undefined {
  const code = normalizeCrs(input);
  return byCode.has(code) ? code : undefined;
}

/** Full definition for a CRS, if bundled or registered. */
export function getCrsDefinition(input: string): CrsDefinition | undefined {
  return byCode.get(normalizeCrs(input));
}

/** Every code known to describe the same space (including the input itself). */
export function crsEquivalents(input: string): string[] {
  const code = normalizeCrs(input);
  const group = equivalence.get(code);
  return group ? [...group] : [code];
}

/** True when both strings denote the same underlying CRS. */
export function isSameCrs(a: string, b: string): boolean {
  const left = normalizeCrs(a);
  const right = normalizeCrs(b);
  if (left === right) return true;
  const group = equivalence.get(left);
  return group?.has(right) ?? false;
}

/** True when the CRS uses angular units (degrees). */
export function isGeographicCrs(input: string): boolean {
  return getCrsDefinition(input)?.kind === "geographic";
}

/**
 * Axis order to use when writing/reading a BBOX for this CRS.
 *
 * WMS 1.1.1 (and 1.1.0) ignore the authority definition and always use
 * `minx,miny,maxx,maxy` in longitude/latitude order. WMS 1.3.0, WMTS and
 * WFS 2.0 honour the authority axis order, which is latitude-first for
 * `EPSG:4326`, `EPSG:6706`, `EPSG:4258`, `EPSG:3035`, ...
 *
 * Unknown CRS default to `lonlat`, the safest assumption for projected grids.
 */
export function getAxisOrder(crs: string, wmsVersion?: WmsVersion): AxisOrder {
  if (wmsVersion === "1.1.1" || wmsVersion === "1.1.0") return "lonlat";
  return getCrsDefinition(crs)?.axisOrder ?? "lonlat";
}

/** True when the CRS reports coordinates as (lat/northing, lon/easting). */
export function isLatLonAxisOrder(crs: string, wmsVersion?: WmsVersion): boolean {
  return getAxisOrder(crs, wmsVersion) === "latlon";
}

export type { AxisOrder, CrsDefinition };

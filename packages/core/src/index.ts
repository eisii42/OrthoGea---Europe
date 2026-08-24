/**
 * @orthogea/core - shared vocabulary of the OrthoGea framework.
 *
 * Everything a package needs to describe a European geodata layer: Zod
 * schemas, TypeScript types, CRS normalisation, bounding-box maths and NUTS
 * helpers. No I/O happens here.
 */

export * from "./errors.js";
export * from "./guards.js";
export * from "./url.js";

export * from "./schemas/bbox.js";
export * from "./schemas/enums.js";
export * from "./schemas/service.js";
export * from "./schemas/layer.js";

export * from "./crs/definitions.js";
export {
  crsEquivalents,
  getAxisOrder,
  getCrsDefinition,
  isGeographicCrs,
  isLatLonAxisOrder,
  isSameCrs,
  listCrs,
  normalizeCrs,
  normalizeKnownCrs,
  parseCrs,
  registerCrs,
  type ParsedCrs
} from "./crs/normalize.js";

export * from "./spatial/bbox.js";
export * from "./spatial/mercator.js";
export * from "./spatial/coverage.js";

export * from "./nuts/index.js";

/** Version of the schema contract shared by all OrthoGea packages. */
export const ORTHOGEA_SCHEMA_VERSION = "1.0.0";

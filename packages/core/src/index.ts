/**
 * @orthogea/core - shared vocabulary of the OrthoGea framework.
 *
 * Everything a package needs to describe a European geodata layer: TypeScript
 * types, CRS normalisation, bounding-box maths and NUTS helpers. No I/O
 * happens here, and **no third-party code is pulled in**: this entry is what a
 * web-GIS ships, so it stays at plain arithmetic and string handling.
 *
 * The Zod schemas the types are derived from live behind
 * `@orthogea/core/schemas`, because validating a catalogue is something a build
 * step or a catalogue author does, not something a map does on every frame.
 */

export * from "./errors.js";
export * from "./guards.js";
export * from "./url.js";
export * from "./constants.js";

// Types only: the schemas themselves are exported from `./schemas`, so the
// bundler never sees a reason to include Zod in an application that draws maps.
export type * from "./schemas/bbox.js";
export type * from "./schemas/enums.js";
export type * from "./schemas/service.js";
export type * from "./schemas/layer.js";

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

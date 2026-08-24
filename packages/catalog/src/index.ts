/**
 * @orthogea/catalog - a validated registry of European open geodata services.
 *
 * The JSON files under `data/` hold the endpoints, grouped by NUTS-0 scope and
 * indexed down to NUTS-2/3. Every record was probed with a live
 * `GetCapabilities` request on the date stored in `lastVerified`.
 */

export {
  DEFAULT_SATELLITE_FALLBACK_ID,
  bestOrthophotoFor,
  buildCatalog,
  catalog,
  catalogStats,
  collections,
  findLayers,
  getLayer,
  getLayers,
  groupByCategory,
  groupByCountry,
  hasLayer,
  imageryStackFor,
  layersForPoint,
  registerCollection,
  safeBuildCatalog,
  type BestImageryOptions,
  type CatalogBuildResult,
  type CatalogIssue,
  type CatalogQuery,
  type CatalogStats
} from "./registry.js";

export { buildNutsTree, flattenTree, type CatalogTreeNode } from "./tree.js";

export { RAW_COLLECTIONS } from "./data.js";

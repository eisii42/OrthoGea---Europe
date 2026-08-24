/**
 * @orthogea/catalog - a validated registry of European open geodata services.
 *
 * The JSON files under `data/` hold the endpoints, grouped by NUTS-0 scope and
 * indexed down to NUTS-2/3. Every record was probed with a live
 * `GetCapabilities` request on the date stored in `lastVerified`, and every one
 * is validated against the schema when the package is built - so this entry
 * ships plain data and pulls in no third-party code.
 *
 * To load a collection you did not author, import `@orthogea/catalog/validate`,
 * which carries the schema and reports a typo instead of drawing it.
 */

export {
  DEFAULT_SATELLITE_FALLBACK_ID,
  bestOrthophotoFor,
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
  type BestImageryOptions,
  type CatalogQuery,
  type CatalogStats
} from "./registry.js";

export { buildNutsTree, flattenTree, type CatalogTreeNode } from "./tree.js";

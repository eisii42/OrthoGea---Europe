/**
 * `@orthogea/catalog/validate` - loading catalogue documents you did not author.
 *
 * The bundled catalogue is validated when the package is built, so the registry
 * itself needs no validator at runtime and a map that only reads it never ships
 * one. This entry is for the other case: a portal that loads community or
 * in-house collections, and wants a typo reported rather than drawn.
 *
 * ```ts
 * import { registerCollection } from "@orthogea/catalog/validate";
 *
 * const result = registerCollection(await (await fetch("/layers.json")).json());
 * for (const issue of result.issues) console.warn(issue.source, issue.message);
 * ```
 */

import { LayerCollectionSchema } from "@orthogea/core/schemas";
import type { LayerCollection, OrthoGeaLayer } from "@orthogea/core";
import { RAW_COLLECTIONS } from "./data.js";
import { mutableRegistry } from "./registry.js";

export interface CatalogIssue {
  /** File the invalid document came from. */
  source: string;
  path: string;
  message: string;
}

export interface CatalogBuildResult {
  collections: LayerCollection[];
  layers: OrthoGeaLayer[];
  issues: CatalogIssue[];
}

/**
 * Validates raw catalogue documents against the OrthoGea schema.
 *
 * Invalid documents are reported instead of thrown, so a portal can load
 * community collections without a single typo taking the map down.
 */
export function safeBuildCatalog(
  raw: Record<string, unknown> = RAW_COLLECTIONS
): CatalogBuildResult {
  const collections: LayerCollection[] = [];
  const layers: OrthoGeaLayer[] = [];
  const issues: CatalogIssue[] = [];
  const seen = new Set<string>();

  for (const [source, document] of Object.entries(raw)) {
    const parsed = LayerCollectionSchema.safeParse(document);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        issues.push({ source, path: issue.path.join("."), message: issue.message });
      }
      continue;
    }

    collections.push(parsed.data);
    for (const layer of parsed.data.layers) {
      if (seen.has(layer.id)) {
        issues.push({
          source,
          path: `layers.${layer.id}`,
          message: `Duplicate layer id "${layer.id}"`
        });
        continue;
      }
      seen.add(layer.id);
      layers.push(layer);
    }
  }

  return { collections, layers, issues };
}

/** Same as {@link safeBuildCatalog} but refuses to return a broken catalogue. */
export function buildCatalog(
  raw: Record<string, unknown> = RAW_COLLECTIONS
): CatalogBuildResult {
  const result = safeBuildCatalog(raw);
  if (result.issues.length > 0) {
    const details = result.issues
      .slice(0, 5)
      .map((issue) => `${issue.source}: ${issue.path} - ${issue.message}`)
      .join("; ");
    throw new Error(
      `The catalogue failed validation (${result.issues.length} issues): ${details}`
    );
  }
  return result;
}

/**
 * Validates and adds an external collection at runtime, returning the layers
 * that were accepted. Ids already present are reported as issues.
 */
export function registerCollection(
  document: unknown,
  source = "runtime"
): CatalogBuildResult {
  const { byId, layers: allLayers, collections: allCollections } = mutableRegistry;
  const result = safeBuildCatalog({ [source]: document });
  const accepted: OrthoGeaLayer[] = [];

  for (const layer of result.layers) {
    if (byId.has(layer.id)) {
      result.issues.push({
        source,
        path: `layers.${layer.id}`,
        message: `Duplicate layer id "${layer.id}"`
      });
      continue;
    }
    byId.set(layer.id, layer);
    allLayers.push(layer);
    accepted.push(layer);
  }

  for (const collection of result.collections) allCollections.push(collection);

  return { ...result, layers: accepted };
}

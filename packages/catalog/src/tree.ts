import {
  EU_WIDE_CODE,
  nutsAncestors,
  nutsCountryName,
  nutsLevel,
  type OrthoGeaLayer
} from "@orthogea/core";
import { catalog } from "./registry.js";

export interface CatalogTreeNode {
  /** `EU`, a NUTS-0 country code, or a NUTS-1/2/3 code. */
  code: string;
  label: string;
  /** NUTS level, with -1 reserved for the pan-European root. */
  level: number;
  /** Layers attached exactly at this level. */
  layers: OrthoGeaLayer[];
  children: CatalogTreeNode[];
  /** Layers at this node and below. */
  layerCount: number;
}

function createNode(code: string, label: string, level: number): CatalogTreeNode {
  return { code, label, level, layers: [], children: [], layerCount: 0 };
}

function childNode(
  parent: CatalogTreeNode,
  code: string,
  label: string,
  level: number
): CatalogTreeNode {
  const existing = parent.children.find((child) => child.code === code);
  if (existing) {
    // A layer carrying regionName gives a better label than the bare code.
    if (existing.label === existing.code && label !== code) existing.label = label;
    return existing;
  }
  const created = createNode(code, label, level);
  parent.children.push(created);
  return created;
}

function countLayers(node: CatalogTreeNode): number {
  node.layerCount =
    node.layers.length + node.children.reduce((sum, child) => sum + countLayers(child), 0);
  return node.layerCount;
}

function sortTree(node: CatalogTreeNode): void {
  node.children.sort((a, b) => a.code.localeCompare(b.code));
  node.layers.sort((a, b) => a.title.localeCompare(b.title));
  for (const child of node.children) sortTree(child);
}

/**
 * Builds the NUTS hierarchy of the catalogue: a pan-European root, one node
 * per country, and a branch per NUTS level actually used by a layer.
 *
 * A layer is attached to the most specific node it declares, so a UI can show
 * "Europe > Italy > Centro > Toscana" without any extra lookup table.
 */
export function buildNutsTree(source: readonly OrthoGeaLayer[] = catalog): CatalogTreeNode {
  const root = createNode(EU_WIDE_CODE, "Europe", -1);

  for (const layer of source) {
    if (layer.country === EU_WIDE_CODE) {
      root.layers.push(layer);
      continue;
    }

    const country = childNode(
      root,
      layer.country,
      nutsCountryName(layer.country) ?? layer.country,
      0
    );

    if (!layer.nuts || layer.nuts === layer.country) {
      country.layers.push(layer);
      continue;
    }

    // Walk down from the country to the declared code, creating the branches.
    const chain = [...nutsAncestors(layer.nuts).reverse().slice(1), layer.nuts];
    let node = country;
    for (const code of chain) {
      const isLeaf = code === layer.nuts;
      node = childNode(node, code, isLeaf ? layer.regionName ?? code : code, nutsLevel(code));
    }
    node.layers.push(layer);
  }

  countLayers(root);
  sortTree(root);
  return root;
}

/** Flattens the tree into `code -> label` pairs, depth-first. */
export function flattenTree(node: CatalogTreeNode, depth = 0): Array<{
  code: string;
  label: string;
  depth: number;
  layerCount: number;
}> {
  return [
    { code: node.code, label: node.label, depth, layerCount: node.layerCount },
    ...node.children.flatMap((child) => flattenTree(child, depth + 1))
  ];
}

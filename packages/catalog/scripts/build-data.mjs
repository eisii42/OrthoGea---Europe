/**
 * Validates and normalises the bundled catalogue, once, at build time.
 *
 * The JSON files under `data/` stay the source of truth and are written the way
 * a human wants to read them: optional fields left out, CRS codes in whatever
 * form the service advertised. The schema fills the gaps - `tileSize`, `crs`,
 * `status`, `version` and two dozen more - and normalises every CRS code.
 *
 * Doing that in the browser would mean shipping Zod, and running fifty-odd
 * schema parses, on the startup path of every map that uses the catalogue. So
 * it happens here instead: the build fails if a record is invalid, and what
 * ships is plain, complete data.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { LayerCollectionSchema } from "@orthogea/core/schemas";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const outputPath = join(root, "src", "generated", "catalog.json");

/** The collections, in the order the registry should present them. */
const FILES = [
  "eu.json",
  "it.json",
  "it-regions.json",
  "es.json",
  "fr.json",
  "de.json",
  "nl.json",
  "lu.json",
  "be.json",
  "pt.json",
  "ch.json",
  "at.json",
  "pl.json",
  "cz.json",
  "sk.json",
  "si.json",
  "hr.json",
  "el.json",
  "ee.json",
  "dk.json",
  "se.json"
];

const collections = [];
const issues = [];
const seen = new Set();

for (const file of FILES) {
  const document = JSON.parse(readFileSync(join(root, "data", file), "utf8"));
  const parsed = LayerCollectionSchema.safeParse(document);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push(`${file}: ${issue.path.join(".")} - ${issue.message}`);
    }
    continue;
  }

  const layers = [];
  for (const layer of parsed.data.layers) {
    if (seen.has(layer.id)) {
      issues.push(`${file}: duplicate layer id "${layer.id}"`);
      continue;
    }
    seen.add(layer.id);
    layers.push(layer);
  }
  collections.push({ ...parsed.data, layers });
}

if (issues.length > 0) {
  console.error(`The bundled catalogue failed validation (${issues.length} issues):`);
  for (const issue of issues.slice(0, 20)) console.error(`  ${issue}`);
  process.exit(1);
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify({ collections }, null, 0)}\n`);

console.log(
  `Validated ${collections.length} collections, ${seen.size} layers -> src/generated/catalog.json`
);

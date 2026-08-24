// Writes a JSON Schema for the catalogue files, so editors can validate them.
// Usage: pnpm --filter @orthogea/catalog schema
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LayerCollectionSchema } from "@orthogea/core";
import { zodToJsonSchema } from "zod-to-json-schema";

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, "..", "schema", "layer-collection.schema.json");

const schema = zodToJsonSchema(LayerCollectionSchema, {
  name: "LayerCollection",
  $refStrategy: "none"
});

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify(schema, null, 2)}\n`, "utf8");

console.log(`Wrote ${target}`);

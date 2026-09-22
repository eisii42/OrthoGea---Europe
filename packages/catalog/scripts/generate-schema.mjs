// Writes a JSON Schema for the catalogue files, so editors can validate them.
// Usage: pnpm --filter @orthogea/catalog schema
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { LayerCollectionSchema } from "@orthogea/core/schemas";

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, "..", "schema", "layer-collection.schema.json");

// Zod 4 emits JSON Schema itself, so the generator needs no extra dependency.
// `io: "input"` describes what an author writes - fields carrying a default are
// optional in the file, even though the parsed value always has them.
const schema = z.toJSONSchema(LayerCollectionSchema, {
  io: "input",
  target: "draft-7",
  cycles: "ref",
  reused: "inline"
});

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify({ title: "LayerCollection", ...schema }, null, 2)}\n`, "utf8");

console.log(`Wrote ${target}`);

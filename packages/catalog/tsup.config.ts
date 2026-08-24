import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/validate.ts"],
  // The schema is a separate entry, so a map that only reads the catalogue
  // never bundles a validator it does not run.
  splitting: true,
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: "es2022",
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".js" };
  }
});

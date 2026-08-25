import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/featureinfo/index.ts", "src/backdrop.ts"],
  // The GetFeatureInfo engine is a separate entry so its XML parser stays out
  // of the bundle of an application that only renders imagery.
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

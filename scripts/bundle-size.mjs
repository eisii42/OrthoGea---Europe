/**
 * What an application actually ships when it integrates OrthoGea.
 *
 * The project's promise is that it can replace Google Satellite or an ESRI
 * basemap inside an existing web-GIS, and a library that adds a hundred
 * kilobytes to someone's bundle is a hard sell however good its imagery is.
 * This measures the four ways it is normally imported, tree-shaken and
 * minified, so the claim in the README stays a measurement rather than a hope.
 *
 * Run it after `pnpm build`:
 *
 * ```
 * pnpm size
 * ```
 */

import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const CASES = [
  {
    name: "core only",
    what: "tile maths and CRS helpers",
    code: `import { lngLatToTile, tileToMercatorBBox, normalizeCrs } from "@orthogea/core";
globalThis.x = { lngLatToTile, tileToMercatorBBox, normalizeCrs };`
  },
  {
    name: "one layer",
    what: "a catalogue record as a MapLibre source",
    code: `import { toRasterSource, toRasterLayer } from "@orthogea/client";
globalThis.x = { toRasterSource, toRasterLayer };`
  },
  {
    name: "mosaic",
    what: "the seamless imagery layer, without the catalogue",
    code: `import { createMosaic, registerMosaicProtocol, toMosaicRasterSource, bindDetailZoomLimit } from "@orthogea/client";
globalThis.x = { createMosaic, registerMosaicProtocol, toMosaicRasterSource, bindDetailZoomLimit };`
  },
  {
    name: "full basemap",
    what: "mosaic plus all 55 catalogued services",
    code: `import { createMosaic, registerMosaicProtocol, toMosaicRasterSource, toMosaicRasterLayer, bindDetailZoomLimit } from "@orthogea/client";
import { catalog } from "@orthogea/catalog";
globalThis.x = { createMosaic, registerMosaicProtocol, toMosaicRasterSource, toMosaicRasterLayer, bindDetailZoomLimit, catalog };`
  },
  {
    name: "+ GetFeatureInfo",
    what: "the click-to-query engine, which carries an XML parser",
    code: `import { createMosaic } from "@orthogea/client";
import { getFeatureInfo } from "@orthogea/client/featureinfo";
import { catalog } from "@orthogea/catalog";
globalThis.x = { createMosaic, getFeatureInfo, catalog };`
  }
];

const alias = {
  "@orthogea/core": "./packages/core/dist/index.js",
  "@orthogea/core/schemas": "./packages/core/dist/schemas/index.js",
  "@orthogea/client": "./packages/client/dist/index.js",
  "@orthogea/client/featureinfo": "./packages/client/dist/featureinfo/index.js",
  "@orthogea/catalog": "./packages/catalog/dist/index.js",
  "@orthogea/catalog/validate": "./packages/catalog/dist/validate.js"
};

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;

console.log("Integration weight, tree-shaken and minified\n");
console.log(`${"import".padEnd(18)} ${"minified".padStart(10)} ${"gzipped".padStart(9)}   what it buys`);
console.log("-".repeat(88));

for (const testCase of CASES) {
  const result = await build({
    stdin: { contents: testCase.code, resolveDir: process.cwd(), loader: "js" },
    bundle: true,
    format: "esm",
    minify: true,
    platform: "browser",
    alias,
    write: false,
    logLevel: "error"
  });

  const bytes = result.outputFiles[0].contents;
  console.log(
    `${testCase.name.padEnd(18)} ${kb(bytes.length).padStart(10)} ${kb(gzipSync(bytes).length).padStart(9)}   ${testCase.what}`
  );
}

console.log(
  "\nNo third-party code is pulled in by any of these except the last: Zod lives\n" +
    "behind @orthogea/core/schemas, and the XML parser behind\n" +
    "@orthogea/client/featureinfo."
);

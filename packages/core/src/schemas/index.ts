/**
 * `@orthogea/core/schemas` - the Zod contract behind every catalogue record.
 *
 * It is a separate entry point because validation is a build-time and
 * catalogue-authoring concern, while the rest of `@orthogea/core` runs in the
 * browser on the drawing path. Keeping Zod here means a web-GIS that only
 * renders imagery never ships a validator it does not run: importing the root
 * entry pulls in no third-party code at all.
 *
 * Import this entry when you author, load or verify catalogue documents:
 *
 * ```ts
 * import { OrthoGeaLayerSchema } from "@orthogea/core/schemas";
 *
 * const layer = OrthoGeaLayerSchema.parse(document);
 * ```
 *
 * The TypeScript types the schemas produce - `OrthoGeaLayer`, `Service`,
 * `LayerCollection` and the rest - stay on the root entry, because types are
 * erased and cost nothing.
 */

export * from "./bbox.js";
export * from "./enums.js";
export * from "./service.js";
export * from "./layer.js";
export * from "./nuts.js";

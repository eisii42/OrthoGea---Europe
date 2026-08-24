import { describe, expect, it } from "vitest";
import { isValidBBox } from "../spatial/bbox.js";
import { isValidNutsCode } from "../nuts/index.js";
import { GeoBoundingBoxSchema } from "./bbox.js";
import { NutsCodeSchema } from "./nuts.js";

/**
 * Two rules are stated twice in this codebase, on purpose.
 *
 * `isValidBBox` and `isValidNutsCode` run on the drawing path, where importing
 * Zod would put a validator into the bundle of every application that only
 * wants to render a map; the schemas state the same rules for catalogue
 * documents, where the error messages matter. These tests are what keeps the
 * two statements from drifting apart.
 */

describe("bounding box", () => {
  const cases: unknown[] = [
    [9.68, 42.23, 12.37, 44.47], // Tuscany
    [-180, -90, 180, 90], // the world
    [-180, -85.0511287798066, 180, 85.0511287798066], // Web Mercator
    [170, -10, -170, 10], // crossing the antimeridian
    [0, 0, 0, 0], // degenerate but well formed
    [1, 2, 3], // too short
    [1, 2, 3, 4, 5], // too long
    [0, 91, 10, 92], // latitude out of range
    [-181, 40, 10, 50], // longitude out of range
    [0, 40, 10, 30], // corners the wrong way round
    [0, 40, Number.NaN, 50], // not finite
    [0, 40, Number.POSITIVE_INFINITY, 50],
    ["9.68", "42.23", "12.37", "44.47"], // strings
    "9.68,42.23,12.37,44.47",
    null,
    undefined,
    {}
  ];

  it.each(cases.map((value, index) => [index, value]))(
    "guard and schema agree on case %i",
    (_index, value) => {
      expect(isValidBBox(value)).toBe(GeoBoundingBoxSchema.safeParse(value).success);
    }
  );
});

describe("NUTS code", () => {
  const cases = [
    "IT",
    "ITI",
    "ITI1",
    "ITI14",
    "EL", // Greece is EL in NUTS, GR in ISO
    "UK", // and UK in NUTS, GB in ISO
    "EU", // the pan-European pseudo-code
    "GR", // ISO, not NUTS
    "GB",
    "XX", // unknown country
    "ITI145", // too long
    "I", // too short
    "iti1", // lowercase
    "IT-I", // punctuation
    ""
  ];

  it.each(cases)("guard and schema agree on %j", (code) => {
    expect(isValidNutsCode(code)).toBe(NutsCodeSchema.safeParse(code).success);
  });
});

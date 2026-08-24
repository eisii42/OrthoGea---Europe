import { describe, expect, it } from "vitest";
import type { GeoBoundingBox } from "../schemas/bbox.js";
import {
  bboxAreaSqKm,
  bboxCenter,
  bboxContainsBBox,
  bboxContainsPoint,
  bboxFromPositions,
  bboxIntersection,
  bboxIntersects,
  bboxToPolygon,
  bboxUnion,
  clampBBox,
  expandBBox,
  formatBBox,
  isValidBBox,
  normalizeBBox,
  orderBBoxForCrs,
  parseBBox
} from "./bbox.js";

// Toscana, roughly.
const TUSCANY: GeoBoundingBox = [9.68, 42.23, 12.37, 44.47];
const ITALY: GeoBoundingBox = [6.62, 35.49, 18.51, 47.09];

describe("validation", () => {
  it("accepts a well-formed box", () => {
    expect(isValidBBox(TUSCANY)).toBe(true);
  });

  it("rejects malformed input", () => {
    expect(isValidBBox([1, 2, 3])).toBe(false);
    expect(isValidBBox([0, 91, 10, 92])).toBe(false);
    expect(isValidBBox([0, 40, 10, 30])).toBe(false);
    expect(isValidBBox("9.68,42.23,12.37,44.47")).toBe(false);
  });

  it("normalises swapped and out-of-range corners", () => {
    expect(normalizeBBox([12.37, 44.47, 9.68, 42.23])).toEqual(TUSCANY);
    expect(normalizeBBox([-200, -95, 200, 95])).toEqual([-180, -90, 180, 90]);
  });
});

describe("containment", () => {
  it("detects points inside and outside", () => {
    expect(bboxContainsPoint(TUSCANY, 11.25, 43.77)).toBe(true); // Firenze
    expect(bboxContainsPoint(TUSCANY, 12.49, 41.9)).toBe(false); // Roma
  });

  it("handles antimeridian-crossing boxes", () => {
    const fiji: GeoBoundingBox = [177, -19, -178, -16];
    expect(bboxContainsPoint(fiji, 179.5, -17)).toBe(true);
    expect(bboxContainsPoint(fiji, -179, -17)).toBe(true);
    expect(bboxContainsPoint(fiji, 100, -17)).toBe(false);
  });

  it("compares boxes", () => {
    expect(bboxContainsBBox(ITALY, TUSCANY)).toBe(true);
    expect(bboxContainsBBox(TUSCANY, ITALY)).toBe(false);
    expect(bboxIntersects(TUSCANY, ITALY)).toBe(true);
    expect(bboxIntersects(TUSCANY, [0, 0, 1, 1])).toBe(false);
  });
});

describe("algebra", () => {
  it("intersects", () => {
    expect(bboxIntersection(TUSCANY, ITALY)).toEqual(TUSCANY);
    expect(bboxIntersection(TUSCANY, [0, 0, 1, 1])).toBeNull();
  });

  it("unions", () => {
    expect(bboxUnion(TUSCANY, [6.62, 35.49, 10, 40])).toEqual([6.62, 35.49, 12.37, 44.47]);
  });

  it("computes centre, area and derived boxes", () => {
    const [lng, lat] = bboxCenter([10, 42, 12, 44]);
    expect(lng).toBeCloseTo(11, 10);
    expect(lat).toBeCloseTo(43, 10);
    expect(bboxAreaSqKm(TUSCANY)).toBeGreaterThan(40000);
    expect(expandBBox([10, 42, 12, 44], 1)).toEqual([9, 41, 13, 45]);
    expect(clampBBox(ITALY, TUSCANY)).toEqual(TUSCANY);
  });

  it("builds boxes from positions and polygons from boxes", () => {
    expect(bboxFromPositions([[10, 42], [12, 44], [11, 40]])).toEqual([10, 40, 12, 44]);
    const polygon = bboxToPolygon([10, 42, 12, 44]);
    expect(polygon.type).toBe("Polygon");
    expect(polygon.coordinates[0]).toHaveLength(5);
    expect(polygon.coordinates[0]?.[0]).toEqual(polygon.coordinates[0]?.[4]);
  });
});

describe("axis-order aware serialisation", () => {
  it("keeps lon/lat order for WMS 1.1.1 whatever the CRS", () => {
    expect(formatBBox(TUSCANY, { crs: "EPSG:4326", wmsVersion: "1.1.1" })).toBe(
      "9.68,42.23,12.37,44.47"
    );
  });

  it("swaps to lat/lon for EPSG:4326 in WMS 1.3.0", () => {
    expect(formatBBox(TUSCANY, { crs: "EPSG:4326", wmsVersion: "1.3.0" })).toBe(
      "42.23,9.68,44.47,12.37"
    );
  });

  it("keeps lon/lat for CRS:84 and EPSG:3857 in WMS 1.3.0", () => {
    expect(formatBBox(TUSCANY, { crs: "CRS:84", wmsVersion: "1.3.0" })).toBe(
      "9.68,42.23,12.37,44.47"
    );
    expect(formatBBox([0, 0, 100, 100], { crs: "EPSG:3857", wmsVersion: "1.3.0" })).toBe(
      "0,0,100,100"
    );
  });

  it("swaps for EPSG:6706, the Italian INSPIRE geographic CRS", () => {
    expect(orderBBoxForCrs(TUSCANY, "EPSG:6706")).toEqual([42.23, 9.68, 44.47, 12.37]);
    expect(orderBBoxForCrs(TUSCANY, "EPSG:6706", "1.1.1")).toEqual(TUSCANY);
  });

  it("round-trips through parseBBox", () => {
    const wire = formatBBox(TUSCANY, { crs: "EPSG:4326", wmsVersion: "1.3.0" });
    expect(parseBBox(wire, { crs: "EPSG:4326", wmsVersion: "1.3.0" })).toEqual(TUSCANY);
    expect(parseBBox("bogus")).toBeUndefined();
  });

  it("honours the requested precision", () => {
    expect(formatBBox(TUSCANY, { crs: "CRS:84", precision: 1 })).toBe("9.7,42.2,12.4,44.5");
  });
});

import { describe, expect, it } from "vitest";
import {
  MERCATOR_HALF_WORLD,
  bboxFromMercator,
  bboxToMercator,
  lngLatToMercator,
  lngLatToTile,
  mercatorToLngLat,
  metersPerPixel,
  tileToBBox,
  tileToMercatorBBox,
  zoomFromMetersPerPixel
} from "./mercator.js";
import { bboxContainsPoint } from "./bbox.js";

const FIRENZE: [number, number] = [11.2558, 43.7696];

describe("web mercator", () => {
  it("projects the origin and the antimeridian", () => {
    expect(lngLatToMercator(0, 0)).toEqual([0, 0]);
    const [x] = lngLatToMercator(180, 0);
    expect(x).toBeCloseTo(MERCATOR_HALF_WORLD, 6);
  });

  it("projects Firenze within 50 m of the reference EPSG:3857 position", () => {
    const [x, y] = lngLatToMercator(...FIRENZE);
    expect(x).toBeCloseTo(1252993, -2);
    expect(y).toBeCloseTo(5429856, -2);
  });

  it("round-trips coordinates", () => {
    const [lng, lat] = mercatorToLngLat(...lngLatToMercator(...FIRENZE));
    expect(lng).toBeCloseTo(FIRENZE[0], 9);
    expect(lat).toBeCloseTo(FIRENZE[1], 9);
  });

  it("clamps latitudes outside the mercator domain", () => {
    const [, yNorth] = lngLatToMercator(0, 89);
    expect(yNorth).toBeCloseTo(MERCATOR_HALF_WORLD, 3);
  });

  it("round-trips bounding boxes", () => {
    const bbox: [number, number, number, number] = [9.68, 42.23, 12.37, 44.47];
    const restored = bboxFromMercator(bboxToMercator(bbox));
    restored.forEach((value, index) => expect(value).toBeCloseTo(bbox[index] as number, 9));
  });
});

describe("tile maths", () => {
  it("computes ground resolution", () => {
    expect(metersPerPixel(0)).toBeCloseTo(156543.03, 1);
    expect(metersPerPixel(18)).toBeCloseTo(0.5972, 3);
    expect(metersPerPixel(18, 512)).toBeCloseTo(metersPerPixel(19, 256), 9);
    expect(zoomFromMetersPerPixel(metersPerPixel(14))).toBeCloseTo(14, 9);
  });

  it("returns the whole world for tile 0/0/0", () => {
    const [minX, minY, maxX, maxY] = tileToMercatorBBox(0, 0, 0);
    expect(minX).toBeCloseTo(-MERCATOR_HALF_WORLD, 6);
    expect(maxX).toBeCloseTo(MERCATOR_HALF_WORLD, 6);
    expect(minY).toBeCloseTo(-MERCATOR_HALF_WORLD, 6);
    expect(maxY).toBeCloseTo(MERCATOR_HALF_WORLD, 6);
  });

  it("locates a tile that actually contains the coordinate", () => {
    for (const zoom of [8, 10, 14, 18]) {
      const [x, y] = lngLatToTile(FIRENZE[0], FIRENZE[1], zoom);
      expect(bboxContainsPoint(tileToBBox(x, y, zoom), FIRENZE[0], FIRENZE[1])).toBe(true);
    }
  });

  it("splits the world in four at zoom 1", () => {
    expect(lngLatToTile(0.001, -0.001, 1)).toEqual([1, 1]);
    expect(lngLatToTile(-10, 10, 1)).toEqual([0, 0]);
  });
});

import { describe, expect, it } from "vitest";
import { UnsupportedServiceError, tileToBBox, tileToMercatorBBox } from "@orthogea/core";
import {
  cadastreLayer,
  cadastreNoMercatorLayer,
  wfsLayer,
  wmtsLayer,
  xyzLayer
} from "./__fixtures__/layers.js";
import { createTileUrlBuilder, fillTileTemplate } from "./tiles.js";

const TILE = { x: 8746, y: 6015, z: 14 };

describe("createTileUrlBuilder", () => {
  it("asks a Web Mercator WMS for the exact tile extent", () => {
    const url = new URL(createTileUrlBuilder(cadastreLayer)(TILE.x, TILE.y, TILE.z));
    const expected = tileToMercatorBBox(TILE.x, TILE.y, TILE.z);
    const sent = (url.searchParams.get("BBOX") ?? "").split(",").map(Number);

    expect(url.searchParams.get("CRS")).toBe("EPSG:3857");
    expect(sent[0]).toBeCloseTo(expected[0], 6);
    expect(sent[3]).toBeCloseTo(expected[3], 6);
  });

  it("switches to a geographic CRS when Web Mercator is missing", () => {
    const url = new URL(createTileUrlBuilder(cadastreNoMercatorLayer)(TILE.x, TILE.y, TILE.z));
    const expected = tileToBBox(TILE.x, TILE.y, TILE.z);
    const sent = (url.searchParams.get("BBOX") ?? "").split(",").map(Number);

    expect(url.searchParams.get("CRS")).toBe("EPSG:6706");
    // EPSG:6706 is latitude-first in WMS 1.3.0.
    expect(sent[0]).toBeCloseTo(expected[1], 9);
    expect(sent[1]).toBeCloseTo(expected[0], 9);
  });

  it("fills WMTS templates", () => {
    const url = createTileUrlBuilder(wmtsLayer)(TILE.x, TILE.y, TILE.z);
    expect(url).toContain("TILEMATRIX=14");
    expect(url).toContain("TILEROW=6015");
    expect(url).toContain("TILECOL=8746");
  });

  it("fills XYZ templates and spreads over the subdomains", () => {
    const build = createTileUrlBuilder(xyzLayer);
    const urls = new Set([
      build(1, 1, 5),
      build(2, 1, 5),
      build(3, 1, 5),
      build(4, 1, 5)
    ]);
    expect(urls.size).toBeGreaterThan(1);
    expect(build(1, 1, 5)).toMatch(/^https:\/\/[abc]\.tile\.openstreetmap\.org\/5\/1\/1\.png$/);
  });

  it("refuses services without a tile pyramid", () => {
    expect(() => createTileUrlBuilder(wfsLayer)).toThrow(UnsupportedServiceError);
  });
});

describe("fillTileTemplate", () => {
  it("substitutes every placeholder", () => {
    expect(fillTileTemplate("https://x/{z}/{x}/{y}.png", 3, 4, 5)).toBe("https://x/5/3/4.png");
  });
});

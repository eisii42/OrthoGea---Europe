import { describe, expect, it } from "vitest";
import {
  crsEquivalents,
  getAxisOrder,
  getCrsDefinition,
  isGeographicCrs,
  isSameCrs,
  normalizeCrs,
  normalizeKnownCrs,
  parseCrs,
  registerCrs
} from "./normalize.js";

describe("parseCrs", () => {
  it.each([
    ["EPSG:4326", { authority: "EPSG", identifier: "4326" }],
    ["epsg::4326", { authority: "EPSG", identifier: "4326" }],
    ["urn:ogc:def:crs:EPSG:6.18.3:4326", { authority: "EPSG", identifier: "4326" }],
    ["urn:ogc:def:crs:EPSG::3857", { authority: "EPSG", identifier: "3857" }],
    ["urn:ogc:def:crs:OGC:1.3:CRS84", { authority: "OGC", identifier: "CRS84" }],
    ["http://www.opengis.net/def/crs/EPSG/0/25832", { authority: "EPSG", identifier: "25832" }],
    ["http://www.opengis.net/gml/srs/epsg.xml#3003", { authority: "EPSG", identifier: "3003" }],
    ["4326", { authority: "EPSG", identifier: "4326" }]
  ])("splits %s", (input, expected) => {
    expect(parseCrs(input)).toEqual(expected);
  });

  it("returns undefined for junk", () => {
    expect(parseCrs("not a crs at all!")).toBeUndefined();
  });
});

describe("normalizeCrs", () => {
  it.each([
    ["EPSG:4326", "EPSG:4326"],
    ["epsg:4326", "EPSG:4326"],
    ["urn:ogc:def:crs:EPSG::4326", "EPSG:4326"],
    ["urn:ogc:def:crs:OGC:1.3:CRS84", "CRS:84"],
    ["CRS84", "CRS:84"],
    ["CRS:84", "CRS:84"],
    ["EPSG:900913", "EPSG:3857"],
    ["EPSG:102100", "EPSG:3857"],
    ["  epsg:3857 ", "EPSG:3857"],
    ["EPSG:6706", "EPSG:6706"],
    ["EPSG:3003", "EPSG:3003"]
  ])("maps %s to %s", (input, expected) => {
    expect(normalizeCrs(input)).toBe(expected);
  });

  it("keeps unknown but well-formed codes in authority:identifier form", () => {
    expect(normalizeCrs("IGNF:LAMB93")).toBe("IGNF:LAMB93");
    expect(normalizeKnownCrs("IGNF:LAMB93")).toBeUndefined();
  });
});

describe("axis order", () => {
  it("uses latitude first for EPSG geographic CRS in WMS 1.3.0", () => {
    expect(getAxisOrder("EPSG:4326")).toBe("latlon");
    expect(getAxisOrder("EPSG:6706")).toBe("latlon");
    expect(getAxisOrder("EPSG:4258")).toBe("latlon");
  });

  it("uses longitude first for CRS:84 and projected CRS", () => {
    expect(getAxisOrder("CRS:84")).toBe("lonlat");
    expect(getAxisOrder("EPSG:3857")).toBe("lonlat");
    expect(getAxisOrder("EPSG:3003")).toBe("lonlat");
  });

  it("keeps northing first for EPSG:3035 and EPSG:2180", () => {
    expect(getAxisOrder("EPSG:3035")).toBe("latlon");
    expect(getAxisOrder("EPSG:2180")).toBe("latlon");
  });

  it("always uses longitude first in WMS 1.1.1", () => {
    expect(getAxisOrder("EPSG:4326", "1.1.1")).toBe("lonlat");
    expect(getAxisOrder("EPSG:6706", "1.1.1")).toBe("lonlat");
  });

  it("falls back to longitude first for unknown CRS", () => {
    expect(getAxisOrder("EPSG:99999")).toBe("lonlat");
  });
});

describe("equivalence", () => {
  it("treats the pseudo-mercator aliases as the same CRS", () => {
    expect(isSameCrs("EPSG:3857", "EPSG:900913")).toBe(true);
    expect(isSameCrs("urn:ogc:def:crs:EPSG::3857", "EPSG:102100")).toBe(true);
    expect(crsEquivalents("EPSG:900913")).toContain("EPSG:3857");
  });

  it("treats CRS:84 and EPSG:4326 as the same datum", () => {
    expect(isSameCrs("CRS:84", "EPSG:4326")).toBe(true);
  });

  it("keeps unrelated CRS apart", () => {
    expect(isSameCrs("EPSG:3857", "EPSG:4326")).toBe(false);
  });
});

describe("registry", () => {
  it("exposes metadata for bundled CRS", () => {
    expect(getCrsDefinition("EPSG:3003")?.name).toBe("Monte Mario / Italy zone 1");
    expect(isGeographicCrs("EPSG:6706")).toBe(true);
    expect(isGeographicCrs("EPSG:3857")).toBe(false);
  });

  it("accepts runtime registrations", () => {
    registerCrs({
      code: "EPSG:2056",
      authority: "EPSG",
      name: "CH1903+ / LV95",
      kind: "projected",
      axisOrder: "lonlat",
      units: "metre",
      aliases: ["LV95"]
    });
    expect(normalizeCrs("LV95")).toBe("EPSG:2056");
    expect(getCrsDefinition("urn:ogc:def:crs:EPSG::2056")?.name).toBe("CH1903+ / LV95");
  });
});

import { describe, expect, it } from "vitest";
import {
  UnsupportedServiceError,
  metersPerPixel,
  type OrthoGeaLayer,
  type WmsService
} from "@orthogea/core";
import {
  cadastreLayer,
  cadastreNoMercatorLayer,
  orthophotoLayer,
  xyzLayer
} from "../__fixtures__/layers.js";
import {
  assertQueryableWms,
  buildGetFeatureInfoUrl,
  pickInfoFormat,
  resolveFeatureInfoWindow,
  resolveQueryCrs
} from "./query.js";

const params = (url: string): URLSearchParams => new URL(url).searchParams;

const wmsService = (layer: OrthoGeaLayer): WmsService => {
  if (layer.service.type !== "WMS") throw new Error(`${layer.id} is not a WMS layer`);
  return layer.service;
};

describe("resolveFeatureInfoWindow", () => {
  it("maps a click inside the viewport to a pixel", () => {
    const window = resolveFeatureInfoWindow({
      lngLat: [11, 44],
      bbox: [10, 43, 12, 45],
      width: 1000,
      height: 1000
    });
    expect(window.crs).toBe("EPSG:3857");
    expect(window.width).toBe(1000);
    // Longitude is linear in Web Mercator, so the horizontal pixel is exact.
    expect(window.i).toBe(500);
    // Latitude is not, but the click stays within a couple of pixels of centre.
    expect(window.j).toBeGreaterThan(495);
    expect(window.j).toBeLessThan(505);
  });

  it("clamps clicks that fall outside the canvas", () => {
    const window = resolveFeatureInfoWindow({
      lngLat: [30, 44],
      bbox: [10, 43, 12, 45],
      width: 800,
      height: 600
    });
    expect(window.i).toBe(799);
    expect(window.j).toBeGreaterThanOrEqual(0);
  });

  it("honours an explicit pixel position", () => {
    const window = resolveFeatureInfoWindow({
      lngLat: [11, 44],
      bbox: [10, 43, 12, 45],
      width: 1000,
      height: 1000,
      pixel: { x: 12, y: 34 }
    });
    expect(window.i).toBe(12);
    expect(window.j).toBe(34);
  });

  it("synthesises a square window from the zoom level", () => {
    const window = resolveFeatureInfoWindow({ lngLat: [11.2558, 43.7696], zoom: 16 });
    expect(window.width).toBe(101);
    expect(window.height).toBe(101);
    expect(window.i).toBe(50);
    expect(window.j).toBe(50);
    const span = window.bbox[2] - window.bbox[0];
    expect(span).toBeCloseTo(101 * metersPerPixel(16), 3);
  });
});

describe("pickInfoFormat", () => {
  it("prefers machine-readable formats", () => {
    expect(pickInfoFormat(["text/html", "application/json"])).toBe("application/json");
    expect(pickInfoFormat(["text/html", "text/plain"])).toBe("text/html");
    expect(pickInfoFormat([])).toBe("text/html");
    expect(pickInfoFormat(["text/html"], "text/plain")).toBe("text/plain");
  });
});

describe("buildGetFeatureInfoUrl", () => {
  it("uses I/J and CRS on WMS 1.3.0", () => {
    const url = buildGetFeatureInfoUrl(
      wmsService(cadastreLayer),
      { lngLat: [11.2558, 43.7696], bbox: [10, 43, 12, 45], width: 1000, height: 1000 }
    );
    const query = params(url);

    expect(query.get("SERVICE")).toBe("WMS");
    expect(query.get("VERSION")).toBe("1.3.0");
    expect(query.get("REQUEST")).toBe("GetFeatureInfo");
    expect(query.get("QUERY_LAYERS")).toBe("CP.CadastralParcel");
    expect(query.get("LAYERS")).toBe("CP.CadastralParcel");
    expect(query.get("INFO_FORMAT")).toBe("application/json");
    expect(query.get("FEATURE_COUNT")).toBe("10");
    expect(query.get("CRS")).toBe("EPSG:3857");
    expect(query.get("SRS")).toBeNull();
    expect(query.get("I")).not.toBeNull();
    expect(query.get("J")).not.toBeNull();
    expect(query.get("X")).toBeNull();
    expect(query.get("BBOX")?.split(",")).toHaveLength(4);
  });

  it("uses X/Y and SRS on WMS 1.1.1", () => {
    const url = buildGetFeatureInfoUrl(wmsService(orthophotoLayer), {
      lngLat: [11, 43.5],
      zoom: 15
    });
    const query = params(url);

    expect(query.get("VERSION")).toBe("1.1.1");
    expect(query.get("SRS")).toBe("EPSG:3857");
    expect(query.get("CRS")).toBeNull();
    expect(query.get("X")).toBe("50");
    expect(query.get("Y")).toBe("50");
    expect(query.get("INFO_FORMAT")).toBe("text/plain");
    expect(query.get("WIDTH")).toBe("101");
  });

  it("keeps the BBOX in longitude/latitude order for EPSG:3857", () => {
    const url = buildGetFeatureInfoUrl(wmsService(cadastreLayer), {
      lngLat: [11, 44],
      zoom: 14
    });
    const [minX, minY, maxX, maxY] = (params(url).get("BBOX") ?? "")
      .split(",")
      .map(Number);
    expect(minX as number).toBeLessThan(maxX as number);
    expect(minY as number).toBeLessThan(maxY as number);
    // Web Mercator eastings around 11E are near 1.2 million metres.
    expect(minX as number).toBeGreaterThan(1_200_000);
    expect(minY as number).toBeGreaterThan(5_000_000);
  });

  it("passes the vendor buffer and extra parameters", () => {
    const url = buildGetFeatureInfoUrl(
      wmsService(cadastreLayer),
      { lngLat: [11, 44], zoom: 14, buffer: 5, featureCount: 3, infoFormat: "text/html" },
      { extraParams: { map: "catasto" } }
    );
    const query = params(url);
    expect(query.get("BUFFER")).toBe("5");
    expect(query.get("RADIUS")).toBe("5");
    expect(query.get("FEATURE_COUNT")).toBe("3");
    expect(query.get("INFO_FORMAT")).toBe("text/html");
    expect(query.get("map")).toBe("catasto");
  });

  it("supports a CORS proxy", () => {
    const url = buildGetFeatureInfoUrl(
      wmsService(cadastreLayer),
      { lngLat: [11, 44], zoom: 14 },
      { proxyUrl: "https://cors.test/?url=" }
    );
    expect(url.startsWith("https://cors.test/?url=https%3A%2F%2Fwms.example.gov.it")).toBe(true);
  });
});

describe("assertQueryableWms", () => {
  it("accepts a queryable WMS layer", () => {
    expect(assertQueryableWms(cadastreLayer).type).toBe("WMS");
  });

  it("rejects non-WMS layers", () => {
    expect(() => assertQueryableWms(xyzLayer)).toThrow(UnsupportedServiceError);
    expect(() => assertQueryableWms(xyzLayer)).toThrow(/XYZ service/);
  });

  it("rejects WMS layers that are not queryable", () => {
    const service = wmsService(cadastreLayer);
    const notQueryable: OrthoGeaLayer = {
      ...cadastreLayer,
      service: { ...service, options: { ...service.options, queryable: false } }
    };
    expect(() => assertQueryableWms(notQueryable)).toThrow(/not queryable/);
  });
});

describe("services without EPSG:3857", () => {
  it("writes the query in a geographic CRS with the click at the centre", () => {
    const url = buildGetFeatureInfoUrl(wmsService(cadastreNoMercatorLayer), {
      lngLat: [11.2554, 43.7712],
      zoom: 18
    });
    const query = params(url);

    expect(query.get("CRS")).toBe("EPSG:6706");
    expect(query.get("I")).toBe("50");
    expect(query.get("J")).toBe("50");
    expect(query.get("WIDTH")).toBe("101");

    // EPSG:6706 is latitude-first, and the click sits exactly at the centre.
    const bbox = (query.get("BBOX") ?? "").split(",").map(Number);
    expect(((bbox[0] as number) + (bbox[2] as number)) / 2).toBeCloseTo(43.7712, 6);
    expect(((bbox[1] as number) + (bbox[3] as number)) / 2).toBeCloseTo(11.2554, 6);
  });

  it("reports the CRS the query will use", () => {
    expect(resolveQueryCrs(wmsService(cadastreLayer))).toBe("EPSG:3857");
    expect(resolveQueryCrs(wmsService(cadastreNoMercatorLayer))).toBe("EPSG:6706");
    expect(resolveQueryCrs(wmsService(cadastreLayer), "EPSG:4326")).toBe("EPSG:4326");
  });
});

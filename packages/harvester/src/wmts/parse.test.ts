import { describe, expect, it } from "vitest";
import { CapabilitiesParseError } from "@orthogea/core";
import { WMTS_100_CAPABILITIES } from "../__fixtures__/wmts100.js";
import { findWmtsLayer, parseWmtsCapabilities } from "./parse.js";

describe("WMTS 1.0.0", () => {
  const capabilities = parseWmtsCapabilities(WMTS_100_CAPABILITIES);

  it("reads service identification and provider", () => {
    expect(capabilities.version).toBe("1.0.0");
    expect(capabilities.service.title).toBe("Sentinel-2 tiles");
    expect(capabilities.service.providerName).toBe("Copernicus Data Space Ecosystem");
    expect(capabilities.service.providerSite).toBe("https://dataspace.copernicus.eu/");
    expect(capabilities.service.keywords).toEqual(["Sentinel-2", "satellite"]);
  });

  it("reads operations with their request encodings", () => {
    expect(capabilities.operations.getTile?.url).toBe("https://tiles.example.eu/wmts?");
    expect(capabilities.operations.getTile?.encodings).toEqual(["KVP", "REST"]);
    expect(capabilities.operations.getFeatureInfo?.encodings).toEqual(["KVP"]);
  });

  it("reads layers, formats and styles", () => {
    const layer = findWmtsLayer(capabilities, "TRUE_COLOR");
    expect(layer?.title).toBe("Sentinel-2 True Colour");
    expect(layer?.formats).toEqual(["image/jpeg", "image/png"]);
    expect(layer?.styles[0]).toEqual({
      identifier: "default",
      title: undefined,
      isDefault: true,
      legendUrl: undefined
    });
    expect(layer?.queryable).toBe(true);
    expect(layer?.infoFormats).toEqual(["application/json"]);
  });

  it("reads WGS84BoundingBox as longitude/latitude", () => {
    expect(findWmtsLayer(capabilities, "TRUE_COLOR")?.bbox).toEqual([-25, 32, 45, 72]);
  });

  it("reads REST resource templates and dimensions", () => {
    const layer = findWmtsLayer(capabilities, "TRUE_COLOR");
    expect(layer?.resourceUrls[0]?.template).toContain("{TileMatrix}/{TileRow}/{TileCol}");
    expect(layer?.dimensions[0]).toEqual({
      identifier: "TIME",
      units: "ISO8601",
      default: "2024-06-01",
      values: ["2024-06-01", "2024-07-01"]
    });
    expect(layer?.tileMatrixSets).toEqual(["GoogleMapsCompatible"]);
  });

  it("normalises the SupportedCRS urn of every matrix set", () => {
    expect(capabilities.tileMatrixSets["GoogleMapsCompatible"]?.crs).toBe("EPSG:3857");
    expect(capabilities.tileMatrixSets["EPSG:4326"]?.crs).toBe("EPSG:4326");
  });

  it("reads tile matrices and keeps corners in x/y order", () => {
    const matrix = capabilities.tileMatrixSets["GoogleMapsCompatible"]?.tileMatrices[0];
    expect(matrix?.identifier).toBe("0");
    expect(matrix?.scaleDenominator).toBeCloseTo(559082264.03, 2);
    expect(matrix?.topLeftCorner[0]).toBeCloseTo(-20037508.34, 2);
    expect(matrix?.topLeftCorner[1]).toBeCloseTo(20037508.34, 2);
    expect(matrix?.tileWidth).toBe(256);
    expect(matrix?.matrixHeight).toBe(1);
  });

  it("swaps the latitude-first TopLeftCorner of an EPSG:4326 matrix set", () => {
    const matrix = capabilities.tileMatrixSets["EPSG:4326"]?.tileMatrices[0];
    expect(matrix?.topLeftCorner).toEqual([-180, 90]);
  });

  it("rejects documents that are not WMTS capabilities", () => {
    expect(() => parseWmtsCapabilities("<WMS_Capabilities/>")).toThrow(CapabilitiesParseError);
  });
});

import { describe, expect, it } from "vitest";
import { OrthoGeaLayerSchema, parseLayer, safeParseLayer, type OrthoGeaLayerInput } from "./layer.js";

const toscana: OrthoGeaLayerInput = {
  id: "it.toscana.ortofoto",
  title: "Ortofoto Toscana",
  category: "orthophoto",
  provider: { name: "Regione Toscana", url: "https://www.regione.toscana.it/" },
  country: "IT",
  nuts: "ITI1",
  regionName: "Toscana",
  bbox: [9.68, 42.23, 12.37, 44.47],
  service: {
    type: "WMS",
    url: "https://example.org/geoserver/wms",
    options: {
      layers: ["rt_ofc.10k22"],
      crs: ["urn:ogc:def:crs:EPSG::3857", "epsg:6706"],
      queryable: true,
      infoFormats: ["text/html"]
    }
  },
  license: { id: "CC-BY-4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
  attribution: "Regione Toscana"
};

describe("OrthoGeaLayerSchema", () => {
  it("applies defaults", () => {
    const layer = parseLayer(toscana);
    expect(layer.status).toBe("active");
    expect(layer.minZoom).toBe(0);
    expect(layer.maxZoom).toBe(20);
    expect(layer.tags).toEqual([]);
    expect(layer.service.type).toBe("WMS");
    if (layer.service.type === "WMS") {
      expect(layer.service.options.version).toBe("1.3.0");
      expect(layer.service.options.format).toBe("image/png");
      expect(layer.service.options.transparent).toBe(true);
      expect(layer.service.options.tileSize).toBe(256);
      expect(layer.service.options.styles).toEqual([]);
    }
  });

  it("normalises every CRS spelling on parse", () => {
    const layer = parseLayer(toscana);
    if (layer.service.type !== "WMS") throw new Error("expected a WMS layer");
    expect(layer.service.options.crs).toEqual(["EPSG:3857", "EPSG:6706"]);
  });

  it("rejects unknown properties", () => {
    const result = safeParseLayer({ ...toscana, colour: "red" });
    expect(result.success).toBe(false);
  });

  it("rejects a NUTS code from another country", () => {
    const result = safeParseLayer({ ...toscana, country: "ES" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("does not belong to country");
    }
  });

  it("rejects an inverted zoom range", () => {
    expect(safeParseLayer({ ...toscana, minZoom: 12, maxZoom: 8 }).success).toBe(false);
  });

  it("rejects an invalid bbox", () => {
    expect(safeParseLayer({ ...toscana, bbox: [9.68, 44.47, 12.37, 42.23] }).success).toBe(false);
    expect(safeParseLayer({ ...toscana, bbox: [9.68, 42.23, 12.37] }).success).toBe(false);
  });

  it("rejects an id that is not dot/dash separated lowercase", () => {
    expect(safeParseLayer({ ...toscana, id: "IT Toscana Ortofoto" }).success).toBe(false);
  });

  it("requires a name for custom licences", () => {
    expect(safeParseLayer({ ...toscana, license: { id: "custom" } }).success).toBe(false);
    expect(
      safeParseLayer({
        ...toscana,
        license: { id: "custom", name: "Regione Toscana open data terms" }
      }).success
    ).toBe(true);
  });

  it("requires a non-empty LAYERS list for WMS", () => {
    const result = safeParseLayer({
      ...toscana,
      service: { ...toscana.service, options: { ...(toscana.service as { options: object }).options, layers: [] } }
    });
    expect(result.success).toBe(false);
  });

  it("accepts pan-European layers with country EU", () => {
    const layer = OrthoGeaLayerSchema.parse({
      ...toscana,
      id: "eu.copernicus.sentinel2",
      country: "EU",
      nuts: undefined,
      bbox: [-25, 32, 45, 72]
    });
    expect(layer.country).toBe("EU");
  });
});

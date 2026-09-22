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
      expect(result.error.issues[0]?.message).toContain("belongs to IT");
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

  it("pairs an ISO country with its NUTS code where the two spellings differ", () => {
    // Greece and the United Kingdom are the only codes where ISO 3166 and
    // NUTS-0 disagree. A string comparison of the two fields would reject
    // these, which is precisely the bug the conversion avoids.
    expect(
      safeParseLayer({ ...toscana, id: "gr.ktimatologio.ortho", country: "GR", nuts: "EL3" })
        .success
    ).toBe(true);
    expect(
      safeParseLayer({ ...toscana, id: "gb.os.aerial", country: "GB", nuts: "UKI" }).success
    ).toBe(true);
    // ...and the mismatch is still caught across the conversion.
    expect(
      safeParseLayer({ ...toscana, id: "gr.wrong", country: "GR", nuts: "UKI" }).success
    ).toBe(false);
  });

  it("accepts a source outside the NUTS area", () => {
    const layer = parseLayer({
      ...toscana,
      id: "us.usda.naip",
      country: "US",
      nuts: undefined,
      regionName: undefined,
      bbox: [-125, 24, -66, 50]
    });
    expect(layer.country).toBe("US");
    expect(layer.nuts).toBeUndefined();
  });

  it("accepts coverage boxes that narrow the advertised extent", () => {
    const layer = parseLayer({
      ...toscana,
      coverage: [
        [9.68, 43.0, 11.0, 44.47],
        [11.0, 42.23, 12.37, 44.0]
      ]
    });
    expect(layer.coverage).toHaveLength(2);
  });

  it("rejects a coverage box reaching outside bbox", () => {
    // Coverage narrows the hull; a box that widens it would claim ground the
    // service never offered.
    const result = safeParseLayer({
      ...toscana,
      coverage: [[9.68, 42.23, 13.5, 44.47]]
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("reaches outside bbox");
    }
  });
});

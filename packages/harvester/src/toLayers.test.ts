import { describe, expect, it } from "vitest";
import { WMS_111_CAPABILITIES } from "./__fixtures__/wms111.js";
import { WMTS_100_CAPABILITIES } from "./__fixtures__/wmts100.js";
import { findLayer, parseWmsCapabilities } from "./wms/parse.js";
import { findWmtsLayer, parseWmtsCapabilities } from "./wmts/parse.js";
import { buildLayerId, slugify, wmsLayerToOrthoGea, wmtsLayerToOrthoGea } from "./toLayers.js";

describe("id helpers", () => {
  it("slugifies accented titles", () => {
    expect(slugify("Ortofoto Regione Emilia-Romagna 2023")).toBe(
      "ortofoto-regione-emilia-romagna-2023"
    );
    expect(slugify("Còrsica / Sardegna")).toBe("corsica-sardegna");
  });

  it("builds dotted ids", () => {
    expect(buildLayerId("IT", "Toscana", "Ortofoto 2022")).toBe("it.toscana.ortofoto-2022");
  });
});

describe("wmsLayerToOrthoGea", () => {
  const capabilities = parseWmsCapabilities(WMS_111_CAPABILITIES, {
    endpointUrl: "https://geoserver.example.it/geoscopio/wms"
  });
  const parsed = findLayer(capabilities, "rt_ofc.10k22.32bit");

  it("produces a schema-valid catalogue record", () => {
    const layer = wmsLayerToOrthoGea(capabilities, parsed!, {
      id: "it.toscana.ortofoto-2022",
      category: "orthophoto",
      country: "IT",
      nuts: "ITI1",
      regionName: "Toscana",
      provider: { name: "Regione Toscana", url: "https://www.regione.toscana.it/" },
      license: { id: "CC-BY-4.0" },
      attribution: "Regione Toscana - Geoscopio"
    });

    expect(layer.id).toBe("it.toscana.ortofoto-2022");
    expect(layer.title).toBe("Orthophoto 2022 - 20 cm");
    expect(layer.bbox).toEqual([9.68, 42.23, 12.37, 44.47]);
    expect(layer.service.type).toBe("WMS");
    if (layer.service.type !== "WMS") throw new Error("expected WMS");
    expect(layer.service.url).toBe("https://geoserver.example.it/geoscopio/wms");
    expect(layer.service.options.layers).toEqual(["rt_ofc.10k22.32bit"]);
    expect(layer.service.options.version).toBe("1.1.1");
    expect(layer.service.options.queryable).toBe(true);
    expect(layer.service.options.infoFormats).toEqual(["text/plain", "text/html"]);
    // Orthophotos are opaque base layers, so transparency is switched off.
    expect(layer.service.options.transparent).toBe(false);
    expect(layer.service.options.crs[0]).toBe("EPSG:3857");
  });

  it("honours the requested format preference", () => {
    const layer = wmsLayerToOrthoGea(capabilities, parsed!, {
      category: "orthophoto",
      country: "IT",
      nuts: "ITI1",
      provider: { name: "Regione Toscana" },
      license: { id: "CC-BY-4.0" },
      preferredFormats: ["image/jpeg"]
    });
    if (layer.service.type !== "WMS") throw new Error("expected WMS");
    expect(layer.service.options.format).toBe("image/jpeg");
    expect(layer.id).toBe("it.rt-ofc-10k22-32bit");
  });

  it("applies overrides last", () => {
    const layer = wmsLayerToOrthoGea(capabilities, parsed!, {
      category: "orthophoto",
      country: "IT",
      provider: { name: "Regione Toscana" },
      license: { id: "CC-BY-4.0" },
      overrides: { maxZoom: 19, status: "experimental" }
    });
    expect(layer.maxZoom).toBe(19);
    expect(layer.status).toBe("experimental");
  });

  it("refuses layers that have no Name", () => {
    expect(() =>
      wmsLayerToOrthoGea(capabilities, capabilities.rootLayer!, {
        category: "orthophoto",
        country: "IT",
        provider: { name: "Regione Toscana" },
        license: { id: "CC-BY-4.0" }
      })
    ).toThrow(/no Name/);
  });
});

describe("wmtsLayerToOrthoGea", () => {
  const capabilities = parseWmtsCapabilities(WMTS_100_CAPABILITIES);
  const parsed = findWmtsLayer(capabilities, "TRUE_COLOR");

  it("picks the Web Mercator matrix set and the default style", () => {
    const layer = wmtsLayerToOrthoGea(capabilities, parsed!, {
      id: "eu.copernicus.sentinel2.true-color",
      category: "satellite",
      country: "EU",
      provider: { name: "Copernicus Data Space Ecosystem" },
      license: { id: "copernicus-free" },
      preferredFormats: ["image/jpeg"]
    });

    if (layer.service.type !== "WMTS") throw new Error("expected WMTS");
    expect(layer.service.options.tileMatrixSet).toBe("GoogleMapsCompatible");
    expect(layer.service.options.crs).toBe("EPSG:3857");
    expect(layer.service.options.style).toBe("default");
    expect(layer.service.options.format).toBe("image/jpeg");
    expect(layer.service.options.requestEncoding).toBe("KVP");
    expect(layer.service.options.queryable).toBe(true);
    expect(layer.bbox).toEqual([-25, 32, 45, 72]);
  });
});

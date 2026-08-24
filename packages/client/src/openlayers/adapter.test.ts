import { describe, expect, it } from "vitest";
import { UnsupportedServiceError } from "@orthogea/core";
import {
  cadastreLayer,
  orthophotoLayer,
  wfsLayer,
  wmtsLayer,
  wmtsRestLayer,
  xyzLayer
} from "../__fixtures__/layers.js";
import { toOpenLayersSource, toOpenLayersWmsSource } from "./adapter.js";

describe("TileWMS descriptors", () => {
  it("carries the identifying parameters and lets OpenLayers compute the rest", () => {
    const source = toOpenLayersWmsSource(cadastreLayer);
    expect(source.kind).toBe("TileWMS");
    expect(source.url).toBe("https://wms.example.gov.it/inspire/wms/owsproxy.sub?");
    expect(source.params).toMatchObject({
      LAYERS: "CP.CadastralParcel",
      FORMAT: "image/png",
      TRANSPARENT: true,
      VERSION: "1.3.0",
      TILED: true
    });
    // BBOX/WIDTH/HEIGHT are OpenLayers' job, they must not be pinned here.
    expect(source.params).not.toHaveProperty("BBOX");
    expect(source.attributions).toContain("Agenzia delle Entrate");
  });

  it("applies the CORS proxy to the endpoint", () => {
    const source = toOpenLayersWmsSource(orthophotoLayer, { proxyUrl: "https://cors.test/" });
    expect(source.url).toBe("https://cors.test/https://geoserver.example.it/geoscopio/wms");
    expect(source.params["VERSION"]).toBe("1.1.1");
  });

  it("accepts a server type hint", () => {
    expect(toOpenLayersWmsSource(cadastreLayer, { serverType: "geoserver" }).serverType).toBe(
      "geoserver"
    );
  });
});

describe("toOpenLayersSource", () => {
  it("describes XYZ layers with expanded subdomains", () => {
    const source = toOpenLayersSource(xyzLayer);
    expect(source.kind).toBe("XYZ");
    if (source.kind !== "XYZ") throw new Error("expected XYZ");
    expect(source.urls).toHaveLength(3);
    expect(source.attributions).toContain("OpenStreetMap");
  });

  it("describes WMTS layers with matrix set and projection", () => {
    const source = toOpenLayersSource(wmtsLayer);
    if (source.kind !== "WMTS") throw new Error("expected WMTS");
    expect(source.layer).toBe("TRUE_COLOR");
    expect(source.matrixSet).toBe("GoogleMapsCompatible");
    expect(source.projection).toBe("EPSG:3857");
    expect(source.requestEncoding).toBe("KVP");
    expect(source.dimensions).toEqual({ TIME: "2024-06-01" });
  });

  it("uses the ResourceURL template for REST encoded WMTS", () => {
    const source = toOpenLayersSource(wmtsRestLayer);
    if (source.kind !== "WMTS") throw new Error("expected WMTS");
    expect(source.requestEncoding).toBe("REST");
    expect(source.url).toContain("{TileMatrix}");
  });

  it("refuses WFS layers", () => {
    expect(() => toOpenLayersSource(wfsLayer)).toThrow(UnsupportedServiceError);
  });
});

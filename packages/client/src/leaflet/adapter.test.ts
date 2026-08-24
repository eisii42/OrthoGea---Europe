import { describe, expect, it } from "vitest";
import { UnsupportedServiceError } from "@orthogea/core";
import {
  cadastreLayer,
  cadastreNoMercatorLayer,
  orthophotoLayer,
  wfsLayer,
  wmtsLayer,
  xyzLayer
} from "../__fixtures__/layers.js";
import { toLeafletSource } from "./adapter.js";

describe("toLeafletSource", () => {
  it("describes a Web Mercator WMS as L.tileLayer.wms", () => {
    const source = toLeafletSource(cadastreLayer);
    expect(source.kind).toBe("tileLayer.wms");
    if (source.kind !== "tileLayer.wms") throw new Error("expected a WMS descriptor");

    expect(source.url).toBe("https://wms.example.gov.it/inspire/wms/owsproxy.sub?");
    expect(source.options.layers).toBe("CP.CadastralParcel");
    expect(source.options.version).toBe("1.3.0");
    expect(source.options.transparent).toBe(true);
    expect(source.options.uppercase).toBe(true);
    // Leaflet wants [[south, west], [north, east]].
    expect(source.options.bounds).toEqual([
      [35.4, 6.6],
      [47.2, 18.6]
    ]);
    expect(source.options.attribution).toContain("Agenzia delle Entrate");
  });

  it("falls back to a tile URL builder when the service has no EPSG:3857", () => {
    const source = toLeafletSource(cadastreNoMercatorLayer);
    expect(source.kind).toBe("tileLayer.custom");
    if (source.kind !== "tileLayer.custom") throw new Error("expected a custom descriptor");

    const url = new URL(source.getTileUrl(8746, 6015, 14));
    expect(url.searchParams.get("REQUEST")).toBe("GetMap");
    expect(url.searchParams.get("CRS")).toBe("EPSG:6706");
    expect(url.searchParams.get("WIDTH")).toBe("256");
  });

  it("keeps the {s} placeholder and the TMS flag for XYZ layers", () => {
    const source = toLeafletSource(xyzLayer);
    if (source.kind !== "tileLayer") throw new Error("expected a tile layer descriptor");
    expect(source.url).toBe("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png");
    expect(source.options.subdomains).toEqual(["a", "b", "c"]);
    expect(source.options.tms).toBe(false);
  });

  it("describes WMTS as a plain tile template", () => {
    const source = toLeafletSource(wmtsLayer);
    if (source.kind !== "tileLayer") throw new Error("expected a tile layer descriptor");
    expect(source.url).toContain("REQUEST=GetTile");
    expect(source.url).toContain("TILEMATRIX={z}");
  });

  it("applies the CORS proxy and honours the attribution switch", () => {
    const proxied = toLeafletSource(orthophotoLayer, {
      proxyUrl: "https://cors.test/",
      attribution: false
    });
    if (proxied.kind !== "tileLayer.wms") throw new Error("expected a WMS descriptor");
    expect(proxied.url).toBe("https://cors.test/https://geoserver.example.it/geoscopio/wms");
    expect(proxied.options.attribution).toBeUndefined();
  });

  it("refuses vector-only services", () => {
    expect(() => toLeafletSource(wfsLayer)).toThrow(UnsupportedServiceError);
  });
});

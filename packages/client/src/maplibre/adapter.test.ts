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
import {
  layerIdFor,
  sourceIdFor,
  toMapLibreBinding,
  toRasterLayer,
  toRasterSource,
  toStyleSpecification
} from "./adapter.js";

describe("toRasterSource - WMS", () => {
  it("builds the tiled GetMap template in EPSG:3857", () => {
    const source = toRasterSource(cadastreLayer);
    const template = source.tiles?.[0] ?? "";

    expect(source.type).toBe("raster");
    expect(template).toContain("SERVICE=WMS");
    expect(template).toContain("VERSION=1.3.0");
    expect(template).toContain("REQUEST=GetMap");
    expect(template).toContain("LAYERS=CP.CadastralParcel");
    expect(template).toContain("STYLES=");
    expect(template).toContain("FORMAT=image%2Fpng");
    expect(template).toContain("TRANSPARENT=TRUE");
    expect(template).toContain("WIDTH=256");
    expect(template).toContain("HEIGHT=256");
    expect(template).toContain("SRS=EPSG:3857");
    expect(template).toContain("CRS=EPSG:3857");
    // The placeholder must survive untouched for MapLibre to substitute it.
    expect(template.endsWith("BBOX={bbox-epsg-3857}")).toBe(true);
  });

  it("keeps the vendor query string of proxied endpoints", () => {
    const template = toRasterSource(cadastreLayer).tiles?.[0] ?? "";
    expect(template.startsWith("https://wms.example.gov.it/inspire/wms/owsproxy.sub?SERVICE=WMS")).toBe(
      true
    );
  });

  it("routes through a CORS proxy when asked", () => {
    const direct = toRasterSource(cadastreLayer).tiles?.[0] ?? "";
    const prefixed = toRasterSource(cadastreLayer, { proxyUrl: "https://cors.test/" }).tiles?.[0] ?? "";
    const encoded = toRasterSource(cadastreLayer, { proxyUrl: "https://cors.test/?url=" }).tiles?.[0] ?? "";
    const templated =
      toRasterSource(cadastreLayer, { proxyUrl: "https://cors.test/?target={url}" }).tiles?.[0] ?? "";

    expect(prefixed).toBe(`https://cors.test/${direct}`);
    expect(encoded).toBe(
      `https://cors.test/?url=${encodeURIComponent(direct).replace("%7Bbbox-epsg-3857%7D", "{bbox-epsg-3857}")}`
    );
    expect(templated).toContain("cors.test/?target=https%3A%2F%2F");
    // The placeholder must stay literal, or MapLibre cannot substitute it.
    for (const template of [prefixed, encoded, templated]) {
      expect(template).toContain("{bbox-epsg-3857}");
      expect(template).not.toContain("%7Bbbox-epsg-3857%7D");
    }
  });

  it("honours version, transparency, format and tile size of the layer", () => {
    const source = toRasterSource(orthophotoLayer);
    const template = source.tiles?.[0] ?? "";
    expect(template).toContain("VERSION=1.1.1");
    expect(template).toContain("FORMAT=image%2Fjpeg");
    expect(template).toContain("TRANSPARENT=FALSE");
    expect(template).toContain("STYLES=default");
    expect(template).toContain("WIDTH=512");
    expect(source.tileSize).toBe(512);
  });

  it("appends extra parameters and a TIME dimension", () => {
    const template =
      toRasterSource(cadastreLayer, {
        extraParams: { map: "catasto", DPI: 180 },
        time: "2024-01-01"
      }).tiles?.[0] ?? "";
    expect(template).toContain("TIME=2024-01-01");
    expect(template).toContain("map=catasto");
    expect(template).toContain("DPI=180");
  });

  it("carries bounds, zoom range and attribution", () => {
    const source = toRasterSource(cadastreLayer);
    expect(source.bounds).toEqual([6.6, 35.4, 18.6, 47.2]);
    expect(source.minzoom).toBe(13);
    expect(source.maxzoom).toBe(22);
    expect(source.attribution).toContain("Agenzia delle Entrate");
    expect(source.attribution).toContain("IODL-2.0");
  });

  it("clamps bounds to the Web Mercator domain", () => {
    expect(toRasterSource(xyzLayer).bounds?.[1]).toBeCloseTo(-85, 5);
    expect(toRasterSource(xyzLayer).bounds?.[3]).toBeCloseTo(85, 5);
  });

  it("can omit the attribution", () => {
    expect(toRasterSource(cadastreLayer, { attribution: false }).attribution).toBeUndefined();
    expect(
      toRasterSource(cadastreLayer, { attribution: { html: false } }).attribution
    ).toBe("Agenzia delle Entrate (IODL-2.0)");
  });
});

describe("toRasterSource - WMTS and XYZ", () => {
  it("builds a KVP GetTile template", () => {
    const template = toRasterSource(wmtsLayer).tiles?.[0] ?? "";
    expect(template).toContain("SERVICE=WMTS");
    expect(template).toContain("REQUEST=GetTile");
    expect(template).toContain("LAYER=TRUE_COLOR");
    expect(template).toContain("TILEMATRIXSET=GoogleMapsCompatible");
    expect(template).toContain("TIME=2024-06-01");
    expect(template).toContain("TILEMATRIX={z}");
    expect(template).toContain("TILEROW={y}");
    expect(template).toContain("TILECOL={x}");
  });

  it("supports GeoServer style matrix identifiers", () => {
    const template =
      toRasterSource(wmtsLayer, { tileMatrixTemplate: "EPSG:3857:{z}" }).tiles?.[0] ?? "";
    expect(template).toContain("TILEMATRIX=EPSG:3857:{z}");
  });

  it("rewrites a RESTful ResourceURL template", () => {
    const template = toRasterSource(wmtsRestLayer).tiles?.[0] ?? "";
    expect(template).toBe(
      "https://tiles.example.eu/wmts/TRUE_COLOR/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg"
    );
  });

  it("expands XYZ subdomains into separate tile URLs", () => {
    const source = toRasterSource(xyzLayer);
    expect(source.tiles).toEqual([
      "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
      "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
      "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png"
    ]);
    expect(source.scheme).toBe("xyz");
  });
});

describe("unsupported services", () => {
  it("refuses WFS layers with an actionable message", () => {
    expect(() => toRasterSource(wfsLayer)).toThrow(UnsupportedServiceError);
    expect(() => toRasterSource(wfsLayer)).toThrow(/toGeoJsonUrl/);
  });
});

describe("style layers", () => {
  it("derives deterministic ids", () => {
    expect(sourceIdFor(cadastreLayer)).toBe("orthogea-it.ade.catasto");
    expect(layerIdFor(cadastreLayer)).toBe("orthogea-it.ade.catasto-raster");
  });

  it("builds a raster style layer with opacity and visibility", () => {
    const layer = toRasterLayer(cadastreLayer, { opacity: 0.6, visible: false });
    expect(layer).toMatchObject({
      id: "orthogea-it.ade.catasto-raster",
      type: "raster",
      source: "orthogea-it.ade.catasto",
      minzoom: 13,
      maxzoom: 22,
      layout: { visibility: "none" }
    });
    expect(layer.paint?.["raster-opacity"]).toBe(0.6);
  });

  it("binds source and layer together", () => {
    const binding = toMapLibreBinding(orthophotoLayer, { opacity: 0.5 });
    expect(binding.sourceId).toBe("orthogea-it.toscana.ortofoto");
    expect(binding.layer.source).toBe(binding.sourceId);
    expect(binding.source.tiles?.[0]).toContain("REQUEST=GetMap");
  });

  it("assembles a full style with only the requested layers visible", () => {
    const style = toStyleSpecification([xyzLayer, orthophotoLayer, cadastreLayer], {
      visibleIds: ["eu.osm.standard", "it.ade.catasto"]
    });
    expect(style.version).toBe(8);
    expect(Object.keys(style.sources)).toHaveLength(3);
    expect(style.layers.map((layer) => layer.layout?.visibility)).toEqual([
      "visible",
      "none",
      "visible"
    ]);
  });
});

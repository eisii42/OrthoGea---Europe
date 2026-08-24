import { describe, expect, it, vi } from "vitest";
import { UnsupportedServiceError, tileToBBox } from "@orthogea/core";
import {
  cadastreLayer,
  cadastreNoMercatorLayer,
  orthophotoLayer
} from "../__fixtures__/layers.js";
import { toRasterSource } from "./adapter.js";
import {
  createOrthoGeaProtocol,
  needsTileReprojection,
  pickReprojectionCrs,
  protocolTileTemplate,
  registerOrthoGeaProtocol,
  supportsWebMercator,
  type ProtocolResponse
} from "./protocol.js";

const pngResponse = (): Response =>
  new Response(new Uint8Array([137, 80, 78, 71]), {
    status: 200,
    headers: { "content-type": "image/png", "cache-control": "max-age=3600" }
  });

describe("detection", () => {
  it("spots services without Web Mercator", () => {
    expect(needsTileReprojection(cadastreNoMercatorLayer)).toBe(true);
    expect(needsTileReprojection(cadastreLayer)).toBe(false);
    expect(needsTileReprojection(orthophotoLayer)).toBe(false);
  });

  it("recognises Web Mercator under any spelling", () => {
    if (cadastreLayer.service.type !== "WMS") throw new Error("expected WMS");
    expect(supportsWebMercator(cadastreLayer.service)).toBe(true);
  });

  it("picks the best geographic CRS the service publishes", () => {
    if (cadastreNoMercatorLayer.service.type !== "WMS") throw new Error("expected WMS");
    expect(pickReprojectionCrs(cadastreNoMercatorLayer.service)).toBe("EPSG:6706");
  });

  it("gives up when no geographic CRS is available", () => {
    if (cadastreNoMercatorLayer.service.type !== "WMS") throw new Error("expected WMS");
    const projectedOnly = {
      ...cadastreNoMercatorLayer.service,
      options: { ...cadastreNoMercatorLayer.service.options, crs: ["EPSG:25832"] }
    };
    expect(() => pickReprojectionCrs(projectedOnly)).toThrow(UnsupportedServiceError);
  });
});

describe("raster source integration", () => {
  it("emits an orthogea:// template for services without EPSG:3857", () => {
    const source = toRasterSource(cadastreNoMercatorLayer);
    expect(source.tiles).toEqual(["orthogea://it.ade.catasto.rdn/{z}/{x}/{y}"]);
    expect(source.bounds).toEqual([6.6, 35.4, 18.6, 47.2]);
  });

  it("refuses instead when reprojection is switched off", () => {
    expect(() => toRasterSource(cadastreNoMercatorLayer, { reprojection: "off" })).toThrow(
      /does not publish EPSG:3857/
    );
  });

  it("leaves Web Mercator services on the standard template", () => {
    expect(toRasterSource(cadastreLayer).tiles?.[0]).toContain("BBOX={bbox-epsg-3857}");
  });
});

describe("protocol handler", () => {
  const tile = { z: 14, x: 8746, y: 6015 };
  const tileUrl = `${protocolTileTemplate("it.ade.catasto.rdn")
    .replace("{z}", String(tile.z))
    .replace("{x}", String(tile.x))
    .replace("{y}", String(tile.y))}`;

  it("requests the tile extent in the geographic CRS of the service", async () => {
    const fetchImpl = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
      async () => pngResponse()
    );
    const handler = createOrthoGeaProtocol({
      layers: [cadastreNoMercatorLayer],
      fetchImpl
    });

    const response = (await handler({ url: tileUrl }, new AbortController())) as ProtocolResponse;
    expect(response.data.byteLength).toBe(4);
    expect(response.cacheControl).toBe("max-age=3600");

    const requested = new URL(fetchImpl.mock.calls[0]![0]);
    expect(requested.searchParams.get("REQUEST")).toBe("GetMap");
    expect(requested.searchParams.get("CRS")).toBe("EPSG:6706");
    expect(requested.searchParams.get("WIDTH")).toBe("256");

    // EPSG:6706 is latitude-first in WMS 1.3.0, so the BBOX must be swapped.
    const bbox = tileToBBox(tile.x, tile.y, tile.z);
    const sent = (requested.searchParams.get("BBOX") ?? "").split(",").map(Number);
    expect(sent[0]).toBeCloseTo(bbox[1], 6);
    expect(sent[1]).toBeCloseTo(bbox[0], 6);
    expect(sent[2]).toBeCloseTo(bbox[3], 6);
    expect(sent[3]).toBeCloseTo(bbox[2], 6);
  });

  it("supports the MapLibre 3 callback signature", async () => {
    const handler = createOrthoGeaProtocol({
      layers: [cadastreNoMercatorLayer],
      fetchImpl: async () => pngResponse()
    });

    const data = await new Promise<ArrayBuffer | null | undefined>((resolve, reject) => {
      const cancellable = handler({ url: tileUrl }, (error, result) =>
        error ? reject(error) : resolve(result)
      );
      expect(cancellable).toHaveProperty("cancel");
    });
    expect(data?.byteLength).toBe(4);
  });

  it("turns a ServiceException answered with HTTP 200 into an error", async () => {
    const handler = createOrthoGeaProtocol({
      layers: [cadastreNoMercatorLayer],
      fetchImpl: async () =>
        new Response(
          '<ServiceExceptionReport><ServiceException code="InvalidCRS">CRS non supportato</ServiceException></ServiceExceptionReport>',
          { status: 200, headers: { "content-type": "text/xml" } }
        )
    });
    await expect(handler({ url: tileUrl }, new AbortController())).rejects.toThrow(
      /CRS non supportato/
    );
  });

  it("rejects unknown layers and malformed URLs", async () => {
    const handler = createOrthoGeaProtocol({ layers: [], fetchImpl: async () => pngResponse() });
    await expect(handler({ url: tileUrl }, new AbortController())).rejects.toThrow(/Unknown layer/);
    await expect(
      handler({ url: "orthogea://broken" }, new AbortController())
    ).rejects.toThrow(/Malformed/);
  });

  it("registers itself on a MapLibre-like object", () => {
    const addProtocol = vi.fn();
    registerOrthoGeaProtocol({ addProtocol }, { layers: [cadastreNoMercatorLayer] });
    expect(addProtocol).toHaveBeenCalledWith("orthogea", expect.any(Function));
  });
});

import { describe, expect, it, vi } from "vitest";
import { lngLatToTile, type OrthoGeaLayer } from "@orthogea/core";
import {
  cadastreLayer,
  cadastreNoMercatorLayer,
  orthophotoLayer,
  wfsLayer,
  wmtsLayer,
  xyzLayer
} from "./__fixtures__/layers.js";
import {
  DEFAULT_ORTHOPHOTO_FROM_ZOOM,
  MOSAIC_PROTOCOL,
  createMosaic,
  createMosaicProtocol,
  mosaicTileTemplate,
  registerMosaicProtocol,
  toMosaicRasterLayer,
  toMosaicRasterSource
} from "./mosaic.js";

/** Pan-European satellite fallback, the role Sentinel-2 plays in the catalogue. */
const satellite: OrthoGeaLayer = {
  ...wmtsLayer,
  id: "eu.satellite.fallback",
  category: "satellite",
  bbox: [-180, -85, 180, 85],
  resolutionMeters: 10,
  maxZoom: 14
};

/** A national orthophoto: coarser and wider than the regional one. */
const national: OrthoGeaLayer = {
  ...orthophotoLayer,
  id: "it.national.ortofoto",
  title: "National orthophoto",
  bbox: [6.6, 35.4, 18.6, 47.2],
  resolutionMeters: 0.5,
  nuts: undefined,
  regionName: undefined,
  service: {
    ...orthophotoLayer.service,
    url: "https://national.example.it/wms",
    options: { ...(orthophotoLayer.service as { options: { layers: string[] } }).options, layers: ["national_ortho"] }
  } as OrthoGeaLayer["service"]
};

/** The regional orthophoto: sharpest, smallest extent. */
const regional: OrthoGeaLayer = { ...orthophotoLayer, resolutionMeters: 0.2 };

const layers = [satellite, national, regional, cadastreLayer, wfsLayer, xyzLayer];
const mosaic = createMosaic({ layers, fallback: satellite.id });

/** Tile covering Firenze at a given pyramid level. */
const tileAt = (z: number): [number, number] => lngLatToTile(11.2558, 43.7696, z);

// Selection tests work at tile zoom 14, which a 512 px mosaic shows at zoom 15,
// just above the detail threshold where orthophotos take over.
const [fx, fy] = tileAt(14);
// Fetching tests use the same level, and neighbours of the same tile block.
const [dx, dy] = [fx, fy];

describe("selection", () => {
  it("uses the European base alone below the detail zoom", () => {
    // 512 px tiles shift the pyramid by one, so this is two levels below.
    const selection = mosaic.select(0, 0, DEFAULT_ORTHOPHOTO_FROM_ZOOM - 2);
    expect(selection.satelliteOnly).toBe(true);
    expect(selection.layers.map((layer) => layer.id)).toEqual(["eu.satellite.fallback"]);
  });

  it("prefers the sharpest, most local imagery and keeps the fallback last", () => {
    const ids = mosaic.select(fx, fy, 14).layers.map((layer) => layer.id);
    expect(ids).toEqual(["it.toscana.ortofoto", "it.national.ortofoto", "eu.satellite.fallback"]);
  });

  it("falls back to the national layer outside the regional extent", () => {
    const [x, y] = lngLatToTile(12.49, 41.9, 14); // Roma, no regional coverage here
    expect(mosaic.select(x, y, 14).layers.map((layer) => layer.id)).toEqual([
      "it.national.ortofoto",
      "eu.satellite.fallback"
    ]);
  });

  it("serves the satellite everywhere else, so no tile is ever empty", () => {
    const [x, y] = lngLatToTile(-45, 12, 14);
    expect(mosaic.select(x, y, 14).layers.map((layer) => layer.id)).toEqual([
      "eu.satellite.fallback"
    ]);
  });

  it("prefers a cached tile service over a WMS covering the same ground", () => {
    // Same region, same imagery: the pre-rendered tiles answer far faster.
    const wms = { ...regional, id: "it.toscana.wms", tags: ["ortofoto"] };
    const tiled = {
      ...regional,
      id: "it.toscana.wmts",
      tags: ["ortofoto"],
      service: wmtsLayer.service,
      resolutionMeters: 0.2
    };
    const both = createMosaic({ layers: [satellite, wms, tiled], fallback: satellite });
    expect(both.bestFor(fx, fy, 14)?.id).toBe("it.toscana.wmts");
  });

  it("ignores cadastre, vector and excluded layers", () => {
    const ids = mosaic.sources.map((layer) => layer.id);
    expect(ids).not.toContain("it.ade.catasto");
    expect(ids).not.toContain("es.catastro.parcels");
    // Background maps are not imagery either.
    expect(ids).not.toContain("eu.osm.standard");

    const filtered = createMosaic({
      layers: [{ ...regional, tags: ["alternative"] }, satellite],
      fallback: satellite
    });
    expect(filtered.sources.map((layer) => layer.id)).not.toContain("it.toscana.ortofoto");
  });

  it("skips layers whose minimum zoom is above the request", () => {
    const zoomed = createMosaic({
      layers: [{ ...regional, minZoom: 16 }, satellite],
      fallback: satellite
    });
    expect(zoomed.bestFor(fx, fy, 14)?.id).toBe("eu.satellite.fallback");
    const [x16, y16] = lngLatToTile(11.2558, 43.7696, 16);
    expect(zoomed.bestFor(x16, y16, 16)?.id).toBe("it.toscana.ortofoto");
  });

  it("asks for 512 px tiles and compensates the pyramid shift", () => {
    // A 512 px source is asked for zoom z-1, so tile zoom 11 is what the user
    // sees as zoom 12 - the threshold must trigger there, not one step later.
    expect(mosaic.tileSize).toBe(512);
    // Tile zoom 14 is displayed at 15, the threshold: orthophotos appear.
    expect(mosaic.select(fx, fy, 14).satelliteOnly).toBe(false);
    // One level below is still the European base only.
    expect(mosaic.select(...tileAt(13), 13).satelliteOnly).toBe(true);

    const url = mosaic.tileUrl(regional, fx, fy, 14);
    expect(url).toContain("WIDTH=512");
    expect(url).toContain("HEIGHT=512");
  });

  it("keeps tile zoom and map zoom aligned with 256 px tiles", () => {
    const small = createMosaic({ layers, fallback: satellite, tileSize: 256 });
    expect(small.select(...tileAt(15), 15).satelliteOnly).toBe(false);
    expect(small.select(...tileAt(14), 14).satelliteOnly).toBe(true);
    expect(small.tileUrl(regional, fx, fy, 14)).toContain("WIDTH=256");
  });

  it("honours a custom orthophoto zoom threshold", () => {
    const eager = createMosaic({ layers, fallback: satellite, orthophotoFromZoom: 9 });
    const [x, y] = lngLatToTile(11.2558, 43.7696, 10);
    expect(eager.bestFor(x, y, 10)?.id).toBe("it.toscana.ortofoto");
  });
});

describe("tile fetching", () => {
  const png = (): Response =>
    new Response(new Uint8Array([137, 80, 78, 71]), {
      status: 200,
      headers: { "content-type": "image/png" }
    });

  it("serves the best source and reports it", async () => {
    const onTile = vi.fn();
    const fetchImpl = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(async () =>
      png()
    );
    const tiled = createMosaic({ layers, fallback: satellite, fetchImpl, onTile, minTileBytes: 0 });

    const tile = await tiled.fetchTile(dx, dy, 14);
    expect(tile.layer.id).toBe("it.toscana.ortofoto");
    expect(tile.data.byteLength).toBe(4);
    expect(onTile).toHaveBeenCalledWith(expect.objectContaining({ z: 14 }));
    expect(fetchImpl.mock.calls[0]?.[0]).toContain("REQUEST=GetMap");
  });

  it("walks down to the next source when one fails, and remembers the failure", async () => {
    const seen: string[] = [];
    const fetchImpl = async (url: string) => {
      seen.push(url);
      if (url.includes("rt_ofc")) return new Response("boom", { status: 500 });
      return png();
    };
    const tiled = createMosaic({ layers, fallback: satellite, fetchImpl, minTileBytes: 0 });

    const first = await tiled.fetchTile(dx, dy, 14);
    expect(first.layer.id).toBe("it.national.ortofoto");

    // The broken regional layer is skipped straight away on the next tile.
    seen.length = 0;
    const second = await tiled.fetchTile(dx + 1, dy, 14);
    expect(second.layer.id).toBe("it.national.ortofoto");
    expect(seen.some((url) => url.includes("rt_ofc"))).toBe(false);
  });

  it("treats a ServiceException answered with HTTP 200 as a failure", async () => {
    const fetchImpl = async (url: string) =>
      url.includes("rt_ofc")
        ? new Response("<ServiceExceptionReport/>", {
            status: 200,
            headers: { "content-type": "text/xml" }
          })
        : png();
    const tiled = createMosaic({ layers, fallback: satellite, fetchImpl, minTileBytes: 0 });
    expect((await tiled.fetchTile(dx, dy, 14)).layer.id).toBe("it.national.ortofoto");
  });

  it("draws a hole as transparent when there is no fallback", async () => {
    // A mosaic meant to sit over a base layer reports holes as empty tiles, so
    // the layer underneath shows through and the console stays quiet.
    const tiled = createMosaic({
      layers: [regional],
      minTileBytes: 0,
      cacheName: false,
      fetchImpl: async () => new Response("nope", { status: 503 })
    });
    const tile = await tiled.fetchTile(dx, dy, 14);
    expect(tile.contentType).toBe("image/png");
    expect(tile.layer.id).toBe("orthogea:empty");
    expect(tile.data.byteLength).toBeLessThan(200);
  });

  it("reports a clear error when asked to", async () => {
    const tiled = createMosaic({
      layers: [regional],
      minTileBytes: 0,
      cacheName: false,
      transparentWhenUncovered: false,
      fetchImpl: async () => new Response("nope", { status: 503 })
    });
    await expect(tiled.fetchTile(dx, dy, 14)).rejects.toThrow(/No source could serve tile/);
  });

  it("keeps a confirmed source at deep zoom, even when its tiles get small", async () => {
    // A uniform roof at zoom 19 compresses to almost nothing; once the service
    // is known to cover the area, that must not send the map back to the base.
    let big = true;
    const fetchImpl = async (url: string) =>
      url.includes("rt_ofc")
        ? new Response(big ? new Uint8Array(32768) : new Uint8Array(900), {
            status: 200,
            headers: { "content-type": "image/jpeg" }
          })
        : new Response(new Uint8Array(32768), {
            status: 200,
            headers: { "content-type": "image/jpeg" }
          });

    const tiled = createMosaic({ layers, fallback: satellite, fetchImpl, cacheName: false });

    // First tile confirms the regional layer covers this area.
    expect((await tiled.fetchTile(dx, dy, 14)).layer.id).toBe("it.toscana.ortofoto");

    // Zoom in: the same area, now answering with a tiny uniform tile.
    big = false;
    const deep = await tiled.fetchTile(dx * 32, dy * 32, 19);
    expect(deep.layer.id).toBe("it.toscana.ortofoto");
    expect(deep.data.byteLength).toBe(900);
  });

  it("skips a blank tile, which is how a WMS answers outside its real footprint", async () => {
    const big = new Uint8Array(32768);
    const fetchImpl = async (url: string) =>
      new Response(url.includes("rt_ofc") ? new Uint8Array(300) : big, {
        status: 200,
        headers: { "content-type": "image/jpeg" }
      });
    const tiled = createMosaic({ layers, fallback: satellite, fetchImpl });

    // The regional layer answers, but with an empty image: the next source wins.
    expect((await tiled.fetchTile(dx, dy, 14)).layer.id).toBe("it.national.ortofoto");

    // A blank answer is not a failure, so the layer is still tried elsewhere.
    const elsewhere = await tiled.fetchTile(dx + 3, dy + 3, 14);
    expect(elsewhere.layer.id).toBe("it.national.ortofoto");
  });

  it("remembers an empty area and stops asking that service for the neighbourhood", async () => {
    const asked: string[] = [];
    const big = new Uint8Array(32768);
    const fetchImpl = async (url: string) => {
      asked.push(url.includes("rt_ofc") ? "regional" : "national");
      return new Response(url.includes("rt_ofc") ? new Uint8Array(300) : big, {
        status: 200,
        headers: { "content-type": "image/jpeg" }
      });
    };
    const tiled = createMosaic({ layers, fallback: satellite, fetchImpl, cacheName: false });

    await tiled.fetchTile(dx, dy, 14);
    expect(asked).toEqual(["regional", "national"]);

    // A neighbouring tile of the same block: the empty service is not asked again.
    asked.length = 0;
    await tiled.fetchTile(dx + 1, dy + 1, 14);
    expect(asked).toEqual(["national"]);

    // Far enough away it is given another chance.
    asked.length = 0;
    await tiled.fetchTile(dx + 40, dy + 40, 14);
    expect(asked).toEqual(["regional", "national"]);
  });

  it("accepts a small tile from the last source, so open sea still renders", async () => {
    const tiled = createMosaic({
      layers: [satellite],
      fallback: satellite,
      fetchImpl: async () =>
        new Response(new Uint8Array(200), { status: 200, headers: { "content-type": "image/jpeg" } })
    });
    expect((await tiled.fetchTile(dx, dy, 14)).data.byteLength).toBe(200);
  });

  it("reprojects for services without EPSG:3857", async () => {
    const fetchImpl = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(async () =>
      png()
    );
    const tiled = createMosaic({
      layers: [{ ...cadastreNoMercatorLayer, category: "orthophoto" }, satellite],
      fallback: satellite,
      minTileBytes: 0, cacheName: false,
      fetchImpl
    });
    await tiled.fetchTile(dx, dy, 14);
    expect(fetchImpl.mock.calls[0]?.[0]).toContain("CRS=EPSG:6706");
  });
});

describe("MapLibre integration", () => {
  it("builds a single worldwide raster source", () => {
    const source = toMosaicRasterSource(mosaic);
    expect(source.tiles).toEqual([`${MOSAIC_PROTOCOL}://default/{z}/{x}/{y}`]);
    expect(source.minzoom).toBe(0);
    expect(source.maxzoom).toBeGreaterThanOrEqual(19);
    // Nothing has been drawn yet, so only the fallback is credited: the line
    // stays short instead of listing every provider of the catalogue.
    expect(source.attribution).toContain("Copernicus");
    expect(source.attribution).not.toContain("Regione Toscana");
    expect(toMosaicRasterSource(mosaic, { attributionMode: "all" }).attribution).toContain(
      "Regione Toscana"
    );
  });

  it("credits the sources it has actually drawn", async () => {
    const tiled = createMosaic({
      layers,
      fallback: satellite,
      minTileBytes: 0, cacheName: false,
      fetchImpl: async () =>
        new Response(new Uint8Array(8), { status: 200, headers: { "content-type": "image/jpeg" } })
    });
    expect(tiled.activeSources()).toEqual([]);

    await tiled.fetchTile(dx, dy, 14);
    expect(tiled.activeSources().map((layer) => layer.id)).toEqual(["it.toscana.ortofoto"]);
    expect(tiled.activeAttribution()).toContain("Regione Toscana");
    expect(toMosaicRasterSource(tiled).attribution).toContain("Regione Toscana");
  });

  it("serves tiles through the protocol handler", async () => {
    const tiled = createMosaic({
      id: "it",
      layers,
      fallback: satellite,
      fetchImpl: async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "image/jpeg" }
        })
    });
    const handler = createMosaicProtocol(tiled);
    const url = mosaicTileTemplate("it")
      .replace("{z}", "14")
      .replace("{x}", String(dx))
      .replace("{y}", String(dy));

    const response = await (handler({ url }, new AbortController()) as Promise<{ data: ArrayBuffer }>);
    expect(response.data.byteLength).toBe(3);
  });

  it("rejects unknown mosaics and malformed URLs", async () => {
    const handler = createMosaicProtocol(mosaic);
    await expect(
      handler({ url: `${MOSAIC_PROTOCOL}://nope/1/1/1` }, new AbortController())
    ).rejects.toThrow(/Unknown mosaic/);
    await expect(
      handler({ url: `${MOSAIC_PROTOCOL}://default/oops` }, new AbortController())
    ).rejects.toThrow(/Malformed/);
  });

  it("registers itself on a MapLibre-like object", () => {
    const addProtocol = vi.fn();
    registerMosaicProtocol({ addProtocol }, mosaic);
    expect(addProtocol).toHaveBeenCalledWith(MOSAIC_PROTOCOL, expect.any(Function));
  });
});

describe("fading over a base layer", () => {
  it("interpolates the opacity across the hand-over zooms", () => {
    const layer = toMosaicRasterLayer(mosaic, { fadeFromZoom: 13.5, fadeToZoom: 15.5 });
    expect(layer.type).toBe("raster");
    expect(layer.source).toBe("orthogea-mosaic-default");
    expect(layer.minzoom).toBe(13);
    expect(layer.paint?.["raster-opacity"]).toEqual([
      "interpolate",
      ["linear"],
      ["zoom"],
      13.5,
      0,
      15.5,
      1
    ]);
  });

  it("falls back to a plain opacity without a fade range", () => {
    expect(toMosaicRasterLayer(mosaic, { opacity: 0.8 }).paint?.["raster-opacity"]).toBe(0.8);
  });
});

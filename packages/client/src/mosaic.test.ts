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
import { bindDetailZoomLimit } from "./maplibre/zoom.js";

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

describe("borders", () => {
  /** A layer whose rectangle spills over the border, as every real one does. */
  const neighbour: OrthoGeaLayer = {
    ...regional,
    id: "at.basemap.orthofoto",
    country: "AT",
    bbox: [8.8, 46.4, 17.5, 49.0]
  };

  /** Munich: inside the Austrian rectangle, outside Austria. */
  const [mx, my] = lngLatToTile(11.575, 48.137, 14);

  const blankTile = () =>
    new Response(new Uint8Array(2400), {
      status: 200,
      headers: { "content-type": "image/jpeg" }
    });

  it("draws a hole rather than a neighbour's no-data fill", async () => {
    // basemap.at answers over Munich, and IGN over Frankfurt, with a uniform
    // grey or white image. Painting it - the only candidate, so once accepted
    // unconditionally - washed out every German city at detail zoom.
    const tiled = createMosaic({
      layers: [neighbour],
      orthophotoFromZoom: 0,
      cacheName: false,
      fetchImpl: async () => blankTile()
    });

    const tile = await tiled.fetchTile(mx, my, 14);
    expect(tile.layer.id).toBe("orthogea:empty");
  });

  it("still accepts a uniform tile from the guaranteed fallback", async () => {
    // Open sea and snowfields are genuinely uniform: the layer that guarantees
    // coverage is the one place where a small tile must not become a hole.
    const tiled = createMosaic({
      layers: [neighbour, satellite],
      fallback: satellite,
      orthophotoFromZoom: 0,
      cacheName: false,
      fetchImpl: async () => blankTile()
    });

    expect((await tiled.fetchTile(mx, my, 14)).layer.id).toBe("eu.satellite.fallback");
  });
});

describe("network efficiency", () => {
  const image = () =>
    new Response(new Uint8Array(32768), {
      status: 200,
      headers: { "content-type": "image/jpeg" }
    });

  it("shares one download between concurrent requests for the same tile", async () => {
    const fetchImpl = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
      async () => image()
    );
    const tiled = createMosaic({ layers, fallback: satellite, fetchImpl, cacheName: false });

    const [a, b] = await Promise.all([tiled.fetchTile(dx, dy, 14), tiled.fetchTile(dx, dy, 14)]);
    expect(a.layer.id).toBe("it.toscana.ortofoto");
    expect(b.data).toBe(a.data);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("keeps the download alive while another caller still wants the tile", async () => {
    const fetchImpl = async () => image();
    const tiled = createMosaic({ layers, fallback: satellite, fetchImpl, cacheName: false });

    const abandoned = new AbortController();
    const dropped = tiled.fetchTile(dx, dy, 14, abandoned.signal);
    const kept = tiled.fetchTile(dx, dy, 14);
    abandoned.abort();

    await expect(dropped).rejects.toThrow(/aborted/i);
    expect((await kept).layer.id).toBe("it.toscana.ortofoto");
  });

  it("warms neighbouring tiles without crediting their providers", async () => {
    const onTile = vi.fn();
    const fetchImpl = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
      async () => image()
    );
    const tiled = createMosaic({ layers, fallback: satellite, fetchImpl, onTile, cacheName: false });

    tiled.prefetchAround(dx, dy, 14);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(8));
    expect(onTile).not.toHaveBeenCalled();
    expect(tiled.activeSources()).toEqual([]);
  });
});

describe("tile caches", () => {
  /** A regional orthophoto served from a 256 px tile cache, as basemap.at is. */
  const cached: OrthoGeaLayer = {
    ...wmtsLayer,
    id: "at.basemap.orthofoto",
    category: "orthophoto",
    country: "AT",
    bbox: regional.bbox,
    resolutionMeters: 0.3
  };

  /** Minimal OffscreenCanvas, enough to record what would be drawn where. */
  const stubCanvas = (drawn: string[]) =>
    class {
      constructor(
        readonly width: number,
        readonly height: number
      ) {}
      getContext(): unknown {
        return {
          drawImage: (_image: unknown, dx: number, dy: number, w: number, h: number) =>
            drawn.push(`${dx},${dy} ${w}x${h}`)
        };
      }
      async convertToBlob(): Promise<Blob> {
        return new Blob([new Uint8Array(40_000)], { type: "image/jpeg" });
      }
    };

  it("stitches the four native tiles instead of stretching one", async () => {
    const drawn: string[] = [];
    const asked: string[] = [];
    vi.stubGlobal("OffscreenCanvas", stubCanvas(drawn));
    vi.stubGlobal("createImageBitmap", async () => ({ close: () => undefined }));

    const fetchImpl = async (url: string) => {
      asked.push(url);
      return new Response(new Uint8Array(24_000), {
        status: 200,
        headers: { "content-type": "image/jpeg" }
      });
    };
    const tiled = createMosaic({
      layers: [cached],
      orthophotoFromZoom: 0,
      cacheName: false,
      fetchImpl
    });

    const tile = await tiled.fetchTile(dx, dy, 14);
    expect(tile.layer.id).toBe("at.basemap.orthofoto");
    // Four children of the tile, one level down, and nothing at its own level.
    expect(asked).toHaveLength(4);
    expect(asked.every((url) => url.includes("TILEMATRIX=15"))).toBe(true);
    expect(drawn).toEqual([
      "0,0 256x256",
      "256,0 256x256",
      "0,256 256x256",
      "256,256 256x256"
    ]);

    vi.unstubAllGlobals();
  });

  it("falls back to the single tile when a child is missing", async () => {
    vi.stubGlobal("OffscreenCanvas", stubCanvas([]));
    vi.stubGlobal("createImageBitmap", async () => ({ close: () => undefined }));

    const asked: string[] = [];
    const fetchImpl = async (url: string) => {
      asked.push(url);
      return url.includes("TILEMATRIX=15")
        ? new Response("gone", { status: 404 })
        : new Response(new Uint8Array(24_000), {
            status: 200,
            headers: { "content-type": "image/jpeg" }
          });
    };
    const tiled = createMosaic({
      layers: [cached],
      orthophotoFromZoom: 0,
      cacheName: false,
      fetchImpl
    });

    expect((await tiled.fetchTile(dx, dy, 14)).layer.id).toBe("at.basemap.orthofoto");
    expect(asked.some((url) => url.includes("TILEMATRIX=14"))).toBe(true);

    vi.unstubAllGlobals();
  });
});

describe("coverage gaps", () => {
  it("treats a 404 as a gap in coverage, not as a broken service", async () => {
    // basemap.at answers 404 over Munich, which is inside its bounding
    // rectangle but outside Austria. Blacklisting it there used to blank
    // Vienna as well for the next minute.
    const asked: string[] = [];
    const fetchImpl = async (url: string) => {
      asked.push(url);
      return url.includes("rt_ofc")
        ? new Response("not found", { status: 404 })
        : new Response(new Uint8Array(32_768), {
            status: 200,
            headers: { "content-type": "image/jpeg" }
          });
    };
    const tiled = createMosaic({ layers, fallback: satellite, fetchImpl, cacheName: false });

    // The regional layer has nothing here, so the national one draws.
    expect((await tiled.fetchTile(dx, dy, 14)).layer.id).toBe("it.national.ortofoto");

    // Far away it is still tried: a gap is remembered by place, not globally.
    asked.length = 0;
    const [ex, ey] = lngLatToTile(10.9, 43.2, 14);
    await tiled.fetchTile(ex, ey, 14);
    expect(asked.some((url) => url.includes("rt_ofc"))).toBe(true);
  });
});

describe("across a border", () => {
  /** A neighbour whose rectangle is smaller, so it ranks ahead on extent. */
  const neighbour: OrthoGeaLayer = {
    ...regional,
    id: "de.nw.dop",
    country: "DE",
    bbox: [10.0, 43.0, 12.0, 44.5],
    resolutionMeters: 0.1
  };

  it("keeps the foreign source last instead of dropping it", async () => {
    // The German rectangle covers Florence and is the tighter one, so it leads.
    // Dropping the Tuscan layer behind it would leave a hole wherever the
    // German service answers blank - which, over Italy, is everywhere.
    const bordering = createMosaic({
      layers: [neighbour, regional, national, satellite],
      fallback: satellite,
      orthophotoFromZoom: 0,
      cacheName: false,
      fetchImpl: async (url: string) =>
        new Response(url.includes("de.nw") || url.includes("rt_ofc") ? new Uint8Array(300) : new Uint8Array(32_768), {
          status: 200,
          headers: { "content-type": "image/jpeg" }
        })
    });

    const ids = bordering.select(fx, fy, 14).layers.map((layer) => layer.id);
    expect(ids[0]).toBe("de.nw.dop");
    expect(ids).toContain("it.toscana.ortofoto");
    expect(ids[ids.length - 1]).toBe("eu.satellite.fallback");

    // Blank from both orthophotos, so the chain runs all the way through.
    expect((await bordering.fetchTile(fx, fy, 14)).layer.id).toBe("it.national.ortofoto");
  });
});

describe("detail zoom", () => {
  /** The 2 m European base, as the catalogue publishes it. */
  const base: OrthoGeaLayer = { ...satellite, resolutionMeters: 2, maxZoom: 19 };

  it("stops where the data stops", () => {
    // A 2 m satellite base is readable to about zoom 16.5 over Europe; past
    // that a reader is only looking at bigger pixels.
    const baseOnly = createMosaic({ layers: [base], fallback: base, orthophotoFromZoom: 0 });
    expect(baseOnly.detailZoomAt(9.99, 53.55)).toBeCloseTo(16.5, 1); // Hamburg
    expect(baseOnly.detailZoomAt(23.32, 42.7)).toBeCloseTo(16.8, 1); // Sofia
  });

  it("lifts the ceiling where an orthophoto covers the ground", () => {
    const full = createMosaic({
      layers: [regional, base],
      fallback: base,
      orthophotoFromZoom: 0
    });
    // 20 cm over Florence: a full three levels deeper than the base allows.
    expect(full.detailZoomAt(11.2558, 43.7696)).toBeGreaterThan(19.5);
    // Just outside the Tuscan rectangle, the base decides again.
    expect(full.detailZoomAt(23.32, 42.7)).toBeCloseTo(16.8, 1);
  });

  it("follows the latitude, because Mercator does", () => {
    const baseOnly = createMosaic({ layers: [base], fallback: base, orthophotoFromZoom: 0 });
    // A Mercator pixel covers less ground the further north it is, so the same
    // imagery runs out of detail sooner: Reykjavik caps lower than Athens.
    expect(baseOnly.detailZoomAt(0, 65)).toBeLessThan(baseOnly.detailZoomAt(0, 40));
  });

  it("stops trusting a rectangle a service has answered blank in", async () => {
    // Schleswig-Holstein's rectangle covers Hamburg and holds nothing there.
    // Until the first tile comes back, the cap has only the record to go on.
    const lying: OrthoGeaLayer = { ...regional, id: "de.sh.dop", resolutionMeters: 0.2 };
    const tiled = createMosaic({
      layers: [lying, base],
      fallback: base,
      orthophotoFromZoom: 0,
      cacheName: false,
      fetchImpl: async (url: string) =>
        new Response(url.includes("rt_ofc") ? new Uint8Array(300) : new Uint8Array(32_768), {
          status: 200,
          headers: { "content-type": "image/jpeg" }
        })
    });

    expect(tiled.detailZoomAt(11.2558, 43.7696)).toBeGreaterThan(19.5);
    await tiled.fetchTile(fx, fy, 14);
    expect(tiled.detailZoomAt(11.2558, 43.7696)).toBeCloseTo(16.8, 1);
  });
});

describe("bindDetailZoomLimit", () => {
  const base: OrthoGeaLayer = { ...satellite, resolutionMeters: 2, maxZoom: 19 };

  /** The slice of a MapLibre map the helper touches. */
  const fakeMap = (lng: number, lat: number) => {
    const listeners = new Map<string, () => void>();
    return {
      maxZoom: undefined as number | null | undefined,
      center: { lng, lat },
      getCenter() {
        return this.center;
      },
      getZoom: () => 18,
      setMaxZoom(zoom?: number | null) {
        this.maxZoom = zoom;
      },
      on: (type: string, listener: () => void) => listeners.set(type, listener),
      off: (type: string) => listeners.delete(type),
      fire: (type: string) => listeners.get(type)?.(),
      listeners
    };
  };

  it("caps the map on the coarsest thing under it and follows the reader", () => {
    const orthophotos = createMosaic({ layers: [regional], orthophotoFromZoom: 0 });
    const european = createMosaic({ layers: [base], fallback: base, orthophotoFromZoom: 0 });

    const map = fakeMap(23.32, 42.7); // Sofia: base only
    const changes: number[] = [];
    const release = bindDetailZoomLimit(map, [orthophotos, european], {
      onChange: (limit) => changes.push(limit)
    });

    expect(map.maxZoom).toBeCloseTo(16.8, 1);

    // Move to Florence, where an orthophoto covers the ground.
    map.center = { lng: 11.2558, lat: 43.7696 };
    map.fire("moveend");
    expect(map.maxZoom as number).toBeGreaterThan(19.5);
    expect(changes).toHaveLength(2);

    release();
    expect(map.maxZoom).toBeNull();
    expect(map.listeners.size).toBe(0);
  });

  it("does not re-apply an unchanged limit", () => {
    const european = createMosaic({ layers: [base], fallback: base, orthophotoFromZoom: 0 });
    const map = fakeMap(23.32, 42.7);
    const changes: number[] = [];
    bindDetailZoomLimit(map, european, { onChange: (limit) => changes.push(limit) });

    map.fire("moveend");
    map.fire("moveend");
    expect(changes).toHaveLength(1);
  });
});

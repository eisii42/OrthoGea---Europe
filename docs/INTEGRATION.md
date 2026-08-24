# Integration recipes

OrthoGea produces **plain descriptions of map sources**. It never imports a map library, so it
drops into an existing project without touching your rendering stack.

- [Install](#install)
- [The seamless mosaic](#the-seamless-mosaic)
- [MapLibre GL](#maplibre-gl)
- [Leaflet](#leaflet)
- [OpenLayers](#openlayers)
- [Any other renderer](#any-other-renderer)
- [Picking a layer](#picking-a-layer)
- [Clicking a layer](#clicking-a-layer-getfeatureinfo)
- [Vector data (WFS)](#vector-data-wfs)
- [React](#react)
- [Node and server side](#node-and-server-side)
- [QGIS and desktop GIS](#qgis-and-desktop-gis)
- [Your own catalogue](#your-own-catalogue)

## Install

```bash
pnpm add @orthogea/catalog @orthogea/client      # rendering an existing catalogue
pnpm add @orthogea/harvester                     # plus reading GetCapabilities yourself
```

`@orthogea/core` comes along as a dependency; install it directly if you only want the schemas
and the spatial helpers.

## The seamless mosaic

One virtual layer, worldwide, that picks the best official imagery for every tile - the
replacement for Google Satellite or ESRI World Imagery.

```ts
import maplibregl from "maplibre-gl";
import { catalog, DEFAULT_SATELLITE_FALLBACK_ID } from "@orthogea/catalog";
import { createMosaic, registerMosaicProtocol, toMosaicRasterSource } from "@orthogea/client";

const mosaic = createMosaic({
  layers: [...catalog],
  fallback: DEFAULT_SATELLITE_FALLBACK_ID,  // Copernicus VHR 2021, no API key
  orthophotoFromZoom: 15,                   // below this, the European base only
  proxyUrl: "/cors-proxy?url=",             // if your providers need one
  onTile: ({ layer }) => console.log("drawing", layer.title)
});

registerMosaicProtocol(maplibregl, mosaic);

map.on("load", () => {
  map.addSource("imagery", toMosaicRasterSource(mosaic));
  map.addLayer({ id: "imagery", type: "raster", source: "imagery" });
});
```

How it behaves:

| Situation | What the mosaic draws |
| --- | --- |
| zoom below `orthophotoFromZoom` | the European base only - one consistent, fast, never pixelated image |
| zoom above, orthophoto available | the most local official orthophoto covering the tile |
| several candidates | smallest extent, then cached tile services, then finest resolution, then most recent |
| across a border | the source of the country the tile is in; foreign rectangles are dropped |
| a source fails | the next candidate, and the failing one is skipped for a minute |
| a source answers blank, or 404 | the next candidate; the gap is remembered for that block only |
| nothing else covers the tile | the fallback, or a transparent tile when the mosaic has none |

Options worth knowing:

| Option | Default | Effect |
| --- | --- | --- |
| `orthophotoFromZoom` | 15 | below it, only the European base is drawn |
| `fallback` | - | the layer that closes every chain; pass `DEFAULT_SATELLITE_FALLBACK_ID` |
| `cacheName` | `"orthogea-tiles"` | Cache Storage bucket; `false` disables caching |
| `minTileBytes` | 9000 / 2500 | tiles smaller than this count as empty and the next source is tried (512 / 256 px) |
| `cacheLimit` | 1500 | tiles kept in Cache Storage; the oldest are trimmed past it |
| `failureTtlMs` | 60000 | how long a failing service is skipped |
| `timeoutMs` | 12000 | per-tile timeout |
| `excludeTags` | `["alternative"]` | catalogue tags to skip |
| `proxyUrl` | - | CORS proxy for every request |

And on the source:

| Option | Default | Effect |
| --- | --- | --- |
| `tileSize` | 512 | fewer requests and fewer watermarks than 256 |
| `maxzoom` | 19 | deepest zoom requested; MapLibre upscales beyond it |
| `attributionMode` | `"active"` | credit only what has been drawn, or `"all"` |

Useful members:

```ts
mosaic.bestFor(x, y, z);        // which layer would be drawn for a tile
mosaic.select(x, y, z).layers;  // the whole candidate chain
mosaic.activeSources();         // what has actually been drawn recently
mosaic.activeAttribution();     // credit for exactly those sources
mosaic.tileUrl(layer, x, y, z); // the request behind a tile, for debugging
await mosaic.fetchTile(x, y, z);// server side or for tests

mosaic.prefetch(x, y, z);       // warm one tile, silently
mosaic.prefetchAround(x, y, z); // warm the ring around it
mosaic.detailZoomAt(lng, lat);  // deepest zoom the imagery here supports
```

**Stop the zoom before the imagery blurs.** Where no orthophoto is published the map sits on the
2 m European base, and zooming past about 16.5 only enlarges pixels. One call holds the map at
the resolution of whatever is beneath it, and lifts the ceiling again over better-surveyed
ground:

```ts
import { bindDetailZoomLimit } from "@orthogea/client";

const release = bindDetailZoomLimit(map, [orthophotos, base], {
  upscale: 1,                       // levels of magnification tolerated; 0 is strict
  onChange: (max) => console.log(`sharp to z${max}`)
});
```

Pass every mosaic the map draws from: the deepest of them wins, which is what a reader sees. The
limit is applied on `moveend`, so it never snaps the view mid-gesture, and it learns from the
tiles that come back - a service whose rectangle covers ground it has no imagery for stops
raising the ceiling once it has answered blank there.

**Prefetching.** Warming the tiles just outside the viewport is the cheapest way to make panning
feel instant: the next tiles come from Cache Storage instead of a national WMS. Do it when the
map has settled, never while it is moving, and leave it alone on a metered connection:

```ts
map.on("idle", () => {
  const z = Math.round(map.getZoom()) - 1;        // 512 px sources sit one level down
  const [x, y] = lngLatToTile(map.getCenter().lng, map.getCenter().lat, z);
  if (!navigator.connection?.saveData) mosaic.prefetchAround(x, y, z);
});
```

Prefetched tiles are not credited: they fill the cache without touching `activeSources()`, so the
attribution line keeps describing what is actually on screen.

For a gradual hand-over, draw the base as its own layer and put an orthophoto-only mosaic on
top with `toMosaicRasterLayer(mosaic, { fadeFromZoom: 13.5, fadeToZoom: 15.5 })`: the imagery
fades in over a couple of zoom levels, and holes stay transparent so the base shows through.

Attribution: `toMosaicRasterSource()` credits the sources drawn so far, which keeps the line
short. Refresh MapLibre's control when `onTile` reports a new provider (see `apps/demo`), or
pass `attributionMode: "all"` to list every possible provider once.

Leaflet and OpenLayers use the same object through `mosaic.fetchTile` or a custom
`getTileUrl`; only MapLibre has a protocol hook for it out of the box.

## MapLibre GL

```ts
import maplibregl from "maplibre-gl";
import { catalog, getLayer } from "@orthogea/catalog";
import { registerOrthoGeaProtocol, toMapLibreBinding } from "@orthogea/client";

// Once, before creating the map: enables the services without EPSG:3857.
registerOrthoGeaProtocol(maplibregl, { layers: [...catalog] });

const map = new maplibregl.Map({
  container: "map",
  style: { version: 8, sources: {}, layers: [] },
  center: [11.2558, 43.7696],
  zoom: 15
});

map.on("load", () => {
  for (const id of ["it.toscana.ortofoto-2024", "eu.eea.corine-land-cover-2018"]) {
    const { sourceId, source, layer } = toMapLibreBinding(getLayer(id)!);
    map.addSource(sourceId, source);
    map.addLayer(layer);
  }
});
```

`toMapLibreBinding()` returns `{ sourceId, layerId, source, layer }`. The source carries
`bounds`, `minzoom`, `maxzoom`, `tileSize` and the `attribution` string built from the licence,
so MapLibre's `AttributionControl` shows the credit the publisher requires.

A whole style in one call:

```ts
import { toStyleSpecification } from "@orthogea/client";

const style = toStyleSpecification([base, overlay], { visibleIds: [base.id] });
new maplibregl.Map({ container: "map", style });
```

Useful options, accepted by `toRasterSource`, `toMapLibreBinding` and `toStyleSpecification`:

| Option | Effect |
| --- | --- |
| `proxyUrl` | route every request through a CORS proxy |
| `tileSize` | override the tile size (256 or 512) |
| `format`, `transparent`, `styles`, `time` | override the WMS request |
| `extraParams` | vendor parameters appended to every request |
| `attribution: false` | do not build an attribution string |
| `reprojection: "off"` | throw instead of using the `orthogea://` protocol |
| `tileMatrixTemplate` | WMTS matrix naming, e.g. `EPSG:3857:{z}` |

## Leaflet

```js
import L from "leaflet";
import { getLayer } from "@orthogea/catalog";
import { toLeafletSource } from "@orthogea/client";

function addOrthoGeaLayer(map, layer, options = {}) {
  const source = toLeafletSource(layer, options);

  if (source.kind === "tileLayer.wms") {
    return L.tileLayer.wms(source.url, source.options).addTo(map);
  }
  if (source.kind === "tileLayer") {
    return L.tileLayer(source.url, source.options).addTo(map);
  }

  // Services without EPSG:3857: Leaflet asks us for each tile URL.
  const OrthoGeaTileLayer = L.TileLayer.extend({
    getTileUrl: (coords) => source.getTileUrl(coords.x, coords.y, coords.z)
  });
  return new OrthoGeaTileLayer("", source.options).addTo(map);
}

const map = L.map("map").setView([43.7696, 11.2558], 15);
addOrthoGeaLayer(map, getLayer("it.toscana.ortofoto-2024"));
```

The descriptor already contains `attribution`, `minZoom`, `maxZoom`, `bounds`
(`[[south, west], [north, east]]`), `tms` and `subdomains`.

## OpenLayers

```js
import Map from "ol/Map.js";
import TileLayer from "ol/layer/Tile.js";
import TileWMS from "ol/source/TileWMS.js";
import XYZ from "ol/source/XYZ.js";
import { getLayer } from "@orthogea/catalog";
import { toOpenLayersSource } from "@orthogea/client";

const description = toOpenLayersSource(getLayer("es.ign.pnoa-ma"));

const source =
  description.kind === "TileWMS"
    ? new TileWMS({
        url: description.url,
        params: description.params,
        serverType: description.serverType,
        attributions: description.attributions,
        crossOrigin: description.crossOrigin
      })
    : new XYZ({
        urls: description.urls,
        attributions: description.attributions,
        maxZoom: description.maxZoom
      });

map.addLayer(new TileLayer({ source }));
```

OpenLayers computes `BBOX`, `WIDTH`, `HEIGHT` and the axis order itself from the view
projection, which is why the WMS descriptor only carries the identifying parameters. For a WMTS
layer the descriptor gives `layer`, `matrixSet`, `format`, `style`, `requestEncoding`,
`projection` and `dimensions`; build the `WMTSTileGrid` from your projection and pass them to
`new WMTS({...})`.

## Any other renderer

Every raster layer can be reduced to a tile function:

```ts
import { createTileUrlBuilder } from "@orthogea/client";

const tileUrl = createTileUrlBuilder(layer, { proxyUrl });
tileUrl(8746, 6015, 14);
// https://.../wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&...&BBOX=43.77,11.25,43.78,11.26
```

The builder asks WMS services for the exact extent of the `{x, y, z}` tile - in EPSG:3857 when
the service publishes it, in the geographic CRS it does publish otherwise - and fills WMTS and
XYZ templates (TMS row flipping included). That is enough for Cesium's
`UrlTemplateImageryProvider`, deck.gl's `TileLayer`, a `<canvas>` renderer or a plain `<img>`.

Single images instead of tiles:

```ts
import { buildWmsGetMapUrl } from "@orthogea/client";

const png = buildWmsGetMapUrl(layer.service, {
  bbox: [11.24, 43.76, 11.27, 43.78],   // in the units of `crs`
  crs: "CRS:84",
  width: 1200,
  height: 800,
  format: "image/jpeg"
});
```

## Picking a layer

```ts
import {
  bestOrthophotoFor,
  imageryStackFor,
  findLayers,
  layersForPoint,
  buildNutsTree
} from "@orthogea/catalog";

bestOrthophotoFor(11.2558, 43.7696);           // most local orthophoto, Sentinel-2 as fallback
imageryStackFor(11.2558, 43.7696);             // local -> national -> pan-European
layersForPoint(11.2558, 43.7696, { category: "orthophoto" });

findLayers({ country: "ES", category: "orthophoto" });
findLayers({ nuts: "ITI" });                   // a NUTS-1 region and everything below it
findLayers({ service: "WMTS", queryable: true });
findLayers({ text: "sentinel" });
findLayers({ bbox: [11, 43, 12, 44], zoom: 15 });

buildNutsTree();                               // Europe -> country -> NUTS-1 -> NUTS-2/3
```

Every filter is optional and they combine with AND. `layersForPoint` ranks results by extent, so
the most local source comes first.

## Clicking a layer (GetFeatureInfo)

```ts
import { getFeatureInfo, getFeatureInfoForLayers } from "@orthogea/client/featureinfo";

const answer = await getFeatureInfo(layer, {
  lngLat: [11.2554, 43.7712],
  bbox: [bounds.west, bounds.south, bounds.east, bounds.north], // optional viewport
  width: canvas.clientWidth,
  height: canvas.clientHeight,
  zoom: map.getZoom(),
  featureCount: 5
});

answer.format;                 // "geojson" | "json" | "gml" | "html" | "text" | "empty" | "unknown"
answer.features[0]?.properties; // whatever the service publishes for that point
answer.raw;                     // the untouched body, to render the server's own HTML
```

GeoJSON, GML, MapServer `msGMLOutput`, HTML tables and GeoServer plain text are all reduced to
the same `features[]` shape. A `ServiceException` becomes `answer.warning` instead of a throw,
so a click handler never breaks the map. `getFeatureInfoForLayers()` queries a whole stack and
keeps only the layers that answered with content.

## Vector data (WFS)

```ts
import { toGeoJsonUrl } from "@orthogea/client";

const url = toGeoJsonUrl(layer, { bbox: [11, 43, 12, 44], count: 500 });
const collection = await (await fetch(url)).json();
```

`buildWfsGetFeatureUrl()` writes `TYPENAMES`/`COUNT` on WFS 2.0.0 and `TYPENAME`/`MAXFEATURES`
on 1.x, and appends the CRS to the `BBOX` so the axis order is unambiguous.

## React

```tsx
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { catalog, bestOrthophotoFor } from "@orthogea/catalog";
import { registerOrthoGeaProtocol, toMapLibreBinding } from "@orthogea/client";

registerOrthoGeaProtocol(maplibregl, { layers: [...catalog] });

export function ImageryMap({ lng, lat }: { lng: number; lat: number }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const map = new maplibregl.Map({
      container: container.current!,
      style: { version: 8, sources: {}, layers: [] },
      center: [lng, lat],
      zoom: 15
    });

    map.on("load", () => {
      const { sourceId, source, layer } = toMapLibreBinding(bestOrthophotoFor(lng, lat)!);
      map.addSource(sourceId, source);
      map.addLayer(layer);
    });

    return () => map.remove();
  }, [lng, lat]);

  return <div ref={container} style={{ inset: 0, position: "absolute" }} />;
}
```

## Node and server side

Everything works outside the browser: the packages only need `fetch`, and every function that
performs I/O accepts a `fetchImpl`.

```ts
import { fetchTile } from "@orthogea/client";
import { checkEndpoint, harvestWms } from "@orthogea/harvester";

const { data, contentType } = await fetchTile(layer, { x: 8746, y: 6015, z: 14 });
await writeFile("tile.jpg", Buffer.from(data));

const health = await checkEndpoint(layer.service.url, { service: "WMS" });
// { ok: true, responseTimeMs: 254, version: "1.3.0", layerCount: 102, ... }

const capabilities = await harvestWms("https://example.org/geoserver/wms");
```

Use `checkEndpoints(urls, { concurrency: 4 })` to sweep a whole catalogue in CI and fail the
build when a national service disappears.

## QGIS and desktop GIS

The catalogue files are plain JSON, so a desktop connection list is a short script away:

```js
import { catalog } from "@orthogea/catalog";
import { buildCapabilitiesUrl } from "@orthogea/harvester";

for (const layer of catalog.filter((entry) => entry.service.type === "WMS")) {
  console.log(layer.title, buildCapabilitiesUrl(layer.service.url));
}
```

Paste the resulting URL into *Layer > Add Layer > Add WMS/WMTS Layer* in QGIS; the `layers`
value of the record is the layer to tick.

## Your own catalogue

Nothing forces you to use the bundled data.

```ts
import { registerCollection, safeBuildCatalog } from "@orthogea/catalog/validate";

// Add a collection at runtime, without losing the bundled one.
const { layers, issues } = registerCollection(await (await fetch("/my-layers.json")).json());

// Or validate a document on its own.
const result = safeBuildCatalog({ "my-layers.json": document });
```

Documents are validated against the same Zod schema as the bundled files, and problems are
reported as `issues` instead of thrown, so one typo in a community collection cannot take a
portal down. `packages/catalog/schema/layer-collection.schema.json` gives editors autocompletion
and validation while writing the JSON.

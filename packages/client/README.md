# @orthogea/client

Turns [OrthoGea](../../README.md) catalogue records into map sources: MapLibre GL, Leaflet and
OpenLayers adapters, a framework-agnostic tile URL builder, the reprojecting tile protocol, the
GetFeatureInfo engine and attribution formatting.

**The package never imports a map library.** It produces plain specifications your application
hands to its renderer, so it works with MapLibre, Leaflet, OpenLayers, Cesium, deck.gl or a
`<canvas>`.

```bash
pnpm add @orthogea/client
```

## MapLibre GL

```ts
import maplibregl from "maplibre-gl";
import { registerOrthoGeaProtocol, toMapLibreBinding } from "@orthogea/client";

registerOrthoGeaProtocol(maplibregl, { layers, proxyUrl });   // once, before the map

const { sourceId, source, layer: styleLayer } = toMapLibreBinding(layer, { opacity: 0.8 });
map.addSource(sourceId, source);
map.addLayer(styleLayer);
```

`toRasterSource()`, `toRasterLayer()` and `toStyleSpecification()` are available separately. The
generated WMS template is exactly what the spec asks for, with the placeholder left literal so
MapLibre can substitute it:

```
{base}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=…&STYLES=&FORMAT=image/png
&TRANSPARENT=TRUE&WIDTH=256&HEIGHT=256&SRS=EPSG:3857&CRS=EPSG:3857&BBOX={bbox-epsg-3857}
```

## Leaflet

```js
import { toLeafletSource } from "@orthogea/client";

const source = toLeafletSource(layer);
const leafletLayer =
  source.kind === "tileLayer.wms" ? L.tileLayer.wms(source.url, source.options)
  : source.kind === "tileLayer"   ? L.tileLayer(source.url, source.options)
  : new (L.TileLayer.extend({
      getTileUrl: (c) => source.getTileUrl(c.x, c.y, c.z)
    }))("", source.options);
```

## OpenLayers

```js
import { toOpenLayersSource } from "@orthogea/client";

const description = toOpenLayersSource(layer);   // TileWMS | XYZ | WMTS options
new TileLayer({ source: new TileWMS(description) });
```

## Any renderer

```ts
import { createTileUrlBuilder, fetchTile } from "@orthogea/client";

const tileUrl = createTileUrlBuilder(layer, { proxyUrl });
tileUrl(8746, 6015, 14);

const { data, contentType } = await fetchTile(layer, { x: 8746, y: 6015, z: 14 });
```

The builder asks a WMS for the exact extent of the tile - in EPSG:3857 when the service
publishes it, in a geographic CRS otherwise - and fills WMTS and XYZ templates, flipping the row
for TMS layers.

## Services without EPSG:3857

MapLibre substitutes only `{bbox-epsg-3857}`, and several official services (Lombardia,
Basilicata, Umbria, Marche, Croatia's DGU) never publish Web Mercator. `toRasterSource()` detects
this and emits an `orthogea://` template served by the protocol handler, which converts each
tile index into a geographic extent:

```ts
needsTileReprojection(layer);        // true
supportsWebMercator(layer.service);  // false
pickReprojectionCrs(layer.service);  // "CRS:84"
toRasterSource(layer).tiles;         // ["orthogea://it.lombardia.ortofoto-2024/{z}/{x}/{y}"]
```

`createOrthoGeaProtocol()` supports both the MapLibre 4/5 promise signature and the MapLibre 3
callback signature, times requests out, and turns a `ServiceException` answered with HTTP 200
into a real error. Pass `reprojection: "off"` to get an `UnsupportedServiceError` instead of the
protocol URL.

## GetFeatureInfo

```ts
import { getFeatureInfo, getFeatureInfoForLayers } from "@orthogea/client/featureinfo";

const answer = await getFeatureInfo(layer, {
  lngLat: [11.2554, 43.7712],
  bbox: viewportBbox,          // optional: use the real viewport
  width: canvas.clientWidth,
  height: canvas.clientHeight,
  zoom: map.getZoom(),
  featureCount: 5,
  buffer: 5                    // vendor tolerance (GeoServer BUFFER, MapServer RADIUS)
});
```

- `I`/`J` on WMS 1.3.0, `X`/`Y` on 1.1.x, clamped inside the image.
- Web Mercator window when available, otherwise a geographic window centred on the click.
- GeoJSON, GML, `msGMLOutput`, HTML tables and `key = value` text all reduced to
  `features[].properties`; `raw` keeps the original body.
- A `ServiceException` becomes `answer.warning`; transport errors throw
  `EndpointUnavailableError`.

`parseFeatureInfoResponse()`, `parseGmlFeatureInfo()`, `parseHtmlFeatureInfo()` and
`parseTextFeatureInfo()` are exported for responses you fetch yourself.

## WFS

```ts
import { toGeoJsonUrl, buildWfsGetFeatureUrl } from "@orthogea/client";

toGeoJsonUrl(layer, { bbox: [11, 43, 12, 44], count: 500, cqlFilter: "comune='Firenze'" });
```

## Attribution

```ts
formatAttribution(layer);                       // linked provider + licence, ready for HTML
formatAttributions(layers, { html: false });    // plain text, deduplicated
```

Every adapter fills the attribution field of the source it produces, because most European open
data licences require visible credit.

## Shared options

| Option | Effect |
| --- | --- |
| `proxyUrl` | prefix (`https://p/`), parameter (`https://p/?url=`) or template (`https://p/?target={url}`) proxy; tile placeholders stay literal |
| `tileSize` | override 256/512 |
| `extraParams` | vendor parameters on every request |
| `format`, `transparent`, `styles`, `time` | override the WMS request |
| `tileMatrixTemplate` | WMTS matrix naming, e.g. `EPSG:3857:{z}` |
| `attribution` | `false`, or `{ html: false, includeLicense: false }` |
| `fetchImpl` | inject a fetch implementation (tests, Node, proxies) |

## Seamless mosaic

One virtual layer for the whole of Europe, which is what makes the framework a drop-in
replacement for a commercial satellite basemap.

```ts
import { createMosaic, registerMosaicProtocol, toMosaicRasterSource } from "@orthogea/client";

const mosaic = createMosaic({
  layers: [...catalog],
  fallback: "eu.copernicus.vhr-2021",   // the European base, no API key
  orthophotoFromZoom: 15                // below this: the base only
});

registerMosaicProtocol(maplibregl, mosaic);
map.addSource("imagery", toMosaicRasterSource(mosaic));
map.addLayer({ id: "imagery", type: "raster", source: "imagery" });
```

Below `orthophotoFromZoom` the whole continent is drawn from one fast Copernicus service; above
it the mosaic ranks candidates by extent (the most local authority first), then by whether they
serve cached tiles, then resolution and vintage. It drops imagery belonging to another country,
skips a source that fails, times out or returns a blank image, and always ends on the European
base, so no tile is ever empty. `mosaic.activeSources()` and `mosaic.activeAttribution()` report what is actually on
screen, which keeps the attribution line short and correct.

Tiles are kept in Cache Storage (trimmed at `cacheLimit`, 1500 by default), concurrent requests
for the same tile share one download, and a 256 px tile cache is stitched from its four children
rather than stretched, so a cached service is drawn at the resolution the reader is at.

Warm the ground ahead of a pan while the map is still - a ring when it has not moved, the
leading edge when it has:

```ts
map.on("idle", () => mosaic.prefetchAround(x, y, z));
map.on("idle", () => mosaic.prefetchAhead(x, y, z, headingX, headingY));
```

Visible tiles are fetched at `high` priority and warmed ones at `low`, so speculation never
competes with the viewport. Recombining a 256 px tile cache and repairing a no-data fill both happen in a worker - together
about 50 ms of main-thread stall a tile if they did not - so call `mosaic.dispose()` when you tear
the map down.

Prefetched tiles fill the cache without being credited, so `activeSources()` still describes what
is on screen.

**Stop the zoom before the imagery blurs.** Half of Europe publishes no open orthophoto, and
there the map sits on the 2 m European base: zooming past about 16.5 only enlarges pixels. One
call holds the map at the resolution of whatever is beneath it, and lifts the ceiling again over
better-surveyed ground:

```ts
import { bindDetailZoomLimit } from "@orthogea/client";

bindDetailZoomLimit(map, [orthophotos, base]);

mosaic.detailZoomAt(11.58, 48.14);   // 19.0 over Munich, 40 cm imagery
mosaic.detailZoomAt(9.99, 53.55);    // 16.5 over Hamburg, 2 m base only
```

**A first frame that is already a map.** `@orthogea/client/backdrop` carries one 512 px picture of
Europe, about 15 kB, as a data URI - no network, so it is drawn before the first tile is even
requested:

```ts
import { toBackdropSource, toBackdropLayer } from "@orthogea/client/backdrop";

map.addSource("orthogea-backdrop", toBackdropSource());
map.addLayer(toBackdropLayer());
```

Inspect the decisions without drawing anything:

```ts
mosaic.bestFor(x, y, z);         // the layer that would be drawn
mosaic.select(x, y, z).layers;   // the full candidate chain
mosaic.tileUrl(layer, x, y, z);  // the request behind a tile
await mosaic.fetchTile(x, y, z); // Node, tests, thumbnails
```

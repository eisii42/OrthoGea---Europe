# Concepts

Why the framework exists, and what it does that a hand-written WMS URL does not.

- [Layer records](#layer-records)
- [The seamless mosaic](#the-seamless-mosaic)
- [CRS normalisation](#crs-normalisation)
- [Axis order](#axis-order)
- [Services without Web Mercator](#services-without-web-mercator)
- [Layer inheritance in capabilities](#layer-inheritance-in-capabilities)
- [GetFeatureInfo](#getfeatureinfo)
- [CORS](#cors)
- [Licensing and attribution](#licensing-and-attribution)
- [NUTS](#nuts)

## Layer records

Everything the framework does revolves around one validated record:

```jsonc
{
  "id": "it.toscana.ortofoto-2024",     // stable, lowercase, dot separated
  "title": "Ortofoto 2024/2025 - Toscana (Geoscopio)",
  "category": "orthophoto",             // orthophoto | satellite | cadastre | elevation | land_use | custom
  "provider": { "name": "Regione Toscana - Geoscopio", "url": "https://..." },
  "country": "IT",                      // NUTS-0, or EU for pan-European datasets
  "nuts": "ITI1",                        // most specific NUTS code covered
  "regionName": "Toscana",
  "bbox": [9.64, 42.168, 12.464, 44.504], // always [minLng, minLat, maxLng, maxLat], WGS84
  "service": {
    "type": "WMS",                       // WMS | WMTS | XYZ | WFS | COG
    "url": "https://www502.regione.toscana.it/ows_ofc/com.rt.wms.RTmap/wms?map=owsofc_rt",
    "options": {
      "layers": ["rt_ofc.5k24.32bit"],
      "format": "image/jpeg",
      "crs": ["EPSG:3857", "EPSG:4326", "EPSG:6706", "EPSG:3003"],
      "version": "1.3.0",
      "queryable": false,
      "transparent": false,
      "infoFormats": ["text/html", "text/plain", "text/gml"]
    }
  },
  "license": { "id": "CC-BY-4.0", "url": "https://..." },
  "attribution": "Regione Toscana - Geoscopio",
  "minZoom": 8,
  "maxZoom": 20,
  "lastVerified": "2026-08-23"
}
```

`OrthoGeaLayerSchema` is strict: unknown keys are rejected, the NUTS code must belong to the
declared country, the zoom range must be ordered, custom licences must be named, and every CRS
string is normalised while parsing. `service` is a discriminated union, so narrowing on
`layer.service.type` gives you the right options object with no cast.

## The seamless mosaic

A catalogue of 42 layers is a list; a basemap is one image. The mosaic turns the first into the
second by choosing, per tile, which source to ask.

**Two tiers, on purpose.** The architecture is deliberately shallow:

| Tier | Resolution | Drawn |
| --- | --- | --- |
| Copernicus VHR 2021 | about 2 m | everywhere, at every zoom |
| regional or national orthophoto | 8-30 cm | from `orthophotoFromZoom` (15) upwards |

One background for the whole continent is what makes the map feel like a commercial basemap:
every low-zoom tile comes from the same fast service, so there is no patchwork, no seam and no
waiting for a dozen regional servers. Orthophotos are asked for only where they add something,
past zoom 15 where 2 m starts to show, and where none is published the base simply stays on.

**Speed before sharpness at equal ground.** Among candidates covering the same extent, a service
that serves pre-rendered tiles (WMTS, XYZ) wins over a WMS that renders every request. A cache has
a fixed grid, though, and it is usually 256 px: asked for the level a 512 px mosaic wants, it
answers with an image the renderer would stretch, leaving the imagery a full zoom level behind.
The four children are fetched in parallel and stitched instead, which keeps the speed of a tile
cache at the resolution the reader is actually at.

**A gradual hand-over.** Drawn as a single layer, the switch from base to orthophoto is a flip.
Drawn as two - the Copernicus base underneath, an orthophoto-only mosaic above with an opacity
ramp across a couple of zoom levels - the detail arrives instead. The upper mosaic carries no
fallback, so where no orthophoto exists its tiles are transparent and the base simply shows
through:

```ts
map.addLayer(toMosaicRasterLayer(orthophotos, { fadeFromZoom: 13.5, fadeToZoom: 15.5 }));
```

**The map stops where the data stops.** Half of Europe publishes no open orthophoto, and there
the map sits on the 2 m European base. Letting a reader zoom to 20 over Sofia or Hamburg reveals
nothing - it enlarges pixels, and an upscaled satellite image is the one thing that makes an open
basemap look cheap next to a commercial one. `detailZoomAt()` answers with the deepest zoom the
imagery under a point actually supports, from its resolution and the latitude, and
`bindDetailZoomLimit()` holds the map there:

```ts
mosaic.detailZoomAt(11.58, 48.14);   // 19.0 over Munich, 40 cm imagery
mosaic.detailZoomAt(9.99, 53.55);    // 16.5 over Hamburg, 2 m base only

bindDetailZoomLimit(map, [orthophotos, base]);
```

The limit follows the reader, so it lifts again over better-surveyed ground, and it learns: a
service whose rectangle covers Hamburg but whose tiles are empty there stops counting as soon as
it has answered once.

**Once covered, always covered.** A service that has drawn a tile is remembered as covering that
area, at a zoom-independent key. Deeper tiles from it are then trusted even when they are tiny: a
uniform roof or a ploughed field compresses to almost nothing at zoom 19, and falling back to the
2 m base at that point is exactly what a reader notices.

**Ranking.** Coverage is a rectangle, and rectangles overlap: the French national extent reaches
into Liguria, the Veneto one into Trentino. Candidates are therefore ordered by

1. extent - the most local authority wins;
2. resolution - between comparable extents, the sharper flight;
3. vintage - between comparable flights, the most recent;
4. id - so the choice is deterministic.

Then imagery from another country is dropped: once the most local candidate is known, only its
country and pan-European layers stay in the chain.

**No-data fills.** A service asked for a tile that *straddles* the edge of its coverage does not
answer with a smaller image. It answers with the whole rectangle and fills the uncovered part with
flat white or black - and JPEG has no alpha channel, so that fill is opaque and lands on top of
whatever is drawn below. Along the Tuscan shoreline it affected 23 of 49 tiles; inland, and over
the Venetian lagoon, none.

The fill is found by flooding inwards from the tile border over near-flat pixels. **Connectivity is
what makes this safe**: a car park, a deep shadow, a white roof and a snowfield are every bit as
flat as a collar, but imagery surrounds them and the flood never arrives. Only a flat region that
reaches the edge is treated as one - which is the difference between this and keying every dark
pixel to transparent, a rule that would punch holes in every car park in Europe.

A tile that is *entirely* fill is dropped, so the next source or the base below takes over. A tile
that is *partly* fill has the fill made transparent and is re-encoded as PNG. Detection runs on a
64 px thumbnail, which settles almost every tile for about 5 ms; only a tile with a real boundary
running through it pays for the full-resolution repair. Turn it off with `trimCollars: false`.

**Blank tiles.** A WMS asked outside its real footprint does not fail: it returns a blank image
of a few hundred bytes. Tiles below `minTileBytes` (9000 for 512 px tiles, 2500 for 256 px ones)
are treated as empty and the next candidate is tried.

A mosaic with a **fallback** makes one exception: its last candidate is accepted as it comes, so
a genuinely uniform tile - open sea, a snowfield - still renders. A mosaic **without** one never
does. Rectangles cross borders, and a neighbour's no-data fill is not imagery: basemap.at answers
white over Munich, IGN answers white over Frankfurt, and painting either of them washed out every
German city at detail zoom. Where a hole is possible, the hole wins and the layer below shows
through.

**Failures.** A source that errors, times out or answers with a `ServiceException` is skipped
for `failureTtlMs` (a minute by default), so one broken national service cannot stall the map.
Two answers are read as geography rather than health, and stay local to the block they came from:
a blank image, and a **404** - which is how a tile cache says it holds nothing here. Blacklisting
basemap.at because it has nothing over Munich would take Austria with it.

**Duplicates.** Two records for the same ground - Veneto's WMS and its cached WMTS, the two
Emilia-Romagna flights - would fight for the same tile. The catalogue tags the secondary one
`alternative` and the mosaic skips those tags, while the records stay available for explicit use
and for GetFeatureInfo.

## Weight

A framework meant to sit inside someone else's web-GIS is judged first on what it adds to their
bundle. The runtime path - catalogue, mosaic, adapters - imports **no third-party package at
all**, and the two the project does depend on live behind their own entry points:

| entry | carries | needed for |
| --- | --- | --- |
| `@orthogea/core/schemas` | Zod | authoring or validating catalogue documents |
| `@orthogea/catalog/validate` | Zod | loading collections you did not author |
| `@orthogea/client/featureinfo` | fast-xml-parser | click-to-query on WMS layers |

Two decisions make that possible. The bundled catalogue is validated and normalised by
`scripts/build-data.mjs` when the package is **built**, so the browser receives complete data and
never runs a schema; and the runtime guards that used to call into Zod - `isValidBBox` and
`isValidNutsCode` - are written out by hand, with tests holding them in step with the schema.

The whole basemap, catalogue included, is 22.3 kB gzipped - 2.8 kB of which is the tile worker
and the transparent tile. A map that only turns one catalogue record into a source never loads
the worker at all, and stays at 4.4 kB. `pnpm size` reproduces the figure.

## Performance

A basemap is judged on how fast it draws, especially on a thin connection.

- **JPEG, not PNG.** Aerial imagery is photographic: PNG costs 5-10x more bytes for no visible
  gain. Every opaque imagery record asks for `image/jpeg`; overlays that need transparency stay
  on PNG.
- **512 px tiles.** One request covers four times the ground. Fewer round trips, less latency,
  and a quarter of the watermarks that services stamp on every tile.
- **A source `maxzoom` of 19.** A 20 cm orthophoto has no more detail past that; MapLibre
  upscales the tiles it holds instead of firing a fresh request at every deeper zoom. Note this
  belongs on the *source*: a `maxzoom` on a style layer **hides** it instead.
- **Cache Storage.** Tiles are stored under `orthogea-tiles`, so panning back is instant and the
  map keeps working when the connection drops. Pass `cacheName: false` to opt out. Cache Storage
  never evicts on its own, so `cacheLimit` (1500 tiles, roughly 60 MB) trims the oldest entries in
  batches rather than letting the browser drop the whole origin at once.
- **One download per tile.** Callers that want the same tile at the same moment - the renderer and
  the prefetcher, or a pan that returns to a tile still in flight - share one request, and it is
  dropped only when the last of them walks away.
- **Prefetching.** `prefetchAround()` warms the ring of tiles just outside the viewport while the
  map is still, so a pan starts from cache instead of a round trip. Call it on `idle`, never
  while the map is moving, and skip it when `navigator.connection` reports save-data or 2G.
- **A base that stops at its own resolution.** The 2 m European base is only asked for tiles down
  to the level that matches its ground sampling; past that the service returns its own upscale, so
  MapLibre may as well upscale the tiles it already holds.
- **Empty areas are remembered.** Coverage gaps are contiguous: when a service answers blank, the
  whole 4x4 tile block is marked, and it is not asked again there.
- **Failures back off** for a minute, so one broken national service cannot slow the map down.
- **The main thread stays free.** Recombining a 256 px tile cache into one 512 px tile costs four
  decodes, a canvas composite and a re-encode: 68 ms a tile, four dropped frames each, and half a
  second of stutter for a viewport's worth. That work happens in a worker built from a Blob URL -
  no bundler configuration, no asset to host - and the main thread only computes the four URLs,
  which takes microseconds. Measured over four tiles: **199 ms of main-thread stall inline - 50 ms
  a tile, longest single stall 43 ms - and 0 ms through the worker**.

  Routing is deliberately *not* offloaded. Choosing the layer and its extent measures 12 µs a
  tile - 0.75 ms for a whole viewport - and a `postMessage` round trip costs more than that.
- **Requests carry a priority.** A tile on screen is fetched at `high` and a warmed one at `low`,
  so speculative traffic can never take bandwidth from what the reader is looking at.
- **Aborting is immediate.** A tile that leaves the viewport is dropped mid-flight, and the request
  is only really cancelled once the last caller has walked away - a tile the prefetcher still wants
  keeps downloading.
- **A hole is not cached.** An uncovered tile is a full 512 × 512 transparent PNG returned with
  `cache-control: no-store`, so a service that was rate-limiting for a moment gets asked again on
  the next pass rather than leaving the area empty for the session.

## CRS normalisation

The same CRS appears in a dozen spellings across European services. All of these resolve to
`EPSG:3857`:

```
EPSG:3857   epsg:3857   EPSG::3857   urn:ogc:def:crs:EPSG::3857
EPSG:900913 EPSG:102100 EPSG:3785    http://www.opengis.net/def/crs/EPSG/0/3857
```

`normalizeCrs()` understands short codes, URNs, OGC and GML URLs, glued forms (`EPSG3857`) and
bare numbers, and `isSameCrs()` knows the equivalence groups. Unknown but well-formed codes
survive as `AUTHORITY:IDENTIFIER`, so an exotic national grid still round-trips. `registerCrs()`
adds definitions at runtime.

The bundled registry covers what European geoportals actually publish: WGS84 and CRS:84, ETRS89
(`EPSG:4258`), RDN2008 (`EPSG:6706`), the Italian Gauss-Boaga and TM zones, the ETRS89 UTM and
LAEA/LCC grids, and the national grids of France, Britain, the Netherlands, Belgium, Poland,
Sweden, Finland, Czechia and Slovakia.

## Axis order

This is where most hand-written WMS integrations break.

| Protocol | CRS | Order of `BBOX` |
| --- | --- | --- |
| WMS 1.1.1 | any | longitude, latitude (`minx,miny,maxx,maxy`) |
| WMS 1.3.0 | `CRS:84`, `EPSG:3857`, most projected grids | longitude/easting first |
| WMS 1.3.0 | `EPSG:4326`, `EPSG:4258`, `EPSG:6706`, `EPSG:3035`, `EPSG:2180`, `EPSG:3006` | **latitude/northing first** |
| WMTS, WFS 2.0 | as defined by the authority | same rule as WMS 1.3.0 |

```ts
getAxisOrder("EPSG:4326");           // "latlon"
getAxisOrder("EPSG:4326", "1.1.1");  // "lonlat"
getAxisOrder("EPSG:3857");           // "lonlat"

formatBBox(bbox, { crs: "EPSG:6706", wmsVersion: "1.3.0" }); // "42.23,9.68,44.47,12.37"
orderBBoxForCrs(bbox, "EPSG:3035");                          // northing first
```

The same rule applies when *reading*: a `<BoundingBox CRS="EPSG:6706" minx="35.4" miny="6.6" .../>`
in a 1.3.0 document has `minx` as a latitude. The harvester stores both forms, `raw` exactly as
written and `bbox` normalised to x/y, so nothing is guessed twice.

## Services without Web Mercator

MapLibre GL substitutes only `{bbox-epsg-3857}` in a raster tile URL, and Leaflet asks a WMS in
the CRS of the map. Several official services never publish `EPSG:3857`:

| Service | Published CRS |
| --- | --- |
| Regione Marche orthophoto (IT) | `CRS:84`, `EPSG:4326`, `EPSG:3004` |
| Regione Umbria orthophoto (IT) | `CRS:84`, `EPSG:4326`, `EPSG:32633` |
| DGU orthophoto 2019 (HR) | `EPSG:4326`, `CRS:84`, `EPSG:3765` |
| Regione Lombardia orthophoto 2024 (IT) | `CRS:84`, `EPSG:4326`, `EPSG:7791` |
| Regione Basilicata orthophoto (IT) | `EPSG:4326`, `EPSG:25833`, `EPSG:32633`, `CRS:84` |

OrthoGea renders them anyway. For each tile it converts the `{x, y, z}` index into the
geographic extent of that tile and issues the `GetMap` in a CRS the service does publish:

```ts
needsTileReprojection(layer);          // true
pickReprojectionCrs(layer.service);    // "CRS:84"
toRasterSource(layer).tiles;           // ["orthogea://it.lombardia.ortofoto-2024/{z}/{x}/{y}"]
```

Drawing an equirectangular request into a Mercator tile leaves a residual distortion of
`(Δφ / 2) · tan(φ)`: about 0.02 % at zoom 14 (well under one pixel of a 256 px tile) and a few
pixels at zoom 8. Layers using this path carry the `no-3857` tag in the catalogue, and a test
keeps the tag in sync with the data.

The CRS is taken from the order declared in the record, which is the only place where a broken
advertisement can be corrected: the Basilicata service answers `CRS:84` with a blank image but
serves `EPSG:4326` correctly, so its record lists EPSG:4326 first.

`reprojection: "off"` turns the fallback into an explicit `UnsupportedServiceError` if you would
rather handle it yourself.

## Layer inheritance in capabilities

A WMS capabilities document is a tree, and children inherit from their parent. The rules are
easy to get wrong, so the harvester applies them once, centrally:

| Property | Rule |
| --- | --- |
| `CRS` / `SRS` | accumulate: child list is added to the parent list |
| `Style` | accumulate, child wins on the same name |
| `BoundingBox` | replace per CRS |
| `EX_GeographicBoundingBox` / `LatLonBoundingBox` | replace |
| `Dimension` / `Extent` | replace per name |
| `Attribution`, `queryable`, `opaque`, `cascaded`, scale range | inherited when the child does not declare them |
| `MetadataURL`, `Abstract`, `KeywordList` | not inherited |

The parser also normalises the version differences: `SRS` lists separated by whitespace,
`ScaleHint` converted into scale denominators, `Extent` merged into `Dimension`,
`ServiceExceptionReport` turned into a typed error, and layers without a `Name` kept in the tree
but excluded from the requestable list.

Real capabilities documents can be several megabytes and contain tens of thousands of XML
entities; the parser raises the entity-expansion limits accordingly while keeping the recursion
depth capped, so a billion-laughs document is still rejected.

## GetFeatureInfo

The engine builds the request and normalises the answer.

- Window: the real viewport when you pass `bbox`, `width` and `height`, otherwise a 101 px
  square centred on the click, sized from the zoom.
- Pixel: `I`/`J` on WMS 1.3.0, `X`/`Y` on 1.1.x, always clamped inside the image.
- CRS: Web Mercator when available, else a geographic CRS with the click exactly at the centre.
- Format: `application/geo+json` > `application/json` > `text/html` > GML > XML > plain text.
  HTML sits before GML on purpose - several INSPIRE services return an attribute-less GML
  envelope but a complete attribute table in HTML.
- Parsing: GeoJSON keeps geometry; GML, `msGMLOutput`, GeoServer HTML tables, MapServer
  attribute tables and `key = value` text are reduced to `features[].properties`.
- Errors: HTTP and timeout failures throw `EndpointUnavailableError`; a `ServiceException` in the
  body becomes `answer.warning`, so a map click never explodes.

## CORS

Public geoportals rarely send `Access-Control-Allow-Origin`, and a browser cannot bypass that.
Options, in order of preference:

1. **Server-side proxy you control.** Every adapter takes `proxyUrl`; the demo's
   `vite.config.ts` shows a 40-line implementation that only forwards hosts present in the
   catalogue - copy it into your backend and keep the allowlist.
2. **Same-origin path.** Put `/geo/<provider>` in your reverse proxy (nginx, Caddy, Cloudflare
   Worker) and pass `proxyUrl: "/geo/toscana?url="`.
3. **Direct.** Some services do send the header - the EEA Copernicus mosaics, IGN France, swisstopo and PDOK among them -
   and need no proxy at all.

Placeholders survive proxying: `applyCorsProxy()` percent-encodes the target URL but restores
`{bbox-epsg-3857}`, `{z}`, `{x}`, `{y}` and friends, otherwise the renderer would never
substitute them. Query values keep literal `:` and `,` because several national services reject
`%3A` and `%2C`.

## Licensing and attribution

The code is MIT. The **data is not**: each record carries a `license` object and an
`attribution` string, and most European open-data licences require visible credit.

```ts
formatAttribution(layer);
// '<a href="https://www.regione.toscana.it/...">Regione Toscana - Geoscopio</a> (<a href="...">CC-BY-4.0</a>)'

formatAttributions(visibleLayers, { html: false });
// "Regione Toscana - Geoscopio (CC-BY-4.0) | Agenzia delle Entrate - Cartografia catastale (CC-BY-4.0)"
```

The adapters put that string in `source.attribution` (MapLibre), `options.attribution`
(Leaflet) and `attributions` (OpenLayers), so the credit appears by default. Records with
`license.id === "custom"` always carry a `name`, and often a `notes` field with the actual
obligation - for example that a service may be used for visualisation only. Read it before
shipping, and check `status`: `experimental` layers need credentials or are otherwise not ready
for production.

## NUTS

Layers are indexed with the European statistical hierarchy, so a portal can offer
"Europe -> Italy -> Centro -> Toscana" without a lookup table:

```ts
nutsLevel("ITI1");          // 2
nutsParent("ITI14");        // "ITI1"
nutsAncestors("ITI14");     // ["ITI1", "ITI", "IT"]
isNutsWithin("ITI14", "IT") // true
nutsToIso("EL");            // "GR"   (NUTS uses EL for Greece and UK for the United Kingdom)
```

`findLayers({ nuts: "ITI" })` matches a code and everything below it; `buildNutsTree()` returns
the hierarchy with per-node layer counts, ready for a sidebar.

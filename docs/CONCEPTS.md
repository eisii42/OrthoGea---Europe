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

A catalogue of 52 layers is a list; a basemap is one image. The mosaic turns the first into the
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
that serves pre-rendered tiles (WMTS, XYZ) wins over a WMS that renders every request.

**Ranking.** Coverage is a rectangle, and rectangles overlap: the French national extent reaches
into Liguria, the Veneto one into Trentino. Candidates are therefore ordered by

1. extent - the most local authority wins;
2. resolution - between comparable extents, the sharper flight;
3. vintage - between comparable flights, the most recent;
4. id - so the choice is deterministic.

Then imagery from another country is dropped: once the most local candidate is known, only its
country and pan-European layers stay in the chain.

**Blank tiles.** A WMS asked outside its real footprint does not fail: it returns a blank image
of a few hundred bytes. Tiles below `minTileBytes` (2500 by default) are treated as empty and
the next candidate is tried - except for the last source, so genuinely uniform tiles (open sea,
snow) still render.

**Failures.** A source that errors, times out or answers with a `ServiceException` is skipped
for `failureTtlMs` (a minute by default), so one broken national service cannot stall the map.
A blank answer is not counted as a failure: the same service is fine a few kilometres away.

**Duplicates.** Two records for the same ground - Veneto's WMS and its cached WMTS, the two
Emilia-Romagna flights - would fight for the same tile. The catalogue tags the secondary one
`alternative` and the mosaic skips those tags, while the records stay available for explicit use
and for GetFeatureInfo.

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
  map keeps working when the connection drops. Pass `cacheName: false` to opt out.
- **Empty areas are remembered.** Coverage gaps are contiguous: when a service answers blank, the
  whole 4x4 tile block is marked, and it is not asked again there.
- **Failures back off** for a minute, so one broken national service cannot slow the map down.

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
| Agenzia delle Entrate cadastre (IT) | `EPSG:6706`, `EPSG:4258`, `EPSG:3044/3045/3046`, `EPSG:25832/33/34` |
| Regione Marche orthophoto (IT) | `CRS:84`, `EPSG:4326`, `EPSG:3004` |
| Regione Umbria orthophoto (IT) | `CRS:84`, `EPSG:4326`, `EPSG:32633` |
| DGU orthophoto 2019 (HR) | `EPSG:4326`, `CRS:84`, `EPSG:3765` |
| Regione Lombardia orthophoto 2024 (IT) | `CRS:84`, `EPSG:4326`, `EPSG:7791` |
| Regione Basilicata orthophoto (IT) | `EPSG:4326`, `EPSG:25833`, `EPSG:32633`, `CRS:84` |

OrthoGea renders them anyway. For each tile it converts the `{x, y, z}` index into the
geographic extent of that tile and issues the `GetMap` in a CRS the service does publish:

```ts
needsTileReprojection(layer);          // true
pickReprojectionCrs(layer.service);    // "EPSG:6706"
toRasterSource(layer).tiles;           // ["orthogea://it.ade.catasto-particelle/{z}/{x}/{y}"]
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

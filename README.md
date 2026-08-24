# OrthoGea - Europe

**Official European imagery for your map, instead of Google Satellite or ESRI World Imagery.**

OrthoGea is a modular TypeScript framework (MIT) that aggregates, parses, catalogues and renders
open European geodata - regional orthophotos, Copernicus imagery, DTM, land use - inside any
modern web-GIS.

```
harvest (GetCapabilities)  ->  catalogue (validated JSON)  ->  render (MapLibre, Leaflet, OpenLayers)
```

| | |
| --- | --- |
| **55 layers, 19 countries + EU** | every endpoint probed live, `lastVerified` stored per record |
| **Better than a global mosaic** | 8-30 cm official orthophotos where they exist, Sentinel-2 elsewhere |
| **MIT code, open data** | no API key, no tile quota, no terms-of-service trap; licence and attribution carried per layer |
| **Seamless mosaic** | one virtual layer picks the best source per tile, Copernicus imagery when zoomed out |
| **Built for slow links** | JPEG tiles, 512 px requests, browser tile cache, empty areas remembered |
| **Any map library** | MapLibre GL, Leaflet and OpenLayers adapters, plus a plain `(x, y, z) => url` builder |
| **Protocol-correct** | WMS 1.1.1 and 1.3.0 axis order, CRS normalisation, WMTS KVP/REST, GetFeatureInfo, WFS |
| **Handles awkward services** | renders WMS endpoints that do not publish EPSG:3857, such as Lombardia or Basilicata |

- [Catalogue of every layer](docs/CATALOG.md)
- [Integration recipes](docs/INTEGRATION.md) - MapLibre, Leaflet, OpenLayers, React, Node, QGIS
- [Concepts](docs/CONCEPTS.md) - axis order, CRS, reprojection, CORS, licensing
- [Contributing a layer](CONTRIBUTING.md)

## Replace a proprietary basemap in four lines

```ts
import maplibregl from "maplibre-gl";
import { catalog, DEFAULT_SATELLITE_FALLBACK_ID } from "@orthogea/catalog";
import { createMosaic, registerMosaicProtocol, toMosaicRasterSource } from "@orthogea/client";

const mosaic = createMosaic({ layers: [...catalog], fallback: DEFAULT_SATELLITE_FALLBACK_ID });
registerMosaicProtocol(maplibregl, mosaic);

map.addSource("imagery", toMosaicRasterSource(mosaic));
map.addLayer({ id: "imagery", type: "raster", source: "imagery" });
```

For the smoothest result, draw the Copernicus base and let the orthophotos **fade in** over it:

```ts
const orthophotos = createMosaic({
  id: "orthophotos",
  layers: catalog.filter((layer) => layer.category === "orthophoto"),
  orthophotoFromZoom: 0            // no threshold: the fade decides what shows
});                                // no fallback: holes stay transparent

map.addSource("base", toRasterSource(getLayer("eu.copernicus.vhr-2021")!, { tileSize: 512 }));
map.addLayer({ id: "base", type: "raster", source: "base" });

map.addSource("orthophotos", toMosaicRasterSource(orthophotos));
map.addLayer(toMosaicRasterLayer(orthophotos, { fadeFromZoom: 13.5, fadeToZoom: 15.5 }));
```

That is **one seamless imagery layer for the whole of Europe**, and it behaves like a commercial
satellite basemap:

- **one European base**: everywhere, at every zoom, the map is drawn from **Copernicus VHR 2021**
  (about 2 m). A single fast source means no patchwork, no seams and no waiting;
- **from zoom 15** the official orthophoto of the area takes over, at 8-30 cm, exactly where 2 m
  would start to show. Where no aerial imagery is published the base simply stays on, at a
  resolution that still reads at street level;
- **cached services first**: where a provider publishes both a tile service and a WMS, the
  pre-rendered tiles win, because they answer in milliseconds;
- **at every border** the tiles hand over by themselves: pan from Toscana to Umbria, or from
  France into Italy, and the source changes under you;
- **a dead or empty tile never shows**: a service that fails, times out or answers with a blank
  image is skipped for that tile and briefly blacklisted, so one broken national server cannot
  slow the map down.

For a single explicit layer instead of the mosaic:

```ts
import { bestOrthophotoFor } from "@orthogea/catalog";
import { toRasterSource } from "@orthogea/client";

const layer = bestOrthophotoFor(11.2558, 43.7696)!;   // Ortofoto 2024/2025 - Toscana
map.addSource("imagery", toRasterSource(layer));      // attribution included
```

## Packages

| Package | What it does |
| --- | --- |
| [`@orthogea/core`](packages/core) | Zod schemas and types (`OrthoGeaLayer`, `WMSOptions`, ...), CRS normalisation and axis-order rules, bounding-box maths, Web Mercator projection, NUTS helpers. No I/O. |
| [`@orthogea/harvester`](packages/harvester) | `GetCapabilities` parsers for WMS 1.1.0/1.1.1/1.3.0 and WMTS 1.0.0, layer-inheritance resolution, endpoint health checks, conversion of harvested layers into catalogue records. |
| [`@orthogea/client`](packages/client) | MapLibre GL, Leaflet and OpenLayers adapters, the framework-agnostic tile URL builder, tiled WMS/WMTS/XYZ templates, the reprojecting tile protocol, the GetFeatureInfo engine, attribution formatting. |
| [`@orthogea/catalog`](packages/catalog) | Hierarchical registry (NUTS-0 to NUTS-3) of verified endpoints, query API, NUTS tree, imagery selection helpers, live verification script. |
| [`apps/demo`](apps/demo) | Vite + MapLibre GL single-page app: layer switcher, region jump, opacity, click-to-query, attributions, dev CORS proxy. |

Each package publishes dual ESM/CJS builds with `.d.ts`, has no dependency on a map library, and
can be used on its own.

## Quick start

```bash
pnpm install
pnpm build
pnpm test
pnpm --filter @orthogea/demo dev     # http://localhost:5173
```

Developed with pnpm 9 and Node 20+. Enable it once with `corepack enable pnpm`; the workspace
scripts run through turbo, which needs the `pnpm` binary on the `PATH`. Individual packages work
without it, for example `corepack pnpm --filter @orthogea/core test`.

## What the demo shows

The Copernicus base with the Tuscan orthophoto fading in over it, both from official services:

- the seamless imagery layer, plus a switcher over the whole catalogue;
- "jump to" selector built from the NUTS tree (Europe -> Italy -> Centro -> Toscana);
- `GetFeatureInfo` on every visible queryable layer, parsed into a property table;
- attributions rendered from the catalogue licence data;
- a dev-only CORS proxy, restricted to the hosts of the catalogue.

## The three problems this framework solves

### 1. Axis order

WMS 1.1.1 always writes `BBOX=minLon,minLat,maxLon,maxLat`. WMS 1.3.0 follows the CRS
definition instead, so `EPSG:4326`, `EPSG:4258`, `EPSG:6706` - and projected grids such as
`EPSG:3035` or `EPSG:2180` - are **latitude first**. The harvester undoes the swap when reading
capabilities, the client re-applies it when writing requests:

```ts
formatBBox(tuscany, { crs: "EPSG:4326", wmsVersion: "1.1.1" }); // "9.68,42.23,12.37,44.47"
formatBBox(tuscany, { crs: "EPSG:4326", wmsVersion: "1.3.0" }); // "42.23,9.68,44.47,12.37"
formatBBox(tuscany, { crs: "CRS:84",    wmsVersion: "1.3.0" }); // "9.68,42.23,12.37,44.47"
```

CRS strings are normalised first, so `urn:ogc:def:crs:EPSG::3857`, `EPSG:900913` and
`EPSG:102100` all resolve to `EPSG:3857`.

### 2. Services without Web Mercator

MapLibre raster sources can only substitute `{bbox-epsg-3857}`, but several national services
publish only geodetic CRS. The Lombardia orthophoto advertises `CRS:84`, `EPSG:4326` and
RDN2008/UTM32N, and never Web Mercator; Basilicata, Marche and Croatia are the same.

`toRasterSource()` detects this and emits an `orthogea://` tile template; the protocol handler
converts each tile index into a geographic extent and issues the `GetMap` in a CRS the service
does support. Leaflet gets the same treatment through `createTileUrlBuilder()`.

```ts
registerOrthoGeaProtocol(maplibregl, { layers, proxyUrl });
toRasterSource(layer).tiles; // ["orthogea://it.lombardia.ortofoto-2024/{z}/{x}/{y}"]
```

`GetFeatureInfo` uses the same fallback, switching to a geographic window centred exactly on the
click.

### 3. CORS

Most geoportals answer without `Access-Control-Allow-Origin`. Every adapter accepts a
`proxyUrl`, in prefix (`https://proxy/`), parameter (`https://proxy/?url=`) or template
(`https://proxy/?target={url}`) form, and keeps renderer placeholders literal so the map library
can still substitute them. The demo ships a dev-only proxy restricted to catalogue hosts; see
[docs/CONCEPTS.md](docs/CONCEPTS.md#cors) for a production one.

## Speed on a thin connection

Everything below is on by default:

| Measure | Effect |
| --- | --- |
| one European base | below the detail zoom the map asks a single fast service, not a dozen regional ones |
| cached tile services first | a pre-rendered WMTS or XYZ tile beats a WMS that renders on demand |
| JPEG instead of PNG for imagery | 5-10x smaller tiles - Sicilia went from 194 kB to 26 kB per tile |
| 512 px tile requests | a quarter of the round trips for the same ground, and a quarter of the server watermarks on screen |
| source `maxzoom` at 19 | past the native detail of a 20 cm orthophoto MapLibre upscales what it already has, so zooming in fires no new requests |
| Cache Storage | revisited areas draw from disk, and keep drawing when the network drops |
| empty-area memory | a service that answered blank is not asked again for the surrounding block |
| failure back-off | a service that errors or times out is skipped for a minute |
| cached WMTS preferred | where a provider publishes both, the pre-rendered tiles win |

## Catalogue coverage

| Scope | Layers |
| --- | --- |
| Pan-European | **Copernicus VHR 2021 (about 2 m)** as the single base, CORINE Land Cover 2018, EU-DEM |
| Italy - regional | 16 of 21 regions and autonomous provinces: Piemonte 2024, Lombardia 2024, Bolzano 2023, Trento 2015, Veneto 2024 (WMS + WMTS), Friuli-Venezia Giulia 2020, Emilia-Romagna 2023-24, Toscana 2024/2025, Umbria 2020, Marche 2022, Lazio 2023, Abruzzo 2022, Puglia 2023, Basilicata 2013, Sicilia 2022, Sardegna 2022 |
| Rest of Europe | Spain (PNOA, MTN raster), France (BD ORTHO WMS and WMTS), Germany (13 state orthophoto services, basemap.de), Netherlands, Belgium (Flanders, Wallonia), Luxembourg, Portugal, Switzerland, Austria, Poland, Czechia, Slovakia, Slovenia, Croatia, Greece, Estonia, Denmark, Sweden |

The full table lives in [docs/CATALOG.md](docs/CATALOG.md). Every record is checked end to end -
capabilities **and** one real tile per layer - with:

```bash
pnpm --filter @orthogea/catalog verify
```

Every record is checked end to end - capabilities **and** one real tile per layer. The mosaic has
its own live check, which walks a set of places and zoom levels and prints the source picked for
each:

```bash
pnpm --filter @orthogea/catalog verify         # one tile per catalogued layer
pnpm --filter @orthogea/catalog verify:mosaic  # the zoom hand-over, against the real services
```

```
z 6  Firenze   -> eu.copernicus.vhr-2021        55852 B image/jpeg
z14  Firenze   -> eu.copernicus.vhr-2021        66345 B image/jpeg
z18  Firenze   -> it.toscana.ortofoto-2024      57308 B image/jpeg
z16  Milano    -> it.lombardia.ortofoto-2024    85829 B image/jpeg
z16  Genova    -> eu.copernicus.vhr-2021        64881 B image/jpeg
z14  Paris     -> eu.copernicus.vhr-2021        82146 B image/jpeg
```

One layer needs credentials and is marked `status: "experimental"`: the Danish Dataforsyningen
service wants a token.

Five Italian regions still have no public orthophoto service that could be found - Valle d'Aosta,
Liguria, Molise, Campania and Calabria: their portals answer 404 or 500, or publish no OGC
endpoint at all. The European base covers them at about 2 m.
See [CONTRIBUTING.md](CONTRIBUTING.md) if you know the current URL.

## Development

```bash
pnpm build                                  # turbo build of every package (ESM + CJS + .d.ts)
pnpm test                                   # vitest across the workspace
pnpm typecheck                              # tsc --noEmit in every package
pnpm --filter @orthogea/catalog verify      # live check of every catalogued endpoint
pnpm --filter @orthogea/catalog schema      # regenerate the JSON Schema for the data files
pnpm --filter @orthogea/catalog docs        # regenerate docs/CATALOG.md
```

## Licence

The code is [MIT](LICENSE).

The imagery is not: every catalogued endpoint keeps the licence of its publisher, recorded in the
`license` field of the record and rendered in the map attribution. Most require visible credit,
which the client builds for you. See [NOTICE.md](NOTICE.md) and
[docs/CONCEPTS.md](docs/CONCEPTS.md#licensing-and-attribution) before publishing a map.

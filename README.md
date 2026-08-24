# OrthoGea - Europe

**Official European imagery for your map, instead of Google Satellite or ESRI World Imagery.**

OrthoGea is a modular TypeScript framework (MIT) that aggregates, parses, catalogues and renders
open European geodata - regional orthophotos, cadastre, Copernicus imagery, DTM, land use -
inside any modern web-GIS.

```
harvest (GetCapabilities)  ->  catalogue (validated JSON)  ->  render (MapLibre, Leaflet, OpenLayers)
```

| | |
| --- | --- |
| **49 layers, 18 countries + EU** | every endpoint probed live, `lastVerified` stored per record |
| **Better than a global mosaic** | 8-30 cm official orthophotos where they exist, Sentinel-2 elsewhere |
| **MIT code, open data** | no API key, no tile quota, no terms-of-service trap; licence and attribution carried per layer |
| **Any map library** | MapLibre GL, Leaflet and OpenLayers adapters, plus a plain `(x, y, z) => url` builder |
| **Protocol-correct** | WMS 1.1.1 and 1.3.0 axis order, CRS normalisation, WMTS KVP/REST, GetFeatureInfo, WFS |
| **Handles awkward services** | renders WMS endpoints that do not publish EPSG:3857, such as the Italian cadastre |

- [Catalogue of every layer](docs/CATALOG.md)
- [Integration recipes](docs/INTEGRATION.md) - MapLibre, Leaflet, OpenLayers, React, Node, QGIS
- [Concepts](docs/CONCEPTS.md) - axis order, CRS, reprojection, CORS, licensing
- [Contributing a layer](CONTRIBUTING.md)

## Replace a proprietary basemap in three lines

```ts
import { bestOrthophotoFor } from "@orthogea/catalog";
import { toRasterSource } from "@orthogea/client";

const layer = bestOrthophotoFor(11.2558, 43.7696)!;   // Ortofoto Toscana, 2013
map.addSource("imagery", toRasterSource(layer));      // MapLibre raster source, attribution included
```

`bestOrthophotoFor()` returns the most local official orthophoto covering the coordinate and
falls back to the pan-European Sentinel-2 cloudless mosaic where no national source is
catalogued, so a single call always yields a usable imagery layer.

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

The Tuscan orthophoto with the Italian cadastre on top, both from official services, with a
click returning the real INSPIRE parcel identifier:

- layer switcher over the whole catalogue, grouped into base layers and overlays;
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
publish only geodetic CRS. The Agenzia delle Entrate cadastre advertises `EPSG:6706`,
`EPSG:4258` and the ETRS89 TM zones, and answers `InvalidFormat` for `EPSG:3857`.

`toRasterSource()` detects this and emits an `orthogea://` tile template; the protocol handler
converts each tile index into a geographic extent and issues the `GetMap` in a CRS the service
does support. Leaflet gets the same treatment through `createTileUrlBuilder()`.

```ts
registerOrthoGeaProtocol(maplibregl, { layers, proxyUrl });
toRasterSource(layer).tiles; // ["orthogea://it.ade.catasto-particelle/{z}/{x}/{y}"]
```

`GetFeatureInfo` uses the same fallback, switching to a geographic window centred exactly on the
click.

### 3. CORS

Most geoportals answer without `Access-Control-Allow-Origin`. Every adapter accepts a
`proxyUrl`, in prefix (`https://proxy/`), parameter (`https://proxy/?url=`) or template
(`https://proxy/?target={url}`) form, and keeps renderer placeholders literal so the map library
can still substitute them. The demo ships a dev-only proxy restricted to catalogue hosts; see
[docs/CONCEPTS.md](docs/CONCEPTS.md#cors) for a production one.

## Catalogue coverage

| Scope | Layers |
| --- | --- |
| Pan-European | Copernicus Data Space Sentinel-2 L2A (free instance id required), Sentinel-2 cloudless 2024, Terrain Light, CORINE Land Cover 2018, EU-DEM |
| Italy - national | Agenzia delle Entrate cadastre (parcels, zoning, full drawing), national orthophoto 2012 |
| Italy - regional | Piemonte, Lombardia, Bolzano, Veneto (WMS + WMTS), Friuli-Venezia Giulia, Emilia-Romagna (RER and AGEA), Toscana, Umbria, Marche, Lazio, Abruzzo, Puglia, Sicilia, Sardegna |
| Rest of Europe | Spain (PNOA, MTN, Catastro parcels and buildings), France (BD ORTHO WMS and WMTS, Parcellaire Express), Germany (basemap.de, Sen2Europe), Netherlands, Belgium (Flanders, Wallonia), Portugal, Switzerland, Austria, Poland, Czechia, Slovakia, Slovenia, Croatia, Greece, Estonia, Denmark, Sweden |

The full table lives in [docs/CATALOG.md](docs/CATALOG.md). Every record is checked end to end -
capabilities **and** one real tile per layer - with:

```bash
pnpm --filter @orthogea/catalog verify
```

At the last run, 47 of 49 layers returned real imagery. The other two are marked
`status: "experimental"` because they need credentials: the Copernicus Data Space service wants
an OGC instance id, the Danish Dataforsyningen service wants a token.

Regions still missing a verified endpoint: Valle d'Aosta, Trento, Liguria, Molise, Campania and
Calabria - their portals returned 404, 502 or no OGC service during the survey. See
[CONTRIBUTING.md](CONTRIBUTING.md) to add one.

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

[MIT](LICENSE) for the framework. The data behind each catalogued endpoint keeps its own
licence, recorded in the `license` field of every record and rendered in the map attribution -
most of them require visible credit. Read
[docs/CONCEPTS.md](docs/CONCEPTS.md#licensing-and-attribution) before publishing a map.

# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the packages share one version
number.

## [0.3.2] - 2026-08-24

### Fixed

- `LICENSE` now holds the SPDX MIT text and nothing else, so GitHub recognises the licence
  instead of reporting "Other". The note about the data licences moved to `NOTICE.md`.

### Added

- `NOTICE.md`: what the MIT licence covers, what it does not, and the attribution each catalogued
  provider expects.
- A copy of `LICENSE` ships inside every published package.

## [0.3.1] - 2026-08-24

### Fixed

- **The orthophoto no longer drops back to the base at deep zoom.** A service that has drawn a
  tile is remembered as covering that area, so its later tiles are trusted even when they are
  tiny - a uniform roof at zoom 19 compresses to a few hundred bytes, which the empty-tile guard
  used to mistake for a hole.

### Added

- `toMosaicRasterLayer()`: a style layer with an opacity ramp over zoom, so the orthophotos
  **fade in** over the Copernicus base instead of replacing it in one step.
- A mosaic without a fallback answers uncovered tiles with a transparent image rather than an
  error, which is what lets it sit on top of a base layer. Disable with
  `transparentWhenUncovered: false`.

### Removed

- **All cadastre layers** - Agenzia delle Entrate (parcels, zoning, full drawing), Spanish
  Catastro (parcels, buildings) and the French Parcellaire Express.

### Changed

- The demo draws the Copernicus base and an orthophoto-only mosaic above it, fading in between
  zoom 13.5 and 15.5, and keeps its source label and credits in step with what is on screen.

## [0.3.0] - 2026-08-24

### Changed

- **One European base.** The imagery architecture is now two tiers instead of four: Copernicus
  VHR 2021 (about 2 m) draws the whole continent at every zoom, and the official orthophoto of
  the area takes over from zoom 15, where 2 m starts to show. Fewer services in play means fewer
  requests, no low-zoom patchwork and a noticeably quicker map.
- **Cached services win.** Among sources covering the same ground, a WMTS or XYZ tile service is
  preferred over a WMS, because pre-rendered tiles answer in milliseconds.
- `DEFAULT_SATELLITE_FALLBACK_ID` points at `eu.copernicus.vhr-2021`.
- `DEFAULT_ORTHOPHOTO_FROM_ZOOM` moved from 12 to 15.

### Removed

- The redundant background mosaics: Copernicus HR Image Mosaic, Copernicus Data Space Sentinel-2
  L2A (instance id required), Sentinel-2 cloudless and Terrain Light by EOX, BKG Sen2Europe, and
  the Geoportale Nazionale (MASE) orthophotos, whose raster backend was intermittent.

## [0.2.1] - 2026-08-24

### Fixed

- **Imagery vanished when zoomed right in.** `toRasterLayer()` copied the record's `maxZoom`
  onto the style layer, where MapLibre reads it as "hide the layer from this zoom". The limit now
  lives on the source only, which makes MapLibre upscale instead of hiding.
- **Imagery blinked away when an overlay was toggled.** The demo rebuilt every source on each
  change, throwing away the tiles it had. It now applies only the difference.
- The Veneto WMTS is served from a pre-rendered PNG cache and cannot answer in JPEG; only WMS
  records were switched to JPEG.

### Added

- **Copernicus VHR 2021** (about 2 m, EEA) as the tier between national orthophotos and
  Sentinel-2: regions with no aerial imagery - Liguria, Valle d'Aosta, Molise, Campania,
  Calabria - now show 2 m satellite imagery at street level instead of 10 m.
- **Copernicus HR Image Mosaic** (Sentinel-2, EEA) is the new default fallback, so the whole
  default chain is official Copernicus material. The EOX mosaic stays catalogued as an
  alternative.
- Browser tile caching (Cache Storage), empty-area memory per 4x4 tile block, and a per-tile
  timeout, so the map stays usable on a thin connection.

### Changed

- Imagery records request `image/jpeg`: 5-10x smaller tiles (Sicilia 194 kB to 26 kB).
- The mosaic requests 512 px tiles and stops at zoom 19: a quarter of the round trips, a quarter
  of the provider watermarks on screen, and no new requests when zooming deeper.
- Attribution is compact in the map control and lists only the sources drawn in the last few
  seconds.

## [0.2.0] - 2026-08-24

### Added

- **Seamless imagery mosaic** (`@orthogea/client`): one virtual raster layer that picks, per
  tile, the best official source covering it - the Copernicus Sentinel-2 mosaic below zoom 12,
  the most local orthophoto above it, the satellite again wherever no orthophoto exists. Ranks
  candidates by extent, then resolution, then vintage; drops imagery from another country; skips
  sources that fail, time out or answer with a blank image; credits only the providers actually
  drawn. Registered on MapLibre with `registerMosaicProtocol()`.
- Framework-agnostic `createTileUrlBuilder()` and a Leaflet adapter (`toLeafletSource()`), so the
  catalogue drops into any renderer.
- `bestOrthophotoFor()` and `imageryStackFor()` in `@orthogea/catalog`.
- `verify:mosaic` script: walks places and zoom levels against the real services and prints the
  source chosen for each tile.
- New regional layers: Provincia autonoma di Trento (2015) and Basilicata (2013).
- The national orthophoto is now catalogued per UTM zone, so southern Italy is covered too.

### Changed

- Italian regional imagery updated to the most recent published flights: Toscana 2013 to
  **2024/2025**, Sicilia 2013 to **2022**, Lombardia 2021 to **2024**.
- Spain PNOA now requests `OI.OrthoimageCoverage`; `OI.MosaicElement` is the flight index, not
  the imagery.
- Duplicated coverage is resolved with an `alternative` tag (Veneto WMS behind its cached WMTS,
  the Emilia-Romagna AGEA mosaic behind the regional flight), which the mosaic skips.
- `pickReprojectionCrs()` honours the CRS order declared in the record, so a service that
  advertises a CRS it cannot actually draw (Basilicata with `CRS:84`) can be corrected in data.
- The demo opens on the seamless mosaic and refreshes its attribution as the sources change.

### Fixed

- Tile placeholders (`{bbox-epsg-3857}`, `{z}`, `{x}`, `{y}`) survive percent-encoding when a
  CORS proxy is used, so proxied templates render.
- Query values keep literal `:` and `,`, which several national services require.

## [0.1.0] - 2026-08-23

First release: the whole harvest -> catalogue -> render pipeline, verified against live European
services.

### `@orthogea/core`

- Zod schemas and types for layers, collections and the five service bindings (WMS, WMTS, XYZ,
  WFS, COG), with strict validation, defaults and CRS normalisation on parse.
- CRS registry covering the codes European geoportals actually publish, with URN/URL/short-form
  parsing, equivalence groups (`EPSG:3857` = `EPSG:900913` = `EPSG:102100`) and runtime
  registration.
- Axis-order rules for WMS 1.1.1 vs 1.3.0, WMTS and WFS 2.0, plus `formatBBox`/`parseBBox`.
- Bounding-box algebra, antimeridian-aware containment, Web Mercator projection and tile maths.
- NUTS helpers (levels, ancestors, ISO mapping) and typed errors.

### `@orthogea/harvester`

- WMS 1.1.0/1.1.1/1.3.0 capabilities parser with full layer inheritance, `ScaleHint`
  conversion, dimension merging and namespace-independent reading.
- WMTS 1.0.0 parser including tile matrix sets, REST resource templates and dimensions.
- Endpoint health checks with timeout, proxy support and bounded concurrency.
- Conversion of harvested layers into validated catalogue records.

### `@orthogea/client`

- MapLibre GL adapter: raster sources, style layers, complete style documents.
- Leaflet and OpenLayers adapters, plus a framework-agnostic `(x, y, z) => url` tile builder.
- `orthogea://` protocol that renders WMS services without EPSG:3857 by reprojecting the tile
  extent, supporting both the MapLibre 3 callback and the MapLibre 4/5 promise signatures.
- GetFeatureInfo engine: viewport or synthetic window, `I`/`J` vs `X`/`Y`, geographic fallback,
  and parsing of GeoJSON, GML, `msGMLOutput`, HTML tables and plain text.
- WFS `GetFeature` URL builder and licence-aware attribution formatting.

### `@orthogea/catalog`

- 49 layers from 19 scopes, grouped by NUTS-0 and indexed to NUTS-2/3, every endpoint probed
  live on 2026-08-23.
- Query API (country, NUTS, category, service, tags, text, point, bbox, zoom, queryable), NUTS
  tree, grouping and statistics.
- `bestOrthophotoFor()` and `imageryStackFor()` for replacing a proprietary satellite basemap.
- Runtime registration of external collections, JSON Schema generation, documentation
  generation, and a `verify` script that renders one real tile per layer.

### `apps/demo`

- MapLibre GL single-page app with layer switcher, NUTS "jump to", opacity, click-to-query,
  attribution panel and an allowlisted dev CORS proxy.

### Known limitations

- The Copernicus Data Space and Danish Dataforsyningen records need credentials and are marked
  `status: "experimental"`.
- Valle d'Aosta, Trento, Liguria, Molise, Campania and Calabria have no verified endpoint yet.
- Layer coverage is modelled as a bounding box, so ranking by locality can prefer a neighbouring
  region near a border.

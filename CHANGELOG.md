# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the packages share one version
number.

## [0.2.0] - 2026-08-24

> Versions 0.2.0 through 0.5.1 appeared in earlier drafts of this file while the packages were
> still unpublished at 0.1.0. They were never released, so the work they described ships here.

### Added

- **No-data fills are made transparent instead of drawn.** A service asked for a tile that
  straddles the edge of its coverage answers with the whole rectangle and fills the uncovered part
  with flat white or black; JPEG has no alpha, so that fill was painted over the Copernicus base.
  Measured along the Tuscan shoreline: **23 of 49 tiles** carried a fill, 15 of them covering the
  tile almost entirely. The fill is now found by flooding inwards from the tile border - a flat
  region that does not reach the edge, such as a car park or a snowfield, is never touched - and
  the tile is either dropped or repaired as a PNG with the fill transparent. After: **0 of 49**.
  Inland and over the Venetian lagoon, nothing changed in either direction. Detection runs on a
  64 px thumbnail and costs about 5 ms a tile; `trimCollars: false` turns it off.
- **Stitching runs in a worker.** Recombining a 256 px tile cache into one 512 px tile costs four
  decodes, a canvas composite and a re-encode - measured at **68 ms per tile**, four dropped frames
  each. It now happens off the main thread: four tiles measured **199 ms of main-thread stall
  inline - 50 ms a tile, longest single stall 43 ms - and 0 ms through the worker**. The main
  thread only computes the four URLs, which takes microseconds. Where a worker is unavailable - a strict `worker-src` policy, Node - the same code
  runs inline, and `createStitcher()` is exported for hosts that want their own.
- **Requests carry a priority.** A tile on screen is fetched at `high`, a warmed one at `low`, so
  speculative traffic can never take bandwidth from what the reader is looking at.
- **Prefetching follows the direction of travel.** `Mosaic.prefetchAhead(x, y, z, headingX,
  headingY)` warms the leading edge instead of the whole ring - three quarters of which, mid-pan,
  is ground already passed - and reaches further along it. The demo reads the heading from where
  the map has been between stops, and falls back to the ring when it is still.
- `Mosaic.dispose()` releases the worker; `Mosaic.inFlightTiles` lists what is loading.
- `createTileWorker()` is exported, for hosts that want to run the pixel work themselves.
- `stitchTiles` on `createMosaic()`, and `?stitch=0`, `?prefetch=0`, `?zoomlimit=0` in the demo,
  so a rendering problem can be bisected in a browser without a rebuild.
- **The zoom stops where the imagery does.** Half of Europe publishes no open orthophoto, and
  there the map sits on the 2 m European base: zooming to 20 over Sofia or Hamburg only enlarges
  pixels. `Mosaic.detailZoomAt(lng, lat)` answers with the deepest zoom the imagery under a point
  actually supports - from its resolution and the latitude, because Mercator stretches - and
  `bindDetailZoomLimit(map, mosaics)` holds the map there, lifting the ceiling again over
  better-surveyed ground. It learns as it draws: a service whose rectangle covers ground it has
  no imagery for stops raising the limit once it has answered blank.
- `metersPerPixelAt()` and `zoomForResolutionAt()` in `@orthogea/core`: ground resolution and its
  inverse, corrected for latitude.
- `pnpm size`: the integration weight, measured rather than asserted.
- **Germany, at last.** There is no open national orthophoto - the BKG service needs registration
  and the survey is a state responsibility - so the catalogue now carries the **13 state services
  that publish theirs as open data**: Bavaria, North Rhine-Westphalia, Lower Saxony,
  Baden-Wuerttemberg, Hesse, Rhineland-Palatinate, Brandenburg (with Berlin), Saxony,
  Saxony-Anhalt, Thuringia, Schleswig-Holstein, Mecklenburg-Vorpommern and Saarland. Fourteen of
  the sixteen Laender are covered at 10-40 cm; Hamburg and Bremen publish nothing open, and the
  European base keeps showing there.
- **Luxembourg**: the ACT national orthophoto, summer 2025 flight, 10 cm.
- `Mosaic.prefetch()` and `Mosaic.prefetchAround()`: warm the tiles just outside the viewport
  while the map is still, so a pan starts from cache instead of a round trip. The demo calls them
  on `idle`, and skips them on a metered or 2G connection.
- Concurrent requests for the same tile now share one download, and the request is dropped only
  once every caller has walked away.
- `cacheLimit` (default 1500 tiles): Cache Storage never evicts on its own, so the oldest entries
  are trimmed in batches instead of letting the browser drop the whole origin at once.
- The demo serves the Copernicus base through the mosaic as well, so it inherits Cache Storage,
  shared downloads and prefetching, and stops requesting tiles past the resolution of its own 2 m
  data.
- `NOTICE.md`: what the MIT licence covers, what it does not, and the attribution each catalogued
  provider expects.
- A copy of `LICENSE` ships inside every published package.
- `toMosaicRasterLayer()`: a style layer with an opacity ramp over zoom, so the orthophotos
  **fade in** over the Copernicus base instead of replacing it in one step.
- A mosaic without a fallback answers uncovered tiles with a transparent image rather than an
  error, which is what lets it sit on top of a base layer. Disable with
  `transparentWhenUncovered: false`.
- **Copernicus VHR 2021** (about 2 m, EEA) as the tier between national orthophotos and
  Sentinel-2: regions with no aerial imagery - Liguria, Valle d'Aosta, Molise, Campania,
  Calabria - now show 2 m satellite imagery at street level instead of 10 m.
- **Copernicus HR Image Mosaic** (Sentinel-2, EEA) is the new default fallback, so the whole
  default chain is official Copernicus material. The EOX mosaic stays catalogued as an
  alternative.
- Browser tile caching (Cache Storage), empty-area memory per 4x4 tile block, and a per-tile
  timeout, so the map stays usable on a thin connection.
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

- **The runtime is now free of third-party code.** Drawing a map used to pull in Zod (54 kB) and
  an XML parser (32 kB) - 77 % of the bundle - for validation and feature queries it never ran.
  Both now live behind their own entry points, and the bundled catalogue is validated and
  normalised at **build** time instead of on every page load:

  | import | before | after |
  | --- | --- | --- |
  | `@orthogea/core` | 18.4 kB gz | **2.4 kB gz** |
  | `toRasterSource` | 31.4 kB gz | **4.4 kB gz** |
  | the mosaic | 34.9 kB gz | **11.3 kB gz** |
  | the whole basemap | 46.5 kB gz | **22.3 kB gz** |
- The demo draws the Copernicus base and an orthophoto-only mosaic above it, fading in between
  zoom 13.5 and 15.5, and keeps its source label and credits in step with what is on screen.
- **One European base.** The imagery architecture is now two tiers instead of four: Copernicus
  VHR 2021 (about 2 m) draws the whole continent at every zoom, and the official orthophoto of
  the area takes over from zoom 15, where 2 m starts to show. Fewer services in play means fewer
  requests, no low-zoom patchwork and a noticeably quicker map.
- **Cached services win.** Among sources covering the same ground, a WMTS or XYZ tile service is
  preferred over a WMS, because pre-rendered tiles answer in milliseconds.
- `DEFAULT_SATELLITE_FALLBACK_ID` points at `eu.copernicus.vhr-2021`.
- `DEFAULT_ORTHOPHOTO_FROM_ZOOM` moved from 12 to 15.
- Imagery records request `image/jpeg`: 5-10x smaller tiles (Sicilia 194 kB to 26 kB).
- The mosaic requests 512 px tiles and stops at zoom 19: a quarter of the round trips, a quarter
  of the provider watermarks on screen, and no new requests when zooming deeper.
- Attribution is compact in the map control and lists only the sources drawn in the last few
  seconds.
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

- **Holes are drawn as a full 512x512 transparent tile**, not a single pixel stretched over the
  quad, and they are returned with `cache-control: no-store` - a hole is a fact about this moment,
  not about the ground, so the area is asked for again on the next pass instead of staying empty
  for the rest of the session.
- **Emilia-Romagna drew nothing at all.** `servizigis.regione.emilia-romagna.it/wms/rer2023_24_rgb`
  answers with an empty 4.8 kB image at every zoom, in every format, everywhere - Bologna and
  Ferrara included. Its rectangle covers most of northern Italy and it outranked its neighbours
  on locality, so every tile in that area paid a wasted round trip before falling through. The
  working AGEA 2023 service was already in the catalogue, tagged `alternative` behind the broken
  one; it is now the Emilia-Romagna record and the dead endpoint is gone.
- **One dropped child request no longer blacklists a whole region.** Stitching a 256 px tile cache
  makes four requests per tile, so four chances of a dropped connection. A rejection propagated
  out of the stitch and was read as a failing service, taking the layer off the map for a minute -
  which is what a hole in fully covered ground looks like.
- **Stitched tiles keep the format the service used.** A PNG tile cache was being re-encoded as
  JPEG, a lossy round trip for no gain.
- **Callers no longer share one tile buffer.** The renderer and the idle prefetcher could receive
  the same `ArrayBuffer`; an image decoder that transfers it would leave the other holding a
  detached buffer, and a tile that never draws.
- **Germany no longer washes out at detail zoom.** Coverage is modelled as a rectangle, and
  rectangles cross borders: Austria's reaches Munich, France's reaches Frankfurt. Asked for
  ground they do not hold, both services answer with a uniform white image rather than an error,
  and the mosaic painted it because a single candidate was accepted unconditionally. A mosaic
  that can draw a transparent hole now always prefers the hole, so the European base shows
  through instead.
- **Tile caches are no longer drawn at half resolution.** A pre-rendered cache has a fixed 256 px
  grid; asked for the level a 512 px mosaic wants, it answered with an image the renderer then
  stretched, leaving basemap.at, IGN, Veneto and Estonia a full zoom level behind. Their four
  children are now fetched in parallel and stitched into one tile.
- **A 404 is read as a gap in coverage, not as a broken service.** basemap.at answers 404 over
  Munich, which used to blacklist it - and with it the whole of Austria - for the next minute.
- **A neighbour's rectangle no longer hides a country's own imagery.** Foreign candidates are
  moved to the back of the chain instead of being dropped from it, so where the closer authority
  answers blank the map falls through to the right service rather than to a hole. North
  Rhine-Westphalia's rectangle reaches Venlo, Bavaria's reaches Salzburg.
- `LICENSE` now holds the SPDX MIT text and nothing else, so GitHub recognises the licence
  instead of reporting "Other". The note about the data licences moved to `NOTICE.md`.
- **The orthophoto no longer drops back to the base at deep zoom.** A service that has drawn a
  tile is remembered as covering that area, so its later tiles are trusted even when they are
  tiny - a uniform roof at zoom 19 compresses to a few hundred bytes, which the empty-tile guard
  used to mistake for a hole.
- **Imagery vanished when zoomed right in.** `toRasterLayer()` copied the record's `maxZoom`
  onto the style layer, where MapLibre reads it as "hide the layer from this zoom". The limit now
  lives on the source only, which makes MapLibre upscale instead of hiding.
- **Imagery blinked away when an overlay was toggled.** The demo rebuilt every source on each
  change, throwing away the tiles it had. It now applies only the difference.
- The Veneto WMTS is served from a pre-rendered PNG cache and cannot answer in JPEG; only WMS
  records were switched to JPEG.
- Tile placeholders (`{bbox-epsg-3857}`, `{z}`, `{x}`, `{y}`) survive percent-encoding when a
  CORS proxy is used, so proxied templates render.
- Query values keep literal `:` and `,`, which several national services require.

### Breaking

- The Zod schemas moved from `@orthogea/core` to **`@orthogea/core/schemas`**. The types they
  produce - `OrthoGeaLayer`, `Service`, `LayerCollection` and the rest - stay on the root entry,
  because types are erased and cost nothing.
- `getFeatureInfo` and the response parsers moved to **`@orthogea/client/featureinfo`**.
- `safeBuildCatalog`, `buildCatalog` and `registerCollection` moved to
  **`@orthogea/catalog/validate`**. Reading the bundled catalogue needs none of them.
- `CountryCodeSchema` and `NutsCodeSchema` moved to `@orthogea/core/schemas`; `isValidNutsCode()`
  is unchanged and no longer needs Zod.

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

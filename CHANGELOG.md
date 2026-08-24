# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the packages share one version
number.

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

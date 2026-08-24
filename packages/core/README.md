# @orthogea/core

Shared vocabulary of [OrthoGea - Europe](../../README.md): Zod schemas, TypeScript types, CRS
normalisation, bounding-box maths and NUTS helpers. **No I/O happens here**, which makes the
package safe to import from a browser, a worker, Node or an edge runtime.

```bash
pnpm add @orthogea/core
```

## Schemas and types

```ts
import { OrthoGeaLayerSchema, type OrthoGeaLayer } from "@orthogea/core";

const layer: OrthoGeaLayer = OrthoGeaLayerSchema.parse(json);
```

`OrthoGeaLayerSchema` is strict: unknown keys are rejected, defaults are filled in, CRS strings
are normalised, the NUTS code must belong to the declared country and the zoom range must be
ordered. `service` is a discriminated union (`WMS`, `WMTS`, `XYZ`, `WFS`, `COG`), so narrowing
on `layer.service.type` gives the right options object.

Also exported: `LayerCollectionSchema`, `WMSOptionsSchema`, `WMTSOptionsSchema`,
`XYZOptionsSchema`, `WFSOptionsSchema`, `COGOptionsSchema`, `LicenseSchema`, `ProviderSchema`,
`GeoBoundingBoxSchema`, plus the matching types and the `isWmsLayer` / `isQueryableLayer` type
guards.

## CRS

```ts
normalizeCrs("urn:ogc:def:crs:EPSG::3857"); // "EPSG:3857"
normalizeCrs("EPSG:900913");                // "EPSG:3857"
normalizeCrs("urn:ogc:def:crs:OGC:1.3:CRS84"); // "CRS:84"

isSameCrs("EPSG:3857", "EPSG:102100");      // true
isGeographicCrs("EPSG:6706");               // true
getCrsDefinition("EPSG:3003")?.name;        // "Monte Mario / Italy zone 1"
registerCrs({ code: "EPSG:2056", /* ... */ });
```

## Axis order and bounding boxes

```ts
getAxisOrder("EPSG:4326");          // "latlon"  (WMS 1.3.0, WMTS, WFS 2.0)
getAxisOrder("EPSG:4326", "1.1.1"); // "lonlat"

formatBBox(bbox, { crs: "EPSG:4326", wmsVersion: "1.3.0" }); // "42.23,9.68,44.47,12.37"
parseBBox(wire, { crs: "EPSG:4326", wmsVersion: "1.3.0" });  // back to [minLng, minLat, ...]
orderBBoxForCrs(bbox, "EPSG:3035");                          // northing first
```

Boxes are always `[minLng, minLat, maxLng, maxLat]` in WGS84 degrees, GeoJSON order. The module
adds `bboxContainsPoint` (antimeridian aware), `bboxContainsBBox`, `bboxIntersects`,
`bboxIntersection`, `bboxUnion`, `bboxCenter`, `bboxAreaSqKm`, `expandBBox`, `clampBBox`,
`bboxFromPositions`, `bboxToPolygon` and `normalizeBBox`.

## Web Mercator and tiles

```ts
lngLatToMercator(11.2558, 43.7696);  // [1252993.2, 5429856.2]
mercatorToLngLat(x, y);
bboxToMercator(bbox);
metersPerPixel(18);                  // 0.5972
zoomFromMetersPerPixel(0.5972);      // 18
lngLatToTile(11.2558, 43.7696, 14);  // [8746, 6015]
tileToBBox(8746, 6015, 14);          // WGS84 extent of that tile
tileToMercatorBBox(8746, 6015, 14);  // EPSG:3857 extent
```

The projection uses `atanh(sin φ)` rather than `log(tan(π/4 + φ/2))`, so the origin comes out
exactly zero and round-trips are stable to nine decimals.

## URLs

```ts
buildQueryUrl(base, { SERVICE: "WMS", CRS: "EPSG:3857" }, { rawParams: { BBOX: "{bbox-epsg-3857}" } });
applyCorsProxy(url, "https://proxy/?url=");   // keeps {bbox-epsg-3857} literal
encodeQueryValue("EPSG:3857");                // "EPSG:3857", colons and commas stay readable
```

## NUTS

```ts
nutsLevel("ITI1");             // 2
nutsParent("ITI14");           // "ITI1"
nutsAncestors("ITI14");        // ["ITI1", "ITI", "IT"]
isNutsWithin("ITI14", "IT");   // true
nutsToIso("EL");               // "GR"
isoToNuts("GB");               // "UK"
nutsCountryName("ESC1");       // "Spain"
```

## Coverage helpers

```ts
layerCoversPoint(layer, 11.2558, 43.7696);
isLayerVisibleAtZoom(layer, 15);
rankLayersForPoint(layers, { lng, lat, zoom, category: "orthophoto" }); // most local first
```

## Errors

`OrthoGeaError` and its subclasses `CapabilitiesParseError`, `ServiceExceptionError`,
`UnsupportedServiceError` and `EndpointUnavailableError`, each with a stable `code`, so callers
can branch without string matching.

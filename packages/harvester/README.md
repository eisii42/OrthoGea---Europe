# @orthogea/harvester

Reads what European OGC endpoints advertise: `GetCapabilities` parsers for WMS 1.1.0/1.1.1/1.3.0
and WMTS 1.0.0, endpoint health checks, and conversion of harvested layers into catalogue
records for [OrthoGea - Europe](../../README.md).

```bash
pnpm add @orthogea/harvester
```

## Parsing a capabilities document

```ts
import { parseWmsCapabilities, findLayer } from "@orthogea/harvester";

const capabilities = parseWmsCapabilities(xml, { endpointUrl: "https://example.org/wms" });

capabilities.version;                 // "1.3.0" | "1.1.1" | "1.1.0"
capabilities.service.title;
capabilities.operations.getMap?.formats;
capabilities.layers;                  // every requestable (named) layer, depth first
capabilities.rootLayer;               // the tree, including grouping layers

const layer = findLayer(capabilities, "CP.CadastralParcel");
layer?.crs;              // normalised, inherited entries included
layer?.bbox;             // [minLng, minLat, maxLng, maxLat], axis order resolved
layer?.queryable;
layer?.styles;
layer?.minScaleDenominator;
layer?.dimensions;       // 1.3.0 <Dimension> and 1.1.1 <Dimension> + <Extent> merged
layer?.metadataUrls;
layer?.path;             // titles of the ancestors, for a tree view
```

What the parser takes care of:

- **version differences**: `WMT_MS_Capabilities` vs `WMS_Capabilities`, `SRS` lists separated by
  whitespace, `LatLonBoundingBox` vs `EX_GeographicBoundingBox`, `ScaleHint` converted into
  scale denominators, `Extent` merged into `Dimension`;
- **axis order**: in 1.3.0 a `<BoundingBox CRS="EPSG:6706" minx="35.4" .../>` has a latitude in
  `minx`; every box is kept both `raw` (as written) and `bbox` (normalised to x/y);
- **inheritance**: CRS lists and styles accumulate, bounding boxes and dimensions are replaced
  per CRS/name, `queryable`, `opaque`, `cascaded`, `Attribution` and the scale range fall back
  to the parent;
- **namespaces**: `wms:Layer`, `ows:Title` and `xlink:href` are read whatever the prefix;
- **errors**: a `ServiceExceptionReport` becomes a `ServiceExceptionError`, anything else
  malformed a `CapabilitiesParseError`;
- **size**: multi-megabyte documents with tens of thousands of XML entities parse (the
  entity-expansion limits are raised while the depth limit stays capped).

WMTS works the same way:

```ts
import { parseWmtsCapabilities, findWmtsLayer } from "@orthogea/harvester";

const wmts = parseWmtsCapabilities(xml);
wmts.tileMatrixSets["GoogleMapsCompatible"].crs;    // "EPSG:3857"
findWmtsLayer(wmts, "TRUE_COLOR")?.resourceUrls;    // RESTful templates
```

## Fetching and checking endpoints

```ts
import { harvestWms, harvestWmts, checkEndpoint, checkEndpoints } from "@orthogea/harvester";

const capabilities = await harvestWms("https://example.org/wms");

const health = await checkEndpoint("https://example.org/wms", { service: "WMS", timeoutMs: 10000 });
// { ok, status, responseTimeMs, version, title, layerCount, queryableLayerCount, checkedAt }

const report = await checkEndpoints(urls, { concurrency: 4 });
```

`checkEndpoint` never throws: transport and parse failures come back as `ok: false` with an
`errorCode`, so a whole catalogue can be swept in one pass - useful in CI. All functions accept
`fetchImpl`, `headers`, `signal` and `proxyUrl`.

## URL helpers

```ts
buildCapabilitiesUrl("https://example.org/wms?map=ortho");
// https://example.org/wms?map=ortho&SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0

toBaseServiceUrl("https://example.org/wms?SERVICE=WMS&REQUEST=GetCapabilities&map=ortho");
// https://example.org/wms?map=ortho
```

Vendor parameters are preserved and existing `SERVICE`/`REQUEST`/`VERSION` keys are replaced
whatever their casing.

## Turning a discovery into a catalogue record

```ts
import { wmsLayerToOrthoGea, buildLayerId } from "@orthogea/harvester";

const record = wmsLayerToOrthoGea(capabilities, parsedLayer, {
  id: buildLayerId("IT", "Toscana", "Ortofoto 2013"),  // "it.toscana.ortofoto-2013"
  category: "orthophoto",
  country: "IT",
  nuts: "ITI1",
  regionName: "Toscana",
  provider: { name: "Regione Toscana" },
  license: { id: "CC-BY-4.0" },
  preferredFormats: ["image/jpeg"],
  overrides: { maxZoom: 19 }
});
```

The result is validated by `OrthoGeaLayerSchema`, with the CRS list ordered (Web Mercator first),
the best available format picked, transparency set from the category and the GetFeatureInfo
formats copied from the service. `wmtsLayerToOrthoGea` does the same for WMTS, choosing the
Web Mercator tile matrix set when the layer offers one.

## XML helpers

`parseXml`, `children`, `child`, `childText`, `attr`, `numAttr`, `text`, `splitList`,
`onlineResourceHref` and `asArray` are exported for parsing vendor extensions the framework does
not model yet.

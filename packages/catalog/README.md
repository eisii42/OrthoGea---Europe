# @orthogea/catalog

A validated registry of European open geodata services for
[OrthoGea - Europe](../../README.md): 51 layers from 19 scopes, indexed from NUTS-0 down to
NUTS-2/3, every endpoint probed live. Italy is covered region by region: 16 of the 21 regions
and autonomous provinces publish an orthophoto service, all of them the most recent flight the
provider exposes.

```bash
pnpm add @orthogea/catalog
```

See [docs/CATALOG.md](../../docs/CATALOG.md) for the full table.

## Picking imagery

```ts
import { bestOrthophotoFor, imageryStackFor } from "@orthogea/catalog";

bestOrthophotoFor(11.2558, 43.7696);   // Ortofoto 2013 - Toscana
bestOrthophotoFor(2.35, 48.85);        // BD ORTHO 50 cm - France
bestOrthophotoFor(-30, 64);            // Copernicus VHR 2021 (the European base)

imageryStackFor(11.2558, 43.7696);     // local -> national -> pan-European
```

That is the replacement for a proprietary satellite basemap: the most local official orthophoto
covering the point, with the key-free Copernicus base behind it.

## Querying

```ts
import { catalog, findLayers, getLayer, layersForPoint } from "@orthogea/catalog";

getLayer("it.toscana.ortofoto-2024");
findLayers({ country: "ES", category: "orthophoto" });
findLayers({ nuts: "ITI" });                    // a NUTS-1 region and everything below it
findLayers({ service: "WMTS", queryable: true });
findLayers({ text: "sentinel" });
findLayers({ bbox: [11, 43, 12, 44], zoom: 15 });
layersForPoint(11.2558, 43.7696, { category: "orthophoto" });   // most local first
```

Criteria are optional and combine with AND: `country`, `nuts`, `category`, `service`, `status`,
`tags`, `text`, `point`, `bbox`, `queryable`, `zoom`.

## Browsing

```ts
import { buildNutsTree, flattenTree, groupByCountry, catalogStats } from "@orthogea/catalog";

const tree = buildNutsTree();      // Europe -> Italy -> Centro -> Toscana, with layer counts
flattenTree(tree);                 // [{ code, label, depth, layerCount }, ...]
groupByCountry().get("IT");
catalogStats();                    // { layers, countries, byCategory, byService, lastVerified }
```

## Extending

```ts
import { registerCollection, safeBuildCatalog } from "@orthogea/catalog/validate";

registerCollection(myDocument, "my-layers.json");   // validated, then appended
safeBuildCatalog({ "my-layers.json": myDocument }); // validate without registering
```

Invalid documents are reported as `issues`, never thrown, so one typo in a community collection
cannot break a portal.

## The data

`data/*.json`, one file per NUTS-0 scope plus `it-regions.json`, is the source of truth. Each
document is a `LayerCollection`:

```jsonc
{
  "$schema": "../schema/layer-collection.schema.json",
  "scope": "IT",
  "title": "Italy - national services",
  "updated": "2026-08-23",
  "layers": [ /* OrthoGeaLayer records */ ]
}
```

The JSON Schema gives editors autocompletion and validation. Regenerate it with
`pnpm --filter @orthogea/catalog schema` after changing the Zod schema in `@orthogea/core`.

## Scripts

```bash
pnpm --filter @orthogea/catalog verify              # GetCapabilities + one real tile per layer
pnpm --filter @orthogea/catalog verify --id it.ade  # only matching ids
pnpm --filter @orthogea/catalog verify --strict     # exit 1 when an active layer fails (CI)
pnpm --filter @orthogea/catalog verify --json report.json
pnpm --filter @orthogea/catalog verify:mosaic       # the seamless mosaic, zoom by zoom
pnpm --filter @orthogea/catalog schema              # regenerate the JSON Schema
pnpm --filter @orthogea/catalog docs                # regenerate docs/CATALOG.md
```

`verify` is the real acceptance test of the catalogue: it renders one tile per layer through
`@orthogea/client`, so a renamed layer, a dropped CRS or a dead host is caught immediately. At
the last run 47 of 52 layers answered with real imagery; the two exceptions are marked
`status: "experimental"` and need credentials.

Several national services throttle bursts of requests, so a sweep at high concurrency can report
a transient `fetch failed`, `502` or `404`. Re-run the failing ids on their own
(`verify --id pl.geoportal --concurrency 1`) before concluding that an endpoint is gone.

## Tests

The unit tests validate every bundled JSON file against the Zod schema and enforce the house
rules: unique ids, ids prefixed with their country, NUTS codes consistent with the country, the
`no-3857` tag in sync with the advertised CRS, an info format on every queryable layer, and a
name on every custom licence.

## Licensing

The package is MIT. The data behind each endpoint keeps its publisher's licence, recorded per
record - see [NOTICE.md](../../NOTICE.md) and
[docs/CONCEPTS.md](../../docs/CONCEPTS.md#licensing-and-attribution).

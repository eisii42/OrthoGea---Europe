# Stability contract

OrthoGea is a dependency of other platforms, which means some of its surface has to stop moving
before 1.0 and the rest has to be honestly labelled as still moving. This page is the dividing
line. Everything under [Frozen](#frozen-at-10) follows semantic versioning strictly from 1.0: it
changes in a major release or not at all. Everything else may change in a minor release, with the
change described in [CHANGELOG.md](../CHANGELOG.md).

If you are integrating OrthoGea and you need something that is not on the frozen list, say so in
an issue rather than depending on it quietly.

## Frozen at 1.0

### `bestOrthophotoFor(lng, lat, options?)`

From `@orthogea/catalog`. The single call that replaces a proprietary satellite basemap: give it
a coordinate, get the most local official orthophoto covering it.

```ts
import { bestOrthophotoFor } from "@orthogea/catalog";

const layer = bestOrthophotoFor(11.2558, 43.7696);
```

Guaranteed:

- the signature `(lng: number, lat: number, options?: BestImageryOptions) => OrthoGeaLayer | undefined`,
  with longitude first;
- it returns a record covering the point, ranked most local first;
- with no `fallback` option it never returns `undefined` for a point inside Europe, because the
  pan-European Copernicus base closes the chain;
- `{ fallback: false }` returns `undefined` rather than the base;
- it performs no I/O and is synchronous. The catalogue is a build-time snapshot of the package,
  never fetched at runtime.

Not guaranteed: **which** record wins when several cover the point. The ranking is a heuristic
over declared extents and it is documented as improvable - see
[Known limits](#known-limits-not-defects-you-need-to-report) below. Pin a specific source with
`getLayer(id)` if you need one exact answer.

### The layer record

The fields below keep their name, type and meaning. Fields may be *added* in a minor release;
none of these will be removed, renamed or have its type narrowed before 2.0.

| field | type | meaning |
| --- | --- | --- |
| `id` | `string` | stable, dot-separated, e.g. `it.toscana.ortofoto-2024`. An id is never reused for different imagery |
| `title` | `string` | human label, in the local language where that is what the provider uses |
| `category` | `"orthophoto" \| "satellite" \| …` | what kind of imagery this is |
| `provider` | `{ name, shortName?, url? }` | the publishing authority |
| `country` | `string` | **ISO 3166-1 alpha-2**, or `EU` for pan-European datasets |
| `nuts` | `string?` | most specific NUTS code covered, e.g. `ITI1`. Absent outside the NUTS area |
| `bbox` | `[minLng, minLat, maxLng, maxLat]` | the extent the service advertises, in WGS84 degrees |
| `coverage` | `bbox[]?` | boxes narrowing `bbox` where the hull overhangs; absent when the hull is fair |
| `license` | `{ id, name?, url?, notes? }` | `id` is an SPDX identifier or `custom`; `custom` always carries a `name` |
| `attribution` | `string` | the credit line a map must display. Never empty |
| `minZoom` / `maxZoom` | `number` | web-Mercator zoom range the source is useful over |
| `resolutionMeters` | `number?` | ground sample distance, when the provider publishes one |
| `temporal` | `{ start?, end? }?` | acquisition period, `YYYY`, `YYYY-MM` or `YYYY-MM-DD` |
| `lastVerified` | `string?` | `YYYY-MM-DD`, the date the endpoint was last probed live |

On `country`: it is ISO 3166-1, **not** NUTS-0. The two disagree on Greece (`GR` vs `EL`) and the
United Kingdom (`GB` vs `UK`). Use `countryToNuts()` from `@orthogea/core` to cross between them
rather than assuming they match. This is the shape the catalogue settled on in 0.3.0 precisely so
that it would not have to move after 1.0.

On `attribution` and `license`: displaying the attribution is a licence condition for most
catalogued sources, not a courtesy. `formatAttribution` / `formatAttributions` in
`@orthogea/client` render it, and `mosaic.activeAttribution()` reports only what is actually on
screen.

### The mosaic protocol name

The URL scheme `orthogea-mosaic` and the tile template `orthogea-mosaic://<id>/{z}/{x}/{y}`, both
exported as `MOSAIC_PROTOCOL` and `mosaicTileTemplate()` from `@orthogea/client`. A style
document that hard-codes the scheme keeps working.

The reprojecting protocol's scheme, `orthogea` (`ORTHOGEA_PROTOCOL`), is frozen on the same terms.

### `ORTHOGEA_SCHEMA_VERSION`

From `@orthogea/core`. The version of the record contract above, which is what a consumer should
check when it stores or transports records of its own.

## Not frozen

Free to change in a minor release:

- the ranking inside `bestOrthophotoFor`, `imageryStackFor` and `layersForPoint` - see below;
- which records are in the catalogue, and their `bbox`, `coverage`, `lastVerified`, `status`,
  `tags` and service URLs. The catalogue tracks reality, and reality moves;
- everything in `@orthogea/harvester`, which is an authoring tool rather than a runtime
  dependency;
- the Zod schemas in `@orthogea/core/schemas` beyond the field list above, including the Zod
  major version;
- the adapters' option objects, and anything not named on this page.

## Known limits, not defects you need to report

**Extents are rectangles and regions are not.** A service publishes the bounding rectangle of the
area it covers. For anything that is not rectangular - which is every region - that hull includes
ground the service holds no imagery for. Because the ranking prefers the smaller extent, a small
hull overhanging a large one can win for a point it cannot serve.

Measured against 41 European cities, `bestOrthophotoFor` returns a source from the wrong region
or country for 10 of them. Florence is served by Emilia-Romagna, Barcelona by France, Vienna by
Czechia, Copenhagen by Sweden. The current list is in
[`best-orthophoto.test.ts`](../packages/catalog/src/best-orthophoto.test.ts), which fails if it
grows.

What this means in practice:

- **On a map, it self-corrects.** The mosaic asks the winning service for the tile, gets a no-data
  fill or an error, and moves to the next candidate. The reader sees the right imagery.
- **In a single `bestOrthophotoFor` call, it does not.** There is no fallback chain in one record.
  If you are picking one source per location and storing it, check the result: comparing
  `layer.country` against the country you expect catches the six cross-border cases outright.

The fix is the `coverage` field: a few boxes on the offending record, narrowing its hull to what
it really holds. `pnpm audit:coverage` ranks the records worth doing first. Reordering the ranking
instead was measured and rejected - the best heuristic tried was still wrong once in ten, and it
would have changed the answer for every caller to buy that.

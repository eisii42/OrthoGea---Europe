# @orthogea/demo

A Vite + MapLibre GL single-page app that exercises the whole
[OrthoGea](../../README.md) stack against the real services.

```bash
pnpm install
pnpm build                       # the demo consumes the built packages
pnpm --filter @orthogea/demo dev # http://localhost:5173
```

## What it does

- **Seamless imagery** as the default base layer: Copernicus VHR 2021 draws the whole of Europe,
  and from zoom 15 the official orthophoto of the area takes over, tile by tile. The sidebar shows
  live which provider is being drawn, and the attribution credits exactly those sources.
- **Layer switcher** over the whole catalogue, split into base layers (orthophoto, satellite,
  background) and overlays (land use, elevation), with a search box.
- **Jump to** selector built from the NUTS tree: Europe -> Italy -> Centro -> Toscana, with the
  layer count per node; picking a region fits its extent and switches to its orthophoto.
- **Opacity slider** for the overlays.
- **Click to query**: `GetFeatureInfo` on every visible queryable layer, rendered as a property
  table, with the server's own HTML kept as a fallback.
- **Attributions** built from the catalogue licence data, both in the MapLibre control and in
  the sidebar.
- **Proxy toggle** to compare a direct request with a proxied one.

Layer badges tell you what each entry is: the service type, `queryable`, `reprojected` for the
services without EPSG:3857, and the status when it is not `active`.

## The dev CORS proxy

Most geoportals answer without `Access-Control-Allow-Origin`. `vite.config.ts` adds a
`/cors-proxy?url=<encoded>` middleware that forwards the request server side and **only accepts
hosts that appear in the catalogue**, so the dev server cannot be used as an open relay. The app
passes `proxyUrl: "/cors-proxy?url="` to every adapter, which is exactly the option a production
deployment would point at its own proxy.

Deploying the built app (`pnpm --filter @orthogea/demo build`) without a proxy leaves the
CORS-restricted layers blank; see [docs/CONCEPTS.md](../../docs/CONCEPTS.md#cors).

## Code tour

| File | Contents |
| --- | --- |
| `src/main.ts` | map bootstrap, protocol registration, layer synchronisation, sidebar, GetFeatureInfo |
| `src/style.css` | dark theme, responsive sidebar |
| `vite.config.ts` | the allowlisted CORS proxy |
| `index.html` | the shell |

The interesting part is small:

```ts
registerOrthoGeaProtocol(maplibregl, { layers: [...catalog], proxyUrl });
registerMosaicProtocol(maplibregl, createMosaic({ layers: [...catalog], fallback, proxyUrl }));

const { sourceId, source, layer } = toMapLibreBinding(catalogueLayer, { proxyUrl });
map.addSource(sourceId, source);
map.addLayer(layer);
```

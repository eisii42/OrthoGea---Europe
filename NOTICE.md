# Notice

## The code

OrthoGea - Europe is released under the [MIT licence](LICENSE). That covers the source of this
repository and the published packages: `@orthogea/core`, `@orthogea/harvester`,
`@orthogea/client` and `@orthogea/catalog`.

## The data

**The MIT licence does not extend to the imagery.** Every catalogued endpoint is operated by a
public authority and keeps the licence of its publisher, recorded in the `license` field of the
record and listed in [docs/CATALOG.md](docs/CATALOG.md).

Most of those licences require **visible attribution**. `@orthogea/client` builds the credit
string for you and every adapter fills the attribution field of the source it produces, so a
default integration is already compliant:

```ts
formatAttribution(layer);
// 'Regione Toscana - Geoscopio (CC-BY-4.0)'

mosaic.activeAttribution();
// credits exactly the providers currently on screen
```

Before publishing a map, please check:

- **`license.id`** - `CC-BY-4.0`, `IODL-2.0`, `etalab-2.0`, `dl-de-by-2.0`, `CC0-1.0`,
  `copernicus-free` or `custom`.
- **`license.notes`** on `custom` records - some services are licensed for visualisation only.
- **`status`** - `experimental` records need credentials or are otherwise not production ready.

### The European base

The default background is the **Copernicus VHR 2021 seamless mosaic**, produced for the
Copernicus Land Monitoring Service and served by the European Environment Agency. It is covered
by the [Copernicus free, full and open data policy](https://www.copernicus.eu/en/access-data/copyright-and-licences),
and the required credit is:

> Copernicus VHR 2021 - European Union, EEA

## Trademarks

Google, Google Satellite, ESRI and ArcGIS are trademarks of their respective owners. They are
named in this documentation only to describe what this project is an alternative to; the project
is not affiliated with, endorsed by or derived from any of them.

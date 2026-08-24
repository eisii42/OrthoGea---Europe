import { OrthoGeaLayerSchema } from "@orthogea/core/schemas";
import type { OrthoGeaLayer } from "@orthogea/core";

/** WMS 1.3.0 cadastre layer behind an INSPIRE proxy endpoint ending with `?`. */
export const cadastreLayer: OrthoGeaLayer = OrthoGeaLayerSchema.parse({
  id: "it.ade.catasto",
  title: "Cadastre - Agenzia delle Entrate",
  category: "cadastre",
  provider: { name: "Agenzia delle Entrate", url: "https://www.agenziaentrate.gov.it/" },
  country: "IT",
  bbox: [6.6, 35.4, 18.6, 47.2],
  service: {
    type: "WMS",
    url: "https://wms.example.gov.it/inspire/wms/owsproxy.sub?",
    options: {
      layers: ["CP.CadastralParcel"],
      format: "image/png",
      crs: ["EPSG:6706", "EPSG:4326", "EPSG:3857"],
      version: "1.3.0",
      queryable: true,
      transparent: true,
      infoFormats: ["text/html", "application/json"]
    }
  },
  license: { id: "IODL-2.0", url: "https://www.dati.gov.it/content/italian-open-data-license-v20" },
  attribution: "Agenzia delle Entrate",
  minZoom: 13,
  maxZoom: 22
});

/** WMS 1.1.1 orthophoto layer, opaque, JPEG. */
export const orthophotoLayer: OrthoGeaLayer = OrthoGeaLayerSchema.parse({
  id: "it.toscana.ortofoto",
  title: "Orthophoto Toscana",
  category: "orthophoto",
  provider: { name: "Regione Toscana", shortName: "Regione Toscana" },
  country: "IT",
  nuts: "ITI1",
  regionName: "Toscana",
  bbox: [9.68, 42.23, 12.37, 44.47],
  service: {
    type: "WMS",
    url: "https://geoserver.example.it/geoscopio/wms",
    options: {
      layers: ["rt_ofc.10k22"],
      styles: ["default"],
      format: "image/jpeg",
      crs: ["EPSG:3857", "EPSG:4326", "EPSG:3003"],
      version: "1.1.1",
      queryable: true,
      transparent: false,
      infoFormats: ["text/plain"],
      tileSize: 512
    }
  },
  license: { id: "CC-BY-4.0" },
  attribution: "Regione Toscana - Geoscopio"
});

/** WMTS layer served in KVP encoding. */
export const wmtsLayer: OrthoGeaLayer = OrthoGeaLayerSchema.parse({
  id: "eu.copernicus.sentinel2",
  title: "Sentinel-2 True Color",
  category: "satellite",
  provider: { name: "Copernicus Data Space Ecosystem" },
  country: "EU",
  bbox: [-25, 32, 45, 72],
  service: {
    type: "WMTS",
    url: "https://tiles.example.eu/wmts",
    options: {
      layer: "TRUE_COLOR",
      tileMatrixSet: "GoogleMapsCompatible",
      format: "image/jpeg",
      style: "default",
      dimensions: { TIME: "2024-06-01" }
    }
  },
  license: { id: "copernicus-free" },
  attribution: "Copernicus Sentinel data 2024"
});

/** WMTS layer served through a RESTful ResourceURL template. */
export const wmtsRestLayer: OrthoGeaLayer = OrthoGeaLayerSchema.parse({
  id: "eu.copernicus.sentinel2.rest",
  title: "Sentinel-2 True Color (REST)",
  category: "satellite",
  provider: { name: "Copernicus Data Space Ecosystem" },
  country: "EU",
  bbox: [-25, 32, 45, 72],
  service: {
    type: "WMTS",
    url: "https://tiles.example.eu/wmts",
    options: {
      layer: "TRUE_COLOR",
      tileMatrixSet: "GoogleMapsCompatible",
      format: "image/jpeg",
      requestEncoding: "REST",
      urlTemplate:
        "https://tiles.example.eu/wmts/{Layer}/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.jpg"
    }
  },
  license: { id: "copernicus-free" },
  attribution: "Copernicus Sentinel data 2024"
});

/** Plain slippy-map layer with subdomains. */
export const xyzLayer: OrthoGeaLayer = OrthoGeaLayerSchema.parse({
  id: "eu.osm.standard",
  title: "OpenStreetMap standard",
  category: "custom",
  provider: { name: "OpenStreetMap contributors" },
  country: "EU",
  bbox: [-180, -85, 180, 85],
  service: {
    type: "XYZ",
    url: "https://tile.openstreetmap.org",
    options: {
      urlTemplate: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      subdomains: ["a", "b", "c"]
    }
  },
  license: { id: "ODbL-1.0", url: "https://opendatacommons.org/licenses/odbl/" },
  attribution: "OpenStreetMap contributors"
});

/** WFS layer, used to check that raster adapters refuse it. */
export const wfsLayer: OrthoGeaLayer = OrthoGeaLayerSchema.parse({
  id: "es.catastro.parcels",
  title: "Catastro parcels",
  category: "cadastre",
  provider: { name: "Dirección General del Catastro" },
  country: "ES",
  bbox: [-18.2, 27.6, 4.3, 43.8],
  service: {
    type: "WFS",
    url: "https://ovc.example.es/wfs",
    options: {
      typeNames: ["cp:CadastralParcel"],
      version: "2.0.0",
      outputFormat: "application/json",
      crs: "EPSG:4326",
      maxFeatures: 50
    }
  },
  license: { id: "CC-BY-4.0" },
  attribution: "Dirección General del Catastro"
});

/**
 * WMS that publishes only geodetic CRS, like the Italian cadastre: MapLibre
 * cannot request it with `{bbox-epsg-3857}` and needs the OrthoGea protocol.
 */
export const cadastreNoMercatorLayer: OrthoGeaLayer = OrthoGeaLayerSchema.parse({
  id: "it.ade.catasto.rdn",
  title: "Cadastre - RDN2008 only",
  category: "cadastre",
  provider: { name: "Agenzia delle Entrate" },
  country: "IT",
  bbox: [6.6, 35.4, 18.6, 47.2],
  service: {
    type: "WMS",
    url: "https://wms.example.gov.it/inspire/wms/ows01.php",
    options: {
      layers: ["CP.CadastralParcel"],
      format: "image/png",
      crs: ["EPSG:6706", "EPSG:25832", "EPSG:25833"],
      version: "1.3.0",
      queryable: true,
      infoFormats: ["text/html"]
    }
  },
  license: { id: "CC-BY-4.0" },
  attribution: "Agenzia delle Entrate",
  minZoom: 13,
  maxZoom: 22
});

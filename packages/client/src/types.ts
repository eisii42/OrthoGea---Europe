/**
 * Structural copies of the MapLibre GL style-spec types the adapters produce.
 *
 * They are intentionally declared here instead of importing `maplibre-gl`, so
 * that the package stays dependency-free and usable from Node, workers and
 * OpenLayers hosts. The shapes are assignable to the official
 * `RasterSourceSpecification` / `RasterLayerSpecification` types.
 */

export interface RasterSourceSpecification {
  type: "raster";
  /** Tile URL templates; MapLibre substitutes `{z}/{x}/{y}` or `{bbox-epsg-3857}`. */
  tiles?: string[];
  /** TileJSON endpoint, used instead of `tiles` by some providers. */
  url?: string;
  bounds?: [number, number, number, number];
  minzoom?: number;
  maxzoom?: number;
  tileSize?: number;
  scheme?: "xyz" | "tms";
  attribution?: string;
  volatile?: boolean;
}

export interface RasterLayerSpecification {
  id: string;
  type: "raster";
  source: string;
  minzoom?: number;
  maxzoom?: number;
  layout?: { visibility?: "visible" | "none" };
  paint?: {
    "raster-opacity"?: number;
    "raster-fade-duration"?: number;
    "raster-resampling"?: "linear" | "nearest";
  };
}

/** Options shared by every adapter. */
export interface AdapterOptions {
  /**
   * CORS proxy applied to every generated request. Accepts a prefix
   * (`https://proxy/`, `https://proxy/?url=`) or a template
   * (`https://proxy/?target={url}`).
   */
  proxyUrl?: string;
  /** Overrides the tile size declared by the layer (256 or 512). */
  tileSize?: 256 | 512;
  /** Extra query parameters appended to every request. */
  extraParams?: Record<string, string | number | boolean>;
}

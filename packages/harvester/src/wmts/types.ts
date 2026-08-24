import type { GeoBoundingBox } from "@orthogea/core";

export interface ParsedWmtsTileMatrix {
  identifier: string;
  scaleDenominator: number;
  /** Top-left corner in the CRS of the matrix set, already in x/y order. */
  topLeftCorner: [number, number];
  tileWidth: number;
  tileHeight: number;
  matrixWidth: number;
  matrixHeight: number;
}

export interface ParsedWmtsTileMatrixSet {
  identifier: string;
  /** Canonical CRS code of the matrix set, e.g. `EPSG:3857`. */
  crs: string;
  wellKnownScaleSet?: string;
  tileMatrices: ParsedWmtsTileMatrix[];
}

export interface ParsedWmtsStyle {
  identifier: string;
  title?: string;
  isDefault: boolean;
  legendUrl?: string;
}

export interface ParsedWmtsDimension {
  identifier: string;
  units?: string;
  default?: string;
  values: string[];
}

export interface ParsedWmtsResourceUrl {
  format: string;
  resourceType: string;
  template: string;
}

export interface ParsedWmtsLayer {
  identifier: string;
  title: string;
  abstract?: string;
  keywords: string[];
  bbox?: GeoBoundingBox;
  formats: string[];
  infoFormats: string[];
  /** True when the layer advertises at least one GetFeatureInfo format. */
  queryable: boolean;
  styles: ParsedWmtsStyle[];
  /** Identifiers of the tile matrix sets the layer is published in. */
  tileMatrixSets: string[];
  resourceUrls: ParsedWmtsResourceUrl[];
  dimensions: ParsedWmtsDimension[];
}

export interface ParsedWmtsOperation {
  url?: string;
  /** Request encodings advertised through `ows:Constraint`, e.g. `KVP`, `REST`. */
  encodings: string[];
}

export interface ParsedWmtsCapabilities {
  serviceType: "WMTS";
  version: string;
  service: {
    title: string;
    abstract?: string;
    keywords: string[];
    fees?: string;
    accessConstraints?: string;
    providerName?: string;
    providerSite?: string;
  };
  operations: {
    getCapabilities?: ParsedWmtsOperation;
    getTile?: ParsedWmtsOperation;
    getFeatureInfo?: ParsedWmtsOperation;
  };
  layers: ParsedWmtsLayer[];
  tileMatrixSets: Record<string, ParsedWmtsTileMatrixSet>;
}

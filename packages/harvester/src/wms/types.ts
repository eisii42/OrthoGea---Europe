import type { GeoBoundingBox, WmsVersion } from "@orthogea/core";

/** A `BoundingBox` element, kept both as written and as `[minX, minY, maxX, maxY]`. */
export interface ParsedBoundingBox {
  /** Canonical CRS code, e.g. `EPSG:3857`. */
  crs: string;
  /** Corners in x/y (lon/lat, easting/northing) order, axis swap already undone. */
  bbox: [number, number, number, number];
  /** Corners exactly as written in the document, in the CRS axis order. */
  raw: [number, number, number, number];
  resx?: number;
  resy?: number;
}

export interface ParsedStyle {
  name: string;
  title?: string;
  abstract?: string;
  legendUrl?: string;
  legendFormat?: string;
  legendWidth?: number;
  legendHeight?: number;
}

export interface ParsedDimension {
  name: string;
  units?: string;
  default?: string;
  /** Raw extent string, e.g. `2015-01-01/2024-12-31/P1Y`. */
  values?: string;
  nearestValue?: boolean;
  current?: boolean;
}

export interface ParsedMetadataUrl {
  url: string;
  type?: string;
  format?: string;
}

export interface ParsedAttribution {
  title?: string;
  url?: string;
  logoUrl?: string;
}

/** A `<Layer>` element with all inherited properties already resolved. */
export interface ParsedWmsLayer {
  /** `Name` element; absent for grouping layers that cannot be requested. */
  name?: string;
  title: string;
  abstract?: string;
  keywords: string[];
  /** True when `queryable="1"`, i.e. GetFeatureInfo is supported. */
  queryable: boolean;
  opaque: boolean;
  cascaded?: number;
  /** CRS/SRS advertised for this layer, inherited ones included. */
  crs: string[];
  /** Geographic extent in WGS84 degrees, from EX_GeographicBoundingBox, LatLonBoundingBox or a geographic BoundingBox. */
  bbox?: GeoBoundingBox;
  boundingBoxes: ParsedBoundingBox[];
  styles: ParsedStyle[];
  dimensions: ParsedDimension[];
  minScaleDenominator?: number;
  maxScaleDenominator?: number;
  attribution?: ParsedAttribution;
  metadataUrls: ParsedMetadataUrl[];
  /** Titles of the ancestors, root first, useful to rebuild the tree in a UI. */
  path: string[];
  /** Nesting depth, 0 for the root layer. */
  depth: number;
  children: ParsedWmsLayer[];
}

export interface ParsedOperation {
  formats: string[];
  /** Endpoint advertised for this operation (DCPType/HTTP/Get). */
  url?: string;
  postUrl?: string;
}

export interface ParsedServiceMetadata {
  name?: string;
  title: string;
  abstract?: string;
  keywords: string[];
  onlineResource?: string;
  fees?: string;
  accessConstraints?: string;
  contactOrganization?: string;
  contactPerson?: string;
  contactEmail?: string;
  /** WMS 1.3.0 server-side limits. */
  layerLimit?: number;
  maxWidth?: number;
  maxHeight?: number;
}

/** Result of {@link parseWmsCapabilities}. */
export interface ParsedCapabilities {
  serviceType: "WMS";
  version: WmsVersion;
  service: ParsedServiceMetadata;
  operations: {
    getCapabilities?: ParsedOperation;
    getMap?: ParsedOperation;
    getFeatureInfo?: ParsedOperation;
  };
  exceptionFormats: string[];
  /** Root `<Layer>` of the tree, when the document declares one. */
  rootLayer?: ParsedWmsLayer;
  /** Every requestable (named) layer, depth-first. */
  layers: ParsedWmsLayer[];
}

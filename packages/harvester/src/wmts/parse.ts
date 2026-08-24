import {
  CapabilitiesParseError,
  ServiceExceptionError,
  getAxisOrder,
  normalizeCrs,
  type GeoBoundingBox
} from "@orthogea/core";
import {
  asArray,
  attr,
  child,
  childText,
  children,
  isNode,
  num,
  parseXml,
  splitList,
  text
} from "../xml.js";
import type {
  ParsedWmtsCapabilities,
  ParsedWmtsDimension,
  ParsedWmtsLayer,
  ParsedWmtsOperation,
  ParsedWmtsResourceUrl,
  ParsedWmtsStyle,
  ParsedWmtsTileMatrix,
  ParsedWmtsTileMatrixSet
} from "./types.js";

/** Parses an `ows:LowerCorner`/`ows:UpperCorner` pair into x/y numbers. */
function parseCorner(value: string | undefined, crs?: string): [number, number] | undefined {
  const parts = splitList(value).map((part) => Number.parseFloat(part));
  const [first, second] = parts;
  if (first === undefined || second === undefined) return undefined;
  if (!Number.isFinite(first) || !Number.isFinite(second)) return undefined;
  // Corners follow the CRS axis order, so latitude-first CRS need a swap.
  if (crs && getAxisOrder(crs) === "latlon") return [second, first];
  return [first, second];
}

function parseOperation(node: unknown): ParsedWmtsOperation | undefined {
  if (!isNode(node)) return undefined;
  const get = child(child(child(node, "DCP"), "HTTP"), "Get");
  const encodings = children(get, "Constraint")
    .filter((constraint) => attr(constraint, "name") === "GetEncoding")
    .flatMap((constraint) =>
      children(child(constraint, "AllowedValues"), "Value")
        .map((value) => text(value))
        .filter((value): value is string => Boolean(value))
    );
  return {
    url: attr(get, "href") ?? attr(get, "xlink:href"),
    encodings
  };
}

function parseStyles(node: unknown): ParsedWmtsStyle[] {
  return children(node, "Style")
    .map((style): ParsedWmtsStyle | undefined => {
      const identifier = childText(style, "Identifier");
      if (!identifier) return undefined;
      const legend = child(style, "LegendURL");
      return {
        identifier,
        title: childText(style, "Title"),
        isDefault: attr(style, "isDefault") === "true" || attr(style, "isDefault") === "1",
        legendUrl: attr(legend, "href") ?? attr(legend, "xlink:href")
      };
    })
    .filter((style): style is ParsedWmtsStyle => Boolean(style));
}

function parseDimensions(node: unknown): ParsedWmtsDimension[] {
  return children(node, "Dimension")
    .map((dimension): ParsedWmtsDimension | undefined => {
      const identifier = childText(dimension, "Identifier");
      if (!identifier) return undefined;
      return {
        identifier,
        units: childText(dimension, "UOM"),
        default: childText(dimension, "Default"),
        values: children(dimension, "Value")
          .map((value) => text(value))
          .filter((value): value is string => Boolean(value))
      };
    })
    .filter((dimension): dimension is ParsedWmtsDimension => Boolean(dimension));
}

function parseResourceUrls(node: unknown): ParsedWmtsResourceUrl[] {
  return children(node, "ResourceURL")
    .map((resource): ParsedWmtsResourceUrl | undefined => {
      const template = attr(resource, "template");
      if (!template) return undefined;
      return {
        template,
        format: attr(resource, "format") ?? "image/png",
        resourceType: attr(resource, "resourceType") ?? "tile"
      };
    })
    .filter((resource): resource is ParsedWmtsResourceUrl => Boolean(resource));
}

function parseLayerBBox(node: unknown): GeoBoundingBox | undefined {
  const wgs84 = child(node, "WGS84BoundingBox");
  if (isNode(wgs84)) {
    // WGS84BoundingBox is defined in CRS:84, always longitude first.
    const lower = parseCorner(childText(wgs84, "LowerCorner"));
    const upper = parseCorner(childText(wgs84, "UpperCorner"));
    if (lower && upper) return [lower[0], lower[1], upper[0], upper[1]];
  }

  for (const box of children(node, "BoundingBox")) {
    const crs = attr(box, "crs") ?? attr(box, "CRS");
    if (!crs) continue;
    const normalized = normalizeCrs(crs);
    if (normalized !== "EPSG:4326" && normalized !== "CRS:84") continue;
    const lower = parseCorner(childText(box, "LowerCorner"), normalized);
    const upper = parseCorner(childText(box, "UpperCorner"), normalized);
    if (lower && upper) return [lower[0], lower[1], upper[0], upper[1]];
  }

  return undefined;
}

function parseTileMatrix(node: unknown, crs: string): ParsedWmtsTileMatrix | undefined {
  const identifier = childText(node, "Identifier");
  const scaleDenominator = num(childText(node, "ScaleDenominator"));
  const topLeftCorner = parseCorner(childText(node, "TopLeftCorner"), crs);
  const tileWidth = num(childText(node, "TileWidth"));
  const tileHeight = num(childText(node, "TileHeight"));
  const matrixWidth = num(childText(node, "MatrixWidth"));
  const matrixHeight = num(childText(node, "MatrixHeight"));
  if (
    !identifier ||
    scaleDenominator === undefined ||
    !topLeftCorner ||
    tileWidth === undefined ||
    tileHeight === undefined ||
    matrixWidth === undefined ||
    matrixHeight === undefined
  ) {
    return undefined;
  }
  return {
    identifier,
    scaleDenominator,
    topLeftCorner,
    tileWidth,
    tileHeight,
    matrixWidth,
    matrixHeight
  };
}

/**
 * Parses a WMTS 1.0.0 `GetCapabilities` document into layers and tile matrix
 * sets, normalising CRS codes and corner axis order.
 */
export function parseWmtsCapabilities(xmlString: string): ParsedWmtsCapabilities {
  const doc = parseXml(xmlString);

  const exceptionReport = doc["ExceptionReport"];
  if (exceptionReport) {
    const messages = children(exceptionReport, "Exception").flatMap((node) =>
      children(node, "ExceptionText")
        .map((item) => text(item))
        .filter((message): message is string => Boolean(message))
    );
    throw new ServiceExceptionError(messages.length ? messages : ["Unknown ExceptionReport"]);
  }

  const root = asArray(doc["Capabilities"])[0];
  if (!isNode(root)) {
    throw new CapabilitiesParseError(
      "Not a WMTS capabilities document: expected a Capabilities root element"
    );
  }

  const identification = child(root, "ServiceIdentification");
  const provider = child(root, "ServiceProvider");
  const contents = child(root, "Contents");

  const operations: ParsedWmtsCapabilities["operations"] = {};
  for (const operation of children(child(root, "OperationsMetadata"), "Operation")) {
    const name = attr(operation, "name");
    const parsed = parseOperation(operation);
    if (!name || !parsed) continue;
    if (name === "GetCapabilities") operations.getCapabilities = parsed;
    if (name === "GetTile") operations.getTile = parsed;
    if (name === "GetFeatureInfo") operations.getFeatureInfo = parsed;
  }

  const tileMatrixSets: Record<string, ParsedWmtsTileMatrixSet> = {};
  for (const set of children(contents, "TileMatrixSet")) {
    const identifier = childText(set, "Identifier");
    const supportedCrs = childText(set, "SupportedCRS");
    if (!identifier || !supportedCrs) continue;
    const crs = normalizeCrs(supportedCrs);
    tileMatrixSets[identifier] = {
      identifier,
      crs,
      wellKnownScaleSet: childText(set, "WellKnownScaleSet"),
      tileMatrices: children(set, "TileMatrix")
        .map((matrix) => parseTileMatrix(matrix, crs))
        .filter((matrix): matrix is ParsedWmtsTileMatrix => Boolean(matrix))
    };
  }

  const layers: ParsedWmtsLayer[] = [];
  for (const layer of children(contents, "Layer")) {
    const identifier = childText(layer, "Identifier");
    if (!identifier) continue;
    const infoFormats = children(layer, "InfoFormat")
      .map((format) => text(format))
      .filter((format): format is string => Boolean(format));
    layers.push({
      identifier,
      title: childText(layer, "Title") ?? identifier,
      abstract: childText(layer, "Abstract"),
      keywords: children(child(layer, "Keywords"), "Keyword")
        .map((keyword) => text(keyword))
        .filter((keyword): keyword is string => Boolean(keyword)),
      bbox: parseLayerBBox(layer),
      formats: children(layer, "Format")
        .map((format) => text(format))
        .filter((format): format is string => Boolean(format)),
      infoFormats,
      queryable: infoFormats.length > 0,
      styles: parseStyles(layer),
      tileMatrixSets: children(layer, "TileMatrixSetLink")
        .map((link) => childText(link, "TileMatrixSet"))
        .filter((set): set is string => Boolean(set)),
      resourceUrls: parseResourceUrls(layer),
      dimensions: parseDimensions(layer)
    });
  }

  return {
    serviceType: "WMTS",
    version: attr(root, "version") ?? "1.0.0",
    service: {
      title: childText(identification, "Title") ?? "Untitled service",
      abstract: childText(identification, "Abstract"),
      keywords: children(child(identification, "Keywords"), "Keyword")
        .map((keyword) => text(keyword))
        .filter((keyword): keyword is string => Boolean(keyword)),
      fees: childText(identification, "Fees"),
      accessConstraints: childText(identification, "AccessConstraints"),
      providerName: childText(provider, "ProviderName"),
      providerSite:
        attr(child(provider, "ProviderSite"), "href") ??
        attr(child(provider, "ProviderSite"), "xlink:href")
    },
    operations,
    layers,
    tileMatrixSets
  };
}

/** Looks up a WMTS layer by identifier. */
export function findWmtsLayer(
  capabilities: ParsedWmtsCapabilities,
  identifier: string
): ParsedWmtsLayer | undefined {
  return capabilities.layers.find((layer) => layer.identifier === identifier);
}

import {
  CapabilitiesParseError,
  ServiceExceptionError,
  normalizeCrs,
  orderBBoxForCrs,
  isSameCrs,
  bboxFromMercator,
  type GeoBoundingBox,
  type WmsVersion
} from "@orthogea/core";
import {
  asArray,
  attr,
  child,
  childText,
  children,
  isNode,
  num,
  numAttr,
  onlineResourceHref,
  parseXml,
  pickNode,
  splitList,
  text,
  type XmlNode
} from "../xml.js";
import type {
  ParsedAttribution,
  ParsedBoundingBox,
  ParsedCapabilities,
  ParsedDimension,
  ParsedMetadataUrl,
  ParsedOperation,
  ParsedServiceMetadata,
  ParsedStyle,
  ParsedWmsLayer
} from "./types.js";

export interface ParseWmsOptions {
  /**
   * Endpoint the document was fetched from. Used when the server advertises a
   * different (often internal or http-only) URL in `OnlineResource`.
   */
  endpointUrl?: string;
  /**
   * Trust the URLs advertised inside the document even when `endpointUrl` is
   * given. Defaults to `false`, because many national services advertise
   * unreachable hostnames behind a reverse proxy.
   */
  preferAdvertisedUrls?: boolean;
}

/** Standard conversion factor between WMS 1.1.1 ScaleHint and a scale denominator. */
const SCALE_HINT_TO_DENOMINATOR = 1 / (0.00028 * Math.SQRT2);

function normalizeVersion(raw: string | undefined, rootName: string): WmsVersion {
  switch (raw) {
    case "1.3.0":
    case "1.3":
      return "1.3.0";
    case "1.1.1":
      return "1.1.1";
    case "1.1.0":
      return "1.1.0";
    default:
      return rootName === "WMT_MS_Capabilities" ? "1.1.1" : "1.3.0";
  }
}

function throwIfServiceException(doc: XmlNode): void {
  const report = doc["ServiceExceptionReport"];
  if (report) {
    const messages = children(report, "ServiceException")
      .map((node) => text(node) ?? attr(node, "code"))
      .filter((message): message is string => Boolean(message));
    throw new ServiceExceptionError(messages.length ? messages : ["Unknown ServiceException"]);
  }
  const owsReport = doc["ExceptionReport"];
  if (owsReport) {
    const messages = children(owsReport, "Exception").flatMap((node) =>
      children(node, "ExceptionText")
        .map((item) => text(item))
        .filter((message): message is string => Boolean(message))
    );
    throw new ServiceExceptionError(messages.length ? messages : ["Unknown ExceptionReport"]);
  }
}

function parseServiceMetadata(node: unknown): ParsedServiceMetadata {
  const contact = child(node, "ContactInformation");
  const person = child(contact, "ContactPersonPrimary");
  return {
    name: childText(node, "Name"),
    title: childText(node, "Title") ?? "Untitled service",
    abstract: childText(node, "Abstract"),
    keywords: children(child(node, "KeywordList"), "Keyword")
      .map((keyword) => text(keyword))
      .filter((keyword): keyword is string => Boolean(keyword)),
    onlineResource: onlineResourceHref(node),
    fees: childText(node, "Fees"),
    accessConstraints: childText(node, "AccessConstraints"),
    contactOrganization: childText(person, "ContactOrganization"),
    contactPerson: childText(person, "ContactPerson"),
    contactEmail: childText(contact, "ContactElectronicMailAddress"),
    layerLimit: num(childText(node, "LayerLimit")),
    maxWidth: num(childText(node, "MaxWidth")),
    maxHeight: num(childText(node, "MaxHeight"))
  };
}

function parseOperation(node: unknown): ParsedOperation | undefined {
  if (!isNode(node)) return undefined;
  const http = child(child(node, "DCPType"), "HTTP");
  return {
    formats: children(node, "Format")
      .map((format) => text(format))
      .filter((format): format is string => Boolean(format)),
    url: onlineResourceHref(child(http, "Get")),
    postUrl: onlineResourceHref(child(http, "Post"))
  };
}

function parseStyles(node: unknown): ParsedStyle[] {
  return children(node, "Style")
    .map((style): ParsedStyle | undefined => {
      const name = childText(style, "Name");
      if (!name) return undefined;
      const legend = child(style, "LegendURL");
      return {
        name,
        title: childText(style, "Title"),
        abstract: childText(style, "Abstract"),
        legendUrl: onlineResourceHref(legend),
        legendFormat: childText(legend, "Format"),
        legendWidth: numAttr(legend, "width"),
        legendHeight: numAttr(legend, "height")
      };
    })
    .filter((style): style is ParsedStyle => Boolean(style));
}

function parseDimensions(node: unknown): ParsedDimension[] {
  const byName = new Map<string, ParsedDimension>();

  // WMS 1.3.0 carries values inside <Dimension>; 1.1.1 splits them into <Extent>.
  for (const dimension of children(node, "Dimension")) {
    const name = attr(dimension, "name");
    if (!name) continue;
    byName.set(name.toLowerCase(), {
      name,
      units: attr(dimension, "units"),
      default: attr(dimension, "default"),
      values: text(dimension),
      nearestValue: attr(dimension, "nearestValue") === "1",
      current: attr(dimension, "current") === "1"
    });
  }

  for (const extent of children(node, "Extent")) {
    const name = attr(extent, "name");
    if (!name) continue;
    const key = name.toLowerCase();
    const existing = byName.get(key);
    byName.set(key, {
      name,
      units: existing?.units,
      default: attr(extent, "default") ?? existing?.default,
      values: text(extent) ?? existing?.values,
      nearestValue: attr(extent, "nearestValue") === "1" || existing?.nearestValue,
      current: attr(extent, "current") === "1" || existing?.current
    });
  }

  return [...byName.values()];
}

function parseMetadataUrls(node: unknown): ParsedMetadataUrl[] {
  return children(node, "MetadataURL")
    .map((metadata): ParsedMetadataUrl | undefined => {
      const url = onlineResourceHref(metadata);
      if (!url) return undefined;
      return {
        url,
        type: attr(metadata, "type"),
        format: childText(metadata, "Format")
      };
    })
    .filter((metadata): metadata is ParsedMetadataUrl => Boolean(metadata));
}

function parseAttribution(node: unknown): ParsedAttribution | undefined {
  const attribution = child(node, "Attribution");
  if (!isNode(attribution)) return undefined;
  const title = childText(attribution, "Title");
  const url = onlineResourceHref(attribution);
  const logoUrl = onlineResourceHref(child(attribution, "LogoURL"));
  if (!title && !url && !logoUrl) return undefined;
  return { title, url, logoUrl };
}

/**
 * Reads every `<BoundingBox>` of a layer.
 *
 * WMS 1.1.1 writes `SRS` and always orders the corners as
 * `minx,miny,maxx,maxy` in longitude/latitude. WMS 1.3.0 writes `CRS` and
 * orders the corners along the CRS axes, so `minx` is the *latitude* for
 * EPSG:4326, EPSG:6706 or EPSG:4258 - which is undone here.
 */
function parseBoundingBoxes(node: unknown, version: WmsVersion): ParsedBoundingBox[] {
  const boxes: ParsedBoundingBox[] = [];
  for (const box of children(node, "BoundingBox")) {
    const declaredCrs = attr(box, "CRS") ?? attr(box, "SRS");
    const minx = numAttr(box, "minx");
    const miny = numAttr(box, "miny");
    const maxx = numAttr(box, "maxx");
    const maxy = numAttr(box, "maxy");
    if (!declaredCrs || minx === undefined || miny === undefined || maxx === undefined || maxy === undefined) {
      continue;
    }
    const crs = normalizeCrs(declaredCrs);
    const raw: [number, number, number, number] = [minx, miny, maxx, maxy];
    boxes.push({
      crs,
      raw,
      bbox: orderBBoxForCrs(raw, crs, version),
      resx: numAttr(box, "resx"),
      resy: numAttr(box, "resy")
    });
  }
  return boxes;
}

function parseExplicitGeographicBBox(node: unknown): GeoBoundingBox | undefined {
  // WMS 1.3.0: explicit west/east/south/north, no axis-order ambiguity.
  const ex = child(node, "EX_GeographicBoundingBox");
  if (isNode(ex)) {
    const west = num(childText(ex, "westBoundLongitude"));
    const east = num(childText(ex, "eastBoundLongitude"));
    const south = num(childText(ex, "southBoundLatitude"));
    const north = num(childText(ex, "northBoundLatitude"));
    if (west !== undefined && east !== undefined && south !== undefined && north !== undefined) {
      return [west, south, east, north];
    }
  }

  // WMS 1.1.1: LatLonBoundingBox is longitude/latitude despite its name.
  const latLon = child(node, "LatLonBoundingBox");
  if (isNode(latLon)) {
    const minx = numAttr(latLon, "minx");
    const miny = numAttr(latLon, "miny");
    const maxx = numAttr(latLon, "maxx");
    const maxy = numAttr(latLon, "maxy");
    if (minx !== undefined && miny !== undefined && maxx !== undefined && maxy !== undefined) {
      return [minx, miny, maxx, maxy];
    }
  }

  return undefined;
}

/**
 * Last-resort geographic extent: a `BoundingBox` in a geographic CRS, or a
 * pseudo-mercator one projected back to degrees.
 */
function deriveGeographicBBox(
  boxes: readonly ParsedBoundingBox[]
): GeoBoundingBox | undefined {
  const geographic = boxes.find(
    (box) => isSameCrs(box.crs, "EPSG:4326") || isSameCrs(box.crs, "CRS:84")
  );
  if (geographic) return [...geographic.bbox];

  const mercator = boxes.find((box) => isSameCrs(box.crs, "EPSG:3857"));
  if (mercator) return bboxFromMercator([...mercator.bbox]);

  return undefined;
}

function parseScaleRange(node: unknown): { min?: number; max?: number } {
  const min = num(childText(node, "MinScaleDenominator"));
  const max = num(childText(node, "MaxScaleDenominator"));
  if (min !== undefined || max !== undefined) return { min, max };

  // WMS 1.1.1 expresses the same idea as the ground diagonal of one pixel.
  const hint = child(node, "ScaleHint");
  if (isNode(hint)) {
    const hintMin = numAttr(hint, "min");
    const hintMax = numAttr(hint, "max");
    return {
      min: hintMin === undefined ? undefined : hintMin * SCALE_HINT_TO_DENOMINATOR,
      max: hintMax === undefined ? undefined : hintMax * SCALE_HINT_TO_DENOMINATOR
    };
  }
  return {};
}

interface InheritedLayerContext {
  crs: string[];
  boundingBoxes: ParsedBoundingBox[];
  bbox?: GeoBoundingBox;
  styles: ParsedStyle[];
  dimensions: ParsedDimension[];
  attribution?: ParsedAttribution;
  queryable: boolean;
  opaque: boolean;
  cascaded?: number;
  minScaleDenominator?: number;
  maxScaleDenominator?: number;
  path: string[];
  depth: number;
}

const EMPTY_CONTEXT: InheritedLayerContext = {
  crs: [],
  boundingBoxes: [],
  styles: [],
  dimensions: [],
  queryable: false,
  opaque: false,
  path: [],
  depth: 0
};

function mergeById<T>(inherited: readonly T[], own: readonly T[], key: (item: T) => string): T[] {
  const merged = new Map<string, T>();
  for (const item of inherited) merged.set(key(item), item);
  for (const item of own) merged.set(key(item), item);
  return [...merged.values()];
}

/**
 * Parses one `<Layer>` element and, recursively, its children.
 *
 * WMS inheritance rules are applied: CRS lists and styles accumulate,
 * bounding boxes and dimensions are replaced per CRS/name, and the boolean
 * attributes fall back to the parent value when not declared.
 */
function parseLayerNode(
  node: unknown,
  version: WmsVersion,
  inherited: InheritedLayerContext
): ParsedWmsLayer {
  const title = childText(node, "Title") ?? childText(node, "Name") ?? "Untitled layer";
  const name = childText(node, "Name");

  const ownCrs = [
    ...children(node, "CRS").flatMap((crs) => splitList(text(crs))),
    ...children(node, "SRS").flatMap((srs) => splitList(text(srs)))
  ].map((crs) => normalizeCrs(crs));
  const crs = [...new Set([...inherited.crs, ...ownCrs])];

  const ownBoxes = parseBoundingBoxes(node, version);
  const boundingBoxes = mergeById(inherited.boundingBoxes, ownBoxes, (box) => box.crs);

  // A layer's own declaration wins; only then the inherited extent; only then
  // an extent derived from whatever BoundingBox is available.
  const bbox =
    parseExplicitGeographicBBox(node) ??
    deriveGeographicBBox(ownBoxes) ??
    inherited.bbox ??
    deriveGeographicBBox(boundingBoxes);
  const styles = mergeById(inherited.styles, parseStyles(node), (style) => style.name);
  const dimensions = mergeById(
    inherited.dimensions,
    parseDimensions(node),
    (dimension) => dimension.name.toLowerCase()
  );

  const queryableAttr = attr(node, "queryable");
  const opaqueAttr = attr(node, "opaque");
  const cascadedAttr = numAttr(node, "cascaded");
  const scale = parseScaleRange(node);

  const layer: ParsedWmsLayer = {
    name,
    title,
    abstract: childText(node, "Abstract"),
    keywords: children(child(node, "KeywordList"), "Keyword")
      .map((keyword) => text(keyword))
      .filter((keyword): keyword is string => Boolean(keyword)),
    queryable: queryableAttr === undefined ? inherited.queryable : queryableAttr === "1",
    opaque: opaqueAttr === undefined ? inherited.opaque : opaqueAttr === "1",
    cascaded: cascadedAttr ?? inherited.cascaded,
    crs,
    bbox,
    boundingBoxes,
    styles,
    dimensions,
    minScaleDenominator: scale.min ?? inherited.minScaleDenominator,
    maxScaleDenominator: scale.max ?? inherited.maxScaleDenominator,
    attribution: parseAttribution(node) ?? inherited.attribution,
    metadataUrls: parseMetadataUrls(node),
    path: inherited.path,
    depth: inherited.depth,
    children: []
  };

  const childContext: InheritedLayerContext = {
    crs,
    boundingBoxes,
    bbox,
    styles,
    dimensions,
    attribution: layer.attribution,
    queryable: layer.queryable,
    opaque: layer.opaque,
    cascaded: layer.cascaded,
    minScaleDenominator: layer.minScaleDenominator,
    maxScaleDenominator: layer.maxScaleDenominator,
    path: [...inherited.path, title],
    depth: inherited.depth + 1
  };

  layer.children = children(node, "Layer").map((childNode) =>
    parseLayerNode(childNode, version, childContext)
  );

  return layer;
}

function flattenNamedLayers(layer: ParsedWmsLayer, accumulator: ParsedWmsLayer[] = []): ParsedWmsLayer[] {
  if (layer.name) accumulator.push(layer);
  for (const childLayer of layer.children) flattenNamedLayers(childLayer, accumulator);
  return accumulator;
}

/**
 * Parses a WMS `GetCapabilities` document (1.1.0, 1.1.1 or 1.3.0) into a
 * version-independent structure, resolving layer inheritance and axis order.
 *
 * @throws {CapabilitiesParseError} when the document is not a WMS capabilities response.
 * @throws {ServiceExceptionError} when the server answered with a ServiceException report.
 */
export function parseWmsCapabilities(
  xmlString: string,
  options: ParseWmsOptions = {}
): ParsedCapabilities {
  const doc = parseXml(xmlString);
  throwIfServiceException(doc);

  const rootName = ["WMS_Capabilities", "WMT_MS_Capabilities", "Capabilities"].find(
    (candidate) => doc[candidate] !== undefined
  );
  if (!rootName) {
    throw new CapabilitiesParseError(
      "Not a WMS capabilities document: expected WMS_Capabilities or WMT_MS_Capabilities"
    );
  }

  const root = asArray(doc[rootName])[0];
  if (!isNode(root)) {
    throw new CapabilitiesParseError("The capabilities root element is empty");
  }

  const version = normalizeVersion(attr(root, "version"), rootName);
  const service = parseServiceMetadata(child(root, "Service"));
  const capability = child(root, "Capability");
  const request = child(capability, "Request");

  const operations = {
    getCapabilities: parseOperation(pickNode(request, "GetCapabilities", "Capabilities")),
    getMap: parseOperation(pickNode(request, "GetMap", "Map")),
    getFeatureInfo: parseOperation(pickNode(request, "GetFeatureInfo", "FeatureInfo"))
  };

  if (!options.preferAdvertisedUrls && options.endpointUrl) {
    for (const operation of Object.values(operations)) {
      if (operation) operation.url = options.endpointUrl;
    }
  }

  const rootLayerNode = child(capability, "Layer");
  const rootLayer = rootLayerNode
    ? parseLayerNode(rootLayerNode, version, EMPTY_CONTEXT)
    : undefined;

  return {
    serviceType: "WMS",
    version,
    service,
    operations,
    exceptionFormats: children(child(capability, "Exception"), "Format")
      .map((format) => text(format))
      .filter((format): format is string => Boolean(format)),
    rootLayer,
    layers: rootLayer ? flattenNamedLayers(rootLayer) : []
  };
}

/** Depth-first lookup of a named layer inside a parsed capabilities tree. */
export function findLayer(
  capabilities: ParsedCapabilities,
  name: string
): ParsedWmsLayer | undefined {
  return capabilities.layers.find((layer) => layer.name === name);
}

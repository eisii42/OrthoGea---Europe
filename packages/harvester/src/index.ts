/**
 * @orthogea/harvester - reads what European OGC endpoints advertise.
 *
 * Parses WMS 1.1.0/1.1.1/1.3.0 and WMTS 1.0.0 capabilities documents into a
 * version-independent shape, resolves layer inheritance and axis order, checks
 * endpoint availability and converts findings into catalogue records.
 */

export { parseWmsCapabilities, findLayer, type ParseWmsOptions } from "./wms/parse.js";
export type {
  ParsedAttribution,
  ParsedBoundingBox,
  ParsedCapabilities,
  ParsedDimension,
  ParsedMetadataUrl,
  ParsedOperation,
  ParsedServiceMetadata,
  ParsedStyle,
  ParsedWmsLayer
} from "./wms/types.js";

export { parseWmtsCapabilities, findWmtsLayer } from "./wmts/parse.js";
export type {
  ParsedWmtsCapabilities,
  ParsedWmtsDimension,
  ParsedWmtsLayer,
  ParsedWmtsOperation,
  ParsedWmtsResourceUrl,
  ParsedWmtsStyle,
  ParsedWmtsTileMatrix,
  ParsedWmtsTileMatrixSet
} from "./wmts/types.js";

export {
  applyProxy,
  buildCapabilitiesUrl,
  getParamCaseInsensitive,
  setParamCaseInsensitive,
  toBaseServiceUrl,
  type OgcServiceType
} from "./http/url.js";

export {
  checkEndpoint,
  checkEndpoints,
  fetchCapabilities,
  harvestWms,
  harvestWmts,
  type EndpointHealth,
  type FetchLike,
  type HealthCheckOptions
} from "./http/health.js";

export {
  buildLayerId,
  slugify,
  wmsLayerToOrthoGea,
  wmtsLayerToOrthoGea,
  type ToOrthoGeaLayerOptions
} from "./toLayers.js";

export {
  asArray,
  attr,
  child,
  childText,
  children,
  createXmlParser,
  isNode,
  num,
  numAttr,
  onlineResourceHref,
  parseXml,
  splitList,
  text,
  type XmlNode
} from "./xml.js";

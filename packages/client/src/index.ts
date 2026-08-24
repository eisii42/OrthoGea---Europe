/**
 * @orthogea/client - turns catalogue records into map sources.
 *
 * MapLibre GL and OpenLayers adapters, tiled WMS/WMTS/XYZ URL builders, a
 * universal GetFeatureInfo engine and attribution formatting. The package has
 * no runtime dependency on a map library: it produces plain specifications the
 * host application feeds to MapLibre or OpenLayers.
 */

export type {
  AdapterOptions,
  RasterLayerSpecification,
  RasterSourceSpecification
} from "./types.js";

export {
  DEFAULT_MOSAIC_MAX_ZOOM,
  DEFAULT_ORTHOPHOTO_FROM_ZOOM,
  MOSAIC_PROTOCOL,
  Mosaic,
  createMosaic,
  createMosaicProtocol,
  mosaicTileTemplate,
  registerMosaicProtocol,
  toMosaicRasterLayer,
  toMosaicRasterSource,
  type MosaicLayerOptions,
  type MosaicOptions,
  type MosaicProtocolResponse,
  type MosaicSelection,
  type MosaicSourceOptions
} from "./mosaic.js";

export {
  createTileUrlBuilder,
  fetchTile,
  fillTileTemplate,
  type TileUrlBuilder,
  type TileUrlBuilderOptions
} from "./tiles.js";

export {
  toLeafletSource,
  type LeafletAdapterOptions,
  type LeafletBounds,
  type LeafletCommonOptions,
  type LeafletCustomDescriptor,
  type LeafletSource,
  type LeafletTileLayerDescriptor,
  type LeafletWmsDescriptor
} from "./leaflet/adapter.js";

export {
  formatAttribution,
  formatAttributions,
  type AttributionOptions
} from "./attribution.js";

export {
  layerIdFor,
  sourceIdFor,
  toMapLibreBinding,
  toRasterLayer,
  toRasterSource,
  toStyleSpecification,
  type MapLibreBinding,
  type StyleSpecificationLike,
  type ToRasterLayerOptions,
  type ToRasterSourceOptions
} from "./maplibre/adapter.js";

export {
  ORTHOGEA_PROTOCOL,
  createOrthoGeaProtocol,
  needsTileReprojection,
  pickReprojectionCrs,
  protocolTileTemplate,
  registerOrthoGeaProtocol,
  supportsWebMercator,
  type OrthoGeaProtocolOptions,
  type ProtocolRegistrar,
  type ProtocolRequestParameters,
  type ProtocolResponse
} from "./maplibre/protocol.js";

export {
  MAPLIBRE_BBOX_PLACEHOLDER,
  buildWmsGetMapUrl,
  buildWmsLegendUrl,
  buildWmsTileUrlTemplate,
  type WmsGetMapRequest,
  type WmsRequestOptions
} from "./wms/url.js";

export {
  buildWmtsTileUrlTemplate,
  buildXyzTileUrls,
  fillWmtsRestTemplate,
  type WmtsRequestOptions
} from "./wmts/url.js";

export {
  buildWfsGetFeatureUrl,
  toGeoJsonUrl,
  type WfsRequestOptions
} from "./wfs/url.js";

export {
  toOpenLayersSource,
  toOpenLayersWmsSource,
  toOpenLayersWmtsSource,
  toOpenLayersXyzSource,
  type OpenLayersAdapterOptions,
  type OpenLayersSource,
  type OpenLayersWmsSource,
  type OpenLayersWmtsSource,
  type OpenLayersXyzSource
} from "./openlayers/adapter.js";

export {
  assertQueryableWms,
  buildGetFeatureInfoUrl,
  getFeatureInfo,
  getFeatureInfoForLayers,
  parseFeatureInfoResponse,
  parseGmlFeatureInfo,
  parseHtmlFeatureInfo,
  parseTextFeatureInfo,
  pickInfoFormat,
  resolveFeatureInfoWindow,
  resolveGeographicWindow,
  resolveQueryCrs,
  type BuildFeatureInfoUrlOptions,
  type FeatureInfoFeature,
  type FeatureInfoFormat,
  type FeatureInfoQuery,
  type FeatureInfoResponse,
  type FeatureInfoResult,
  type FeatureInfoWindow,
  type FetchLike,
  type GetFeatureInfoOptions
} from "./featureinfo/index.js";

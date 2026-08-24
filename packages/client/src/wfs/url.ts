import {
  applyCorsProxy,
  buildQueryUrl,
  formatBBox,
  isWfsLayer,
  normalizeCrs,
  UnsupportedServiceError,
  type GeoBoundingBox,
  type OrthoGeaLayer,
  type ProjectedBoundingBox,
  type WfsService
} from "@orthogea/core";
import type { AdapterOptions } from "../types.js";

export interface WfsRequestOptions extends AdapterOptions {
  /** Extent filter, in `crs` units and x/y order. */
  bbox?: GeoBoundingBox | ProjectedBoundingBox;
  crs?: string;
  count?: number;
  outputFormat?: string;
  /** CQL or OGC filter passed through untouched (`CQL_FILTER` / `FILTER`). */
  cqlFilter?: string;
  propertyNames?: string[];
  sortBy?: string;
}

/**
 * Builds a `GetFeature` URL for a WFS layer, using the parameter names of the
 * negotiated version (`TYPENAMES`/`COUNT` on 2.0.0, `TYPENAME`/`MAXFEATURES`
 * on 1.x) and the axis order the CRS requires.
 */
export function buildWfsGetFeatureUrl(
  service: WfsService,
  request: WfsRequestOptions = {}
): string {
  const options = service.options;
  const version = options.version;
  const crs = normalizeCrs(request.crs ?? options.crs);
  const isWfs2 = version === "2.0.0";

  const params: Record<string, string | number | boolean> = {
    SERVICE: "WFS",
    VERSION: version,
    REQUEST: "GetFeature",
    [isWfs2 ? "TYPENAMES" : "TYPENAME"]: options.typeNames.join(","),
    OUTPUTFORMAT: request.outputFormat ?? options.outputFormat,
    SRSNAME: crs
  };

  const count = request.count ?? options.maxFeatures;
  if (count !== undefined) params[isWfs2 ? "COUNT" : "MAXFEATURES"] = count;

  if (request.bbox) {
    // The trailing CRS makes the axis order explicit for every server.
    params.BBOX = `${formatBBox(request.bbox, { crs })},${crs}`;
  }
  if (request.cqlFilter) params.CQL_FILTER = request.cqlFilter;
  if (request.propertyNames?.length) {
    params[isWfs2 ? "PROPERTYNAME" : "PROPERTYNAME"] = request.propertyNames.join(",");
  }
  if (request.sortBy) params.SORTBY = request.sortBy;

  const url = buildQueryUrl(service.url, {
    ...params,
    ...options.extraParams,
    ...request.extraParams
  });
  return applyCorsProxy(url, request.proxyUrl);
}

/** Convenience wrapper returning a GeoJSON URL for a catalogued WFS layer. */
export function toGeoJsonUrl(
  layer: OrthoGeaLayer,
  request: WfsRequestOptions = {}
): string {
  if (!isWfsLayer(layer)) {
    throw new UnsupportedServiceError(
      `Layer "${layer.id}" is a ${layer.service.type} service, not WFS`
    );
  }
  return buildWfsGetFeatureUrl(layer.service, {
    ...request,
    outputFormat: request.outputFormat ?? "application/json"
  });
}

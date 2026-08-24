import {
  EndpointUnavailableError,
  UnsupportedServiceError,
  isSameCrs,
  tileToBBox,
  type OrthoGeaLayer,
  type WmsService
} from "@orthogea/core";
import { buildWmsGetMapUrl, type WmsRequestOptions } from "../wms/url.js";

/** URL scheme used by the reprojecting tile protocol. */
export const ORTHOGEA_PROTOCOL = "orthogea";

/**
 * Geographic CRS accepted as a substitute for EPSG:3857, best first.
 *
 * Several national services - the Italian cadastre among them - publish only
 * geodetic CRS (RDN2008, ETRS89) and reject Web Mercator, which MapLibre's
 * `{bbox-epsg-3857}` placeholder assumes.
 */
const GEOGRAPHIC_FALLBACKS = ["CRS:84", "EPSG:4326", "EPSG:4258", "EPSG:6706"] as const;

/** True when the service advertises a Web Mercator CRS MapLibre can request directly. */
export function supportsWebMercator(service: WmsService): boolean {
  return service.options.crs.some((crs) => isSameCrs(crs, "EPSG:3857"));
}

/**
 * True when the layer can only be rendered through the reprojecting protocol,
 * because its WMS does not publish EPSG:3857.
 */
export function needsTileReprojection(layer: OrthoGeaLayer): boolean {
  return layer.service.type === "WMS" && !supportsWebMercator(layer.service);
}

/**
 * Picks the geographic CRS to request tiles in.
 *
 * The order declared in the record wins, because it is the only place where a
 * broken advertisement can be corrected: the Basilicata orthophoto service, for
 * instance, answers `CRS:84` with a blank image but serves `EPSG:4326`
 * correctly, so its record lists EPSG:4326 first.
 */
export function pickReprojectionCrs(service: WmsService): string {
  const declared = service.options.crs.find((crs) =>
    GEOGRAPHIC_FALLBACKS.some((candidate) => isSameCrs(crs, candidate))
  );
  if (declared) return declared;

  for (const candidate of GEOGRAPHIC_FALLBACKS) {
    const match = service.options.crs.find((crs) => isSameCrs(crs, candidate));
    if (match) return match;
  }
  throw new UnsupportedServiceError(
    `The service publishes neither EPSG:3857 nor a geographic CRS (${service.options.crs.join(", ")})`
  );
}

/** Tile URL template consumed by {@link createOrthoGeaProtocol}. */
export function protocolTileTemplate(layerId: string): string {
  return `${ORTHOGEA_PROTOCOL}://${encodeURIComponent(layerId)}/{z}/{x}/{y}`;
}

const TILE_URL_RE = new RegExp(`^${ORTHOGEA_PROTOCOL}://([^/]+)/(\\d+)/(\\d+)/(\\d+)$`);

export interface OrthoGeaProtocolOptions extends WmsRequestOptions {
  /** Layers the protocol may serve, resolved by id. */
  layers: readonly OrthoGeaLayer[];
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  /** Abort a tile request after this many milliseconds. Defaults to 15000. */
  timeoutMs?: number;
}

/** Shape of the request MapLibre passes to a protocol handler. */
export interface ProtocolRequestParameters {
  url: string;
}

export interface ProtocolResponse {
  data: ArrayBuffer;
  cacheControl?: string | null;
  expires?: string | null;
}

/**
 * Builds a MapLibre protocol handler that renders WMS layers which do not
 * support Web Mercator.
 *
 * For every tile MapLibre asks for, the handler converts the tile index into a
 * geographic extent and issues a `GetMap` in the CRS the service does publish
 * (RDN2008, ETRS89 or WGS84), honouring the axis-order rules of WMS 1.3.0.
 * The residual distortion of drawing an equirectangular request into a
 * Mercator tile stays well under a pixel from zoom 10 upwards.
 *
 * Register it once, before creating the map:
 *
 * ```ts
 * maplibregl.addProtocol("orthogea", createOrthoGeaProtocol({ layers }));
 * ```
 */
export function createOrthoGeaProtocol(options: OrthoGeaProtocolOptions) {
  const byId = new Map(options.layers.map((layer) => [layer.id, layer]));
  const timeoutMs = options.timeoutMs ?? 15_000;

  const load = async (url: string, signal: AbortSignal): Promise<ProtocolResponse> => {
    const match = TILE_URL_RE.exec(url);
    if (!match) {
      throw new UnsupportedServiceError(`Malformed OrthoGea tile URL: ${url}`);
    }
    const [, rawId, z, x, y] = match;
    const layerId = decodeURIComponent(rawId ?? "");
    const layer = byId.get(layerId);
    if (!layer) {
      throw new UnsupportedServiceError(`Unknown layer "${layerId}" in ${url}`);
    }
    if (layer.service.type !== "WMS") {
      throw new UnsupportedServiceError(
        `Layer "${layerId}" is a ${layer.service.type} service and needs no reprojection`
      );
    }

    const service = layer.service;
    const crs = pickReprojectionCrs(service);
    const tileSize = options.tileSize ?? service.options.tileSize;
    const requestUrl = buildWmsGetMapUrl(service, {
      ...options,
      crs,
      bbox: tileToBBox(Number(x), Number(y), Number(z)),
      width: tileSize,
      height: tileSize
    });

    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const response = await fetchImpl(requestUrl, { signal });
    if (!response.ok) {
      throw new EndpointUnavailableError(
        `${response.status} ${response.statusText || "HTTP error"} for ${requestUrl}`,
        response.status
      );
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) {
      // WMS servers answer errors with an XML ServiceException and HTTP 200.
      const body = await response.text();
      const message = /<(?:\w+:)?ServiceException[^>]*>([\s\S]*?)<\//i.exec(body)?.[1]?.trim();
      throw new EndpointUnavailableError(
        message
          ? `The service refused the tile request: ${message}`
          : `Expected an image, got ${contentType || "an unknown content type"}`
      );
    }

    return {
      data: await response.arrayBuffer(),
      cacheControl: response.headers.get("cache-control"),
      expires: response.headers.get("expires")
    };
  };

  /**
   * MapLibre 4/5 pass an `AbortController` and expect a promise; MapLibre 3
   * passes a Node-style callback. Both calling conventions are supported.
   */
  return function orthoGeaProtocol(
    params: ProtocolRequestParameters,
    second?: AbortController | ((error?: Error | null, data?: ArrayBuffer | null) => void)
  ): Promise<ProtocolResponse> | { cancel: () => void } {
    const controller =
      second instanceof AbortController ? second : new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const request = load(params.url, controller.signal).finally(() => clearTimeout(timer));

    if (typeof second === "function") {
      request.then(
        (response) => second(null, response.data),
        (error: Error) => second(error, null)
      );
      return { cancel: () => controller.abort() };
    }

    return request;
  };
}

/** Minimal surface of the `maplibre-gl` module used to register the protocol. */
export interface ProtocolRegistrar {
  addProtocol: (scheme: string, handler: never) => void;
}

/**
 * Registers the reprojecting protocol on a MapLibre instance.
 *
 * ```ts
 * import maplibregl from "maplibre-gl";
 * registerOrthoGeaProtocol(maplibregl, { layers });
 * ```
 */
export function registerOrthoGeaProtocol(
  maplibre: ProtocolRegistrar,
  options: OrthoGeaProtocolOptions
): void {
  maplibre.addProtocol(ORTHOGEA_PROTOCOL, createOrthoGeaProtocol(options) as never);
}

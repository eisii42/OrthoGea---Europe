import { EndpointUnavailableError, type OrthoGeaLayer } from "@orthogea/core";
import { parseFeatureInfoResponse, type FeatureInfoResult } from "./parse.js";
import {
  assertQueryableWms,
  buildGetFeatureInfoUrl,
  type BuildFeatureInfoUrlOptions,
  type FeatureInfoQuery
} from "./query.js";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface GetFeatureInfoOptions extends BuildFeatureInfoUrlOptions {
  fetchImpl?: FetchLike;
  /** Abort the request after this many milliseconds. Defaults to 8000. */
  timeoutMs?: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface FeatureInfoResponse extends FeatureInfoResult {
  /** Exact URL that was requested, useful for debugging a portal. */
  url: string;
  layerId: string;
}

function resolveFetch(custom?: FetchLike): FetchLike {
  if (custom) return custom;
  const globalFetch = (globalThis as { fetch?: FetchLike }).fetch;
  if (!globalFetch) {
    throw new EndpointUnavailableError(
      "No fetch implementation available; pass options.fetchImpl"
    );
  }
  return globalFetch;
}

/**
 * Queries a queryable WMS layer at a map click and returns the answer in a
 * uniform shape, whatever the server speaks (GeoJSON, GML, HTML or text).
 *
 * @throws {UnsupportedServiceError} when the layer cannot answer feature queries.
 * @throws {EndpointUnavailableError} on network failure, timeout or HTTP error.
 */
export async function getFeatureInfo(
  layer: OrthoGeaLayer,
  query: FeatureInfoQuery,
  options: GetFeatureInfoOptions = {}
): Promise<FeatureInfoResponse> {
  const service = assertQueryableWms(layer);
  const url = buildGetFeatureInfoUrl(service, query, options);
  const fetchImpl = resolveFetch(options.fetchImpl);

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 8000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onExternalAbort);

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: options.headers,
      signal: controller.signal
    });
    const body = await response.text();

    if (!response.ok) {
      throw new EndpointUnavailableError(
        `${response.status} ${response.statusText || "HTTP error"} for ${url}`,
        response.status
      );
    }

    const contentType = response.headers.get("content-type") ?? undefined;
    const result = parseFeatureInfoResponse(body, contentType);

    if (/<(\w+:)?ServiceException/i.test(body)) {
      const message = /<(?:\w+:)?ServiceException[^>]*>([\s\S]*?)<\//i.exec(body)?.[1]?.trim();
      return {
        ...result,
        features: [],
        warning: message
          ? `The service answered with a ServiceException: ${message}`
          : "The service answered with a ServiceException",
        url,
        layerId: layer.id
      };
    }

    return { ...result, url, layerId: layer.id };
  } catch (error) {
    if (error instanceof EndpointUnavailableError) throw error;
    const aborted = (error as { name?: string }).name === "AbortError";
    throw new EndpointUnavailableError(
      aborted
        ? `GetFeatureInfo timed out after ${timeoutMs} ms`
        : `GetFeatureInfo request failed: ${(error as Error).message}`,
      undefined,
      error
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onExternalAbort);
  }
}

/**
 * Queries every queryable layer of a stack at once and keeps the answers that
 * carried at least one feature, top layer first.
 */
export async function getFeatureInfoForLayers(
  layers: readonly OrthoGeaLayer[],
  query: FeatureInfoQuery,
  options: GetFeatureInfoOptions = {}
): Promise<FeatureInfoResponse[]> {
  const responses = await Promise.allSettled(
    layers.map((layer) => getFeatureInfo(layer, query, options))
  );
  return responses
    .filter(
      (response): response is PromiseFulfilledResult<FeatureInfoResponse> =>
        response.status === "fulfilled"
    )
    .map((response) => response.value)
    .filter((response) => response.features.length > 0 || Boolean(response.html));
}

export {
  assertQueryableWms,
  buildGetFeatureInfoUrl,
  pickInfoFormat,
  resolveFeatureInfoWindow,
  resolveGeographicWindow,
  resolveQueryCrs,
  type BuildFeatureInfoUrlOptions,
  type FeatureInfoQuery,
  type FeatureInfoWindow
} from "./query.js";

export {
  parseFeatureInfoResponse,
  parseGmlFeatureInfo,
  parseHtmlFeatureInfo,
  parseTextFeatureInfo,
  type FeatureInfoFeature,
  type FeatureInfoFormat,
  type FeatureInfoResult
} from "./parse.js";

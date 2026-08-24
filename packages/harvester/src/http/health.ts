import { EndpointUnavailableError, OrthoGeaError } from "@orthogea/core";
import { parseWmsCapabilities } from "../wms/parse.js";
import { parseWmtsCapabilities } from "../wmts/parse.js";
import { applyProxy, buildCapabilitiesUrl, type OgcServiceType } from "./url.js";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HealthCheckOptions {
  service?: OgcServiceType;
  version?: string;
  /** Abort the request after this many milliseconds. Defaults to 10000. */
  timeoutMs?: number;
  /** Injectable fetch, so tests and Node/browser hosts can differ. */
  fetchImpl?: FetchLike;
  /** Parse the document to count layers. Defaults to `true`. */
  parse?: boolean;
  headers?: Record<string, string>;
  /** CORS proxy prefix or `{url}` template. */
  proxyUrl?: string;
  signal?: AbortSignal;
}

export interface EndpointHealth {
  /** Endpoint as given by the caller. */
  url: string;
  /** Exact URL that was requested, proxy and OGC parameters included. */
  requestUrl: string;
  ok: boolean;
  status?: number;
  statusText?: string;
  /** Wall-clock duration of the GetCapabilities round trip. */
  responseTimeMs: number;
  contentType?: string;
  bytes?: number;
  serviceType?: OgcServiceType;
  /** Version reported by the document, which may differ from the request. */
  version?: string;
  title?: string;
  layerCount?: number;
  queryableLayerCount?: number;
  error?: string;
  errorCode?: string;
  /** ISO timestamp of the check. */
  checkedAt: string;
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
 * Fetches a `GetCapabilities` document, honouring timeout, proxy and headers.
 *
 * @throws {EndpointUnavailableError} on network failure, timeout or HTTP error.
 */
export async function fetchCapabilities(
  url: string,
  options: HealthCheckOptions = {}
): Promise<{ xml: string; requestUrl: string; status: number; contentType?: string; elapsedMs: number }> {
  const fetchImpl = resolveFetch(options.fetchImpl);
  const requestUrl = applyProxy(
    buildCapabilitiesUrl(url, { service: options.service, version: options.version }),
    options.proxyUrl
  );

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 10_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onExternalAbort);

  const startedAt = Date.now();
  try {
    const response = await fetchImpl(requestUrl, {
      method: "GET",
      redirect: "follow",
      headers: { Accept: "application/xml,text/xml;q=0.9,*/*;q=0.5", ...options.headers },
      signal: controller.signal
    });
    const xml = await response.text();
    const elapsedMs = Date.now() - startedAt;

    if (!response.ok) {
      throw new EndpointUnavailableError(
        `${response.status} ${response.statusText || "HTTP error"} for ${requestUrl}`,
        response.status
      );
    }

    return {
      xml,
      requestUrl,
      status: response.status,
      contentType: response.headers.get("content-type") ?? undefined,
      elapsedMs
    };
  } catch (error) {
    if (error instanceof OrthoGeaError) throw error;
    const aborted = (error as { name?: string }).name === "AbortError";
    throw new EndpointUnavailableError(
      aborted
        ? `Timed out after ${timeoutMs} ms requesting ${requestUrl}`
        : `Request to ${requestUrl} failed: ${(error as Error).message}`,
      undefined,
      error
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onExternalAbort);
  }
}

/**
 * Tests whether an OGC endpoint answers a `GetCapabilities` request, measuring
 * the response time and, optionally, summarising the advertised layers.
 *
 * Never throws: failures are reported in the returned record so that a whole
 * catalogue can be swept in one pass.
 */
export async function checkEndpoint(
  url: string,
  options: HealthCheckOptions = {}
): Promise<EndpointHealth> {
  const checkedAt = new Date().toISOString();
  const service = options.service ?? "WMS";
  const startedAt = Date.now();

  try {
    const response = await fetchCapabilities(url, options);
    const health: EndpointHealth = {
      url,
      requestUrl: response.requestUrl,
      ok: true,
      status: response.status,
      responseTimeMs: response.elapsedMs,
      contentType: response.contentType,
      bytes: response.xml.length,
      serviceType: service,
      checkedAt
    };

    if (options.parse === false) return health;

    if (service === "WMS") {
      const capabilities = parseWmsCapabilities(response.xml, { endpointUrl: url });
      health.version = capabilities.version;
      health.title = capabilities.service.title;
      health.layerCount = capabilities.layers.length;
      health.queryableLayerCount = capabilities.layers.filter((layer) => layer.queryable).length;
    } else if (service === "WMTS") {
      const capabilities = parseWmtsCapabilities(response.xml);
      health.version = capabilities.version;
      health.title = capabilities.service.title;
      health.layerCount = capabilities.layers.length;
      health.queryableLayerCount = capabilities.layers.filter((layer) => layer.queryable).length;
    }

    return health;
  } catch (error) {
    const orthoError = error instanceof OrthoGeaError ? error : undefined;
    return {
      url,
      requestUrl: applyProxy(
        buildCapabilitiesUrl(url, { service, version: options.version }),
        options.proxyUrl
      ),
      ok: false,
      status: orthoError instanceof EndpointUnavailableError ? orthoError.status : undefined,
      responseTimeMs: Date.now() - startedAt,
      serviceType: service,
      error: (error as Error).message,
      errorCode: orthoError?.code ?? "UNKNOWN_ERROR",
      checkedAt
    };
  }
}

/** Runs {@link checkEndpoint} over many endpoints with bounded concurrency. */
export async function checkEndpoints(
  urls: readonly string[],
  options: HealthCheckOptions & { concurrency?: number } = {}
): Promise<EndpointHealth[]> {
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const results: EndpointHealth[] = new Array(urls.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(concurrency, urls.length) }, async () => {
    while (cursor < urls.length) {
      const index = cursor++;
      const url = urls[index];
      if (url === undefined) return;
      results[index] = await checkEndpoint(url, options);
    }
  });

  await Promise.all(workers);
  return results;
}

/** Fetches and parses a WMS endpoint in one call. */
export async function harvestWms(url: string, options: HealthCheckOptions = {}) {
  const response = await fetchCapabilities(url, { ...options, service: "WMS" });
  return parseWmsCapabilities(response.xml, { endpointUrl: url });
}

/** Fetches and parses a WMTS endpoint in one call. */
export async function harvestWmts(url: string, options: HealthCheckOptions = {}) {
  const response = await fetchCapabilities(url, { ...options, service: "WMTS" });
  return parseWmtsCapabilities(response.xml);
}

import { applyCorsProxy } from "@orthogea/core";

/** OGC service families the harvester can talk to. */
export type OgcServiceType = "WMS" | "WMTS" | "WFS";

const DEFAULT_VERSIONS: Record<OgcServiceType, string> = {
  WMS: "1.3.0",
  WMTS: "1.0.0",
  WFS: "2.0.0"
};

/** Returns the value of a query parameter, ignoring case in the key. */
export function getParamCaseInsensitive(
  params: URLSearchParams,
  name: string
): string | undefined {
  const target = name.toLowerCase();
  for (const [key, value] of params.entries()) {
    if (key.toLowerCase() === target) return value;
  }
  return undefined;
}

/** Sets a query parameter, replacing any existing spelling of the same key. */
export function setParamCaseInsensitive(
  params: URLSearchParams,
  name: string,
  value: string
): void {
  const target = name.toLowerCase();
  for (const key of [...params.keys()]) {
    if (key.toLowerCase() === target) params.delete(key);
  }
  params.set(name, value);
}

/**
 * Builds a `GetCapabilities` URL, preserving any vendor parameters already
 * present in the endpoint (INSPIRE proxies frequently rely on them).
 */
export function buildCapabilitiesUrl(
  baseUrl: string,
  options: { service?: OgcServiceType; version?: string } = {}
): string {
  const service = options.service ?? "WMS";
  const version = options.version ?? DEFAULT_VERSIONS[service];
  const url = new URL(baseUrl);
  setParamCaseInsensitive(url.searchParams, "SERVICE", service);
  setParamCaseInsensitive(url.searchParams, "REQUEST", "GetCapabilities");
  setParamCaseInsensitive(url.searchParams, "VERSION", version);
  return url.toString();
}

/**
 * Strips OGC request parameters from an endpoint, keeping vendor-specific ones.
 * Useful to derive a clean base URL from a capabilities link found in a portal.
 */
export function toBaseServiceUrl(url: string): string {
  const parsed = new URL(url);
  for (const key of [...parsed.searchParams.keys()]) {
    if (["service", "request", "version"].includes(key.toLowerCase())) {
      parsed.searchParams.delete(key);
    }
  }
  const query = parsed.searchParams.toString();
  return `${parsed.origin}${parsed.pathname}${query ? `?${query}` : ""}`;
}

/** Re-exported from `@orthogea/core` so harvester callers keep one import. */
export const applyProxy = applyCorsProxy;

/** Value types accepted as query parameters. */
export type QueryValue = string | number | boolean | undefined | null;

export interface BuildQueryUrlOptions {
  /**
   * Parameters inserted verbatim, without percent-encoding. Use for renderer
   * placeholders such as `{bbox-epsg-3857}`, `{z}`, `{x}` or `{y}`, which the
   * map library replaces at request time and must not be escaped.
   */
  rawParams?: Record<string, string>;
}

/**
 * Percent-encodes a query value the way OGC services expect it.
 *
 * Colons and commas are sub-delimiters, legal inside a query value, and OGC
 * requests are full of them (`CRS=EPSG:3857`, `BBOX=1,2,3,4`, `LAYERS=a,b`).
 * Escaping them is technically valid but several national services - the
 * Italian cadastre among them - answer with an error, so they are kept literal.
 */
export function encodeQueryValue(value: string): string {
  return encodeURIComponent(value).replace(/%2C/gi, ",").replace(/%3A/gi, ":");
}

/**
 * Appends query parameters to an endpoint, preserving whatever the service
 * already carries (INSPIRE proxies often need vendor parameters, and several
 * national endpoints end with a bare `?` or `&`).
 */
export function buildQueryUrl(
  baseUrl: string,
  params: Record<string, QueryValue>,
  options: BuildQueryUrlOptions = {}
): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    parts.push(`${key}=${encodeQueryValue(String(value))}`);
  }
  for (const [key, value] of Object.entries(options.rawParams ?? {})) {
    parts.push(`${key}=${value}`);
  }
  if (parts.length === 0) return baseUrl;

  const query = parts.join("&");
  if (/[?&]$/.test(baseUrl)) return `${baseUrl}${query}`;
  return `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${query}`;
}

/** `{bbox-epsg-3857}`, `{z}`, `{TileMatrix}`, ... after percent-encoding. */
const ENCODED_PLACEHOLDER_RE = /%7B([A-Za-z0-9_.:-]+)%7D/g;

/**
 * Restores renderer placeholders that percent-encoding would hide.
 *
 * MapLibre and OpenLayers look for the literal `{bbox-epsg-3857}` or `{z}`
 * token in a tile template; once encoded to `%7B...%7D` the substitution never
 * happens and the server receives the placeholder verbatim.
 */
export function restoreTilePlaceholders(url: string): string {
  return url.replace(ENCODED_PLACEHOLDER_RE, (_match, name: string) => `{${name}}`);
}

/**
 * Routes a URL through a CORS proxy.
 *
 * Supports both template proxies (`https://proxy/?target={url}`) and prefix
 * proxies (`https://proxy/` or `https://proxy/?url=`); the target is
 * percent-encoded whenever the proxy expects a parameter value, while tile
 * placeholders are kept literal so the renderer can still substitute them.
 */
export function applyCorsProxy(url: string, proxyUrl?: string): string {
  if (!proxyUrl) return url;
  if (proxyUrl.includes("{url}")) {
    return restoreTilePlaceholders(proxyUrl.replace("{url}", encodeURIComponent(url)));
  }
  if (proxyUrl.endsWith("=")) {
    return restoreTilePlaceholders(`${proxyUrl}${encodeURIComponent(url)}`);
  }
  return `${proxyUrl}${url}`;
}

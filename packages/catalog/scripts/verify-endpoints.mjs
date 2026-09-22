/**
 * Live check of every catalogued endpoint.
 *
 * For each layer the script runs a `GetCapabilities` request and then asks for
 * one real tile, so a silent change of layer name or CRS is caught as well as
 * an endpoint going offline.
 *
 * Usage:
 *   node scripts/verify-endpoints.mjs                 report only
 *   node scripts/verify-endpoints.mjs --strict        exit 1 when an active layer fails
 *   node scripts/verify-endpoints.mjs --id it.ade     only layers whose id contains "it.ade"
 *   node scripts/verify-endpoints.mjs --json out.json write a machine readable report
 *   node scripts/verify-endpoints.mjs --connect-timeout 60000  for a slow handshake
 */
import { writeFileSync } from "node:fs";
import { Agent, fetch as undiciFetch, setGlobalDispatcher } from "undici";
import { catalog } from "@orthogea/catalog";
import {
  bboxCenter,
  lngLatToTile,
  tileToBBox,
  tileToMercatorBBox,
  isSameCrs
} from "@orthogea/core";
import { checkEndpoint } from "@orthogea/harvester";
import {
  buildWmsGetMapUrl,
  buildWmtsTileUrlTemplate,
  buildXyzTileUrls,
  needsTileReprojection,
  pickReprojectionCrs
} from "@orthogea/client";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

const idFilter = value("--id");
const jsonOut = value("--json");
const strict = flag("--strict");
/**
 * 45 s, not the 25 s this used to default to.
 *
 * Raising the connect timeout alone only moved the Portuguese service's
 * failure from one clock to the other: its handshake takes 27-28 s, so the
 * request budget has to clear it too. Both are set to the same figure so there
 * is one number to reason about, and a genuinely dead endpoint still fails -
 * it just takes 45 s to say so, which a run you are watching can afford.
 */
const timeoutMs = Number(value("--timeout") ?? 45000);
const concurrency = Number(value("--concurrency") ?? 4);
const connectTimeoutMs = Number(value("--connect-timeout") ?? 45000);

/**
 * Node's built-in `fetch` gives up on a connection after 10 seconds and counts
 * the TLS handshake as part of it. `--timeout` cannot lift that: it drives an
 * `AbortController`, which only governs the request once connected.
 *
 * Some public services are simply slow to negotiate. The Portuguese DGT
 * orthophoto service completes DNS in 20 ms and TCP in 170 ms, then spends
 * 27 seconds on the handshake - so it reported as dead every single run while
 * answering perfectly well to anything patient enough, which is why both
 * timeouts are configured rather than left at their defaults.
 *
 * The dispatcher has to come from the `undici` package and be used with its
 * own `fetch`: `setGlobalDispatcher` here does not reach the copy of undici
 * built into Node, so the global `fetch` would keep the 10 second cap.
 */
const dispatcher = new Agent({
  connect: { timeout: connectTimeoutMs },
  headersTimeout: timeoutMs,
  bodyTimeout: timeoutMs
});
setGlobalDispatcher(dispatcher);

/** Patient `fetch`, used for every probe in this script. */
const patientFetch = (input, init = {}) => undiciFetch(input, { ...init, dispatcher });

const layers = catalog.filter((layer) => !idFilter || layer.id.includes(idFilter));

/** Builds a request for one real tile at the centre of the layer extent. */
function tileRequestUrl(layer) {
  const [lng, lat] = bboxCenter(layer.bbox);
  const zoom = Math.min(Math.max(layer.minZoom + 4, 8), layer.maxZoom, 16);
  const [x, y] = lngLatToTile(lng, lat, zoom);

  switch (layer.service.type) {
    case "WMS": {
      if (needsTileReprojection(layer)) {
        return buildWmsGetMapUrl(layer.service, {
          crs: pickReprojectionCrs(layer.service),
          bbox: tileToBBox(x, y, zoom),
          width: 256,
          height: 256
        });
      }
      const crs =
        layer.service.options.crs.find((code) => isSameCrs(code, "EPSG:3857")) ?? "EPSG:3857";
      return buildWmsGetMapUrl(layer.service, {
        crs,
        bbox: tileToMercatorBBox(x, y, zoom),
        width: 256,
        height: 256
      });
    }
    case "WMTS":
      return buildWmtsTileUrlTemplate(layer.service)
        .replace("{z}", String(zoom))
        .replace("{x}", String(x))
        .replace("{y}", String(y));
    case "XYZ": {
      // The TMS scheme numbers rows from the south, MapLibre flips them itself.
      const row = layer.service.options.scheme === "tms" ? Math.pow(2, zoom) - 1 - y : y;
      return buildXyzTileUrls(layer.service)[0]
        .replace("{z}", String(zoom))
        .replace("{x}", String(x))
        .replace("{y}", String(row));
    }
    default:
      return undefined;
  }
}

async function fetchTile(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await patientFetch(url, { signal: controller.signal });
    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") ?? "";
    const elapsedMs = Date.now() - startedAt;

    if (!response.ok) {
      return { ok: false, elapsedMs, error: `HTTP ${response.status}`, bytes: buffer.length };
    }
    if (!contentType.startsWith("image/")) {
      const text = buffer.toString("utf8", 0, 400).replace(/\s+/g, " ");
      return { ok: false, elapsedMs, error: `${contentType || "no content type"}: ${text.slice(0, 160)}` };
    }
    return { ok: true, elapsedMs, bytes: buffer.length, contentType };
  } catch (error) {
    return { ok: false, elapsedMs: Date.now() - startedAt, error: error.message };
  } finally {
    clearTimeout(timer);
  }
}

async function verify(layer) {
  const report = { id: layer.id, country: layer.country, service: layer.service.type };

  if (layer.service.type === "WMS" || layer.service.type === "WMTS") {
    const health = await checkEndpoint(layer.service.url, {
      service: layer.service.type,
      timeoutMs,
      parse: true,
      fetchImpl: patientFetch
    });
    report.capabilities = {
      ok: health.ok,
      status: health.status,
      responseTimeMs: health.responseTimeMs,
      layerCount: health.layerCount,
      error: health.error
    };
  }

  const url = tileRequestUrl(layer);
  if (url) {
    report.tile = { url, ...(await fetchTile(url)) };
  }

  report.ok = (report.capabilities?.ok ?? true) && (report.tile?.ok ?? true);
  return report;
}

const results = new Array(layers.length);
let cursor = 0;

async function worker() {
  while (cursor < layers.length) {
    const index = cursor++;
    const layer = layers[index];
    const report = await verify(layer);
    results[index] = report;
    const status = report.ok ? "OK  " : report.tile?.ok === false ? "TILE" : "CAPS";
    const detail = report.ok
      ? `${report.tile?.bytes ?? 0} B ${report.tile?.contentType ?? ""} in ${report.tile?.elapsedMs ?? 0} ms`
      : `${report.capabilities?.error ?? ""} ${report.tile?.error ?? ""}`.trim();
    console.log(`${status}  ${layer.id.padEnd(38)} ${detail.slice(0, 110)}`);
  }
}

await Promise.all(
  Array.from({ length: Math.min(concurrency, layers.length) }, () => worker())
);

const failed = results.filter((report) => !report.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} layers answered with a real tile`
);

if (jsonOut) {
  writeFileSync(jsonOut, `${JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2)}\n`);
  console.log(`Report written to ${jsonOut}`);
}

if (strict && failed.some((report) => catalog.find((l) => l.id === report.id)?.status === "active")) {
  process.exitCode = 1;
}

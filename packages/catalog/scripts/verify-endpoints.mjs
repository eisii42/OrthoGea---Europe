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
 */
import { writeFileSync } from "node:fs";
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
const timeoutMs = Number(value("--timeout") ?? 25000);
const concurrency = Number(value("--concurrency") ?? 4);

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
    const response = await fetch(url, { signal: controller.signal });
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
      parse: true
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

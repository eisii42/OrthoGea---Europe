import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  buildNutsTree,
  catalog,
  catalogStats,
  getLayer,
  type CatalogTreeNode
} from "@orthogea/catalog";
import { bboxCenter, bboxUnion, isQueryableLayer, type OrthoGeaLayer } from "@orthogea/core";
import {
  formatAttribution,
  getFeatureInfo,
  layerIdFor,
  needsTileReprojection,
  registerOrthoGeaProtocol,
  sourceIdFor,
  toRasterLayer,
  toRasterSource,
  type FeatureInfoResponse
} from "@orthogea/client";
import "./style.css";

/** Dev-only proxy exposed by vite.config.ts, see the CORS note in the README. */
const PROXY_URL = "/cors-proxy?url=";

const OVERLAY_CATEGORIES = new Set(["cadastre", "land_use", "elevation"]);
const isOverlay = (layer: OrthoGeaLayer): boolean => OVERLAY_CATEGORIES.has(layer.category);

const state = {
  baseId: "it.toscana.ortofoto-2013",
  overlayIds: new Set<string>(["it.ade.catasto-particelle"]),
  opacity: 1,
  proxy: true,
  search: ""
};

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id} in index.html`);
  return node as T;
};

const map: MapLibreMap = new maplibregl.Map({
  container: el("map"),
  style: {
    version: 8,
    sources: {},
    layers: [{ id: "background", type: "background", paint: { "background-color": "#0d1117" } }]
  },
  center: [11.2558, 43.7696],
  zoom: 13,
  hash: true,
  attributionControl: false
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
map.addControl(new maplibregl.ScaleControl({ maxWidth: 140, unit: "metric" }), "bottom-left");
const attributionControl = new maplibregl.AttributionControl({ compact: false });
map.addControl(attributionControl, "bottom-right");

/** Adapter options follow the proxy toggle, so both are rebuilt together. */
function adapterOptions() {
  return state.proxy ? { proxyUrl: PROXY_URL } : {};
}

function registerProtocol(): void {
  // Services without EPSG:3857 (the Italian cadastre, Croatia, Umbria, Marche)
  // are fetched through this protocol, which reprojects the tile extent.
  registerOrthoGeaProtocol(maplibregl, {
    layers: [...catalog],
    ...adapterOptions()
  });
}

registerProtocol();

// ---------------------------------------------------------------------------
// Map synchronisation
// ---------------------------------------------------------------------------
const addedLayerIds = new Set<string>();
const addedSourceIds = new Set<string>();

function clearMap(): void {
  for (const id of addedLayerIds) if (map.getLayer(id)) map.removeLayer(id);
  addedLayerIds.clear();
  for (const id of addedSourceIds) if (map.getSource(id)) map.removeSource(id);
  addedSourceIds.clear();
}

function addLayer(layer: OrthoGeaLayer, opacity: number): void {
  const sourceId = sourceIdFor(layer);
  const styleLayerId = layerIdFor(layer);
  try {
    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, toRasterSource(layer, adapterOptions()) as never);
      addedSourceIds.add(sourceId);
    }
    map.addLayer(toRasterLayer(layer, { opacity }) as never);
    addedLayerIds.add(styleLayerId);
  } catch (error) {
    console.error(`Could not add ${layer.id}`, error);
    reportError(`${layer.title}: ${(error as Error).message}`);
  }
}

function syncMap(): void {
  clearMap();

  const base = getLayer(state.baseId);
  if (base) addLayer(base, 1);

  for (const id of state.overlayIds) {
    const overlay = getLayer(id);
    if (overlay) addLayer(overlay, state.opacity);
  }

  updateAttribution();
}

function visibleLayers(): OrthoGeaLayer[] {
  const base = getLayer(state.baseId);
  const overlays = [...state.overlayIds]
    .map((id) => getLayer(id))
    .filter((layer): layer is OrthoGeaLayer => Boolean(layer));
  return base ? [base, ...overlays] : overlays;
}

function updateAttribution(): void {
  const stats = catalogStats();
  el("stats").innerHTML = `${stats.layers} layers · ${stats.countries} countries · verified ${
    stats.lastVerified ?? "-"
  }`;
  // MapLibre reads source.attribution, this line only mirrors it in the panel.
  const html = visibleLayers()
    .map((layer) => formatAttribution(layer))
    .join(" · ");
  el("layer-attribution").innerHTML = html;
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------
function matchesSearch(layer: OrthoGeaLayer): boolean {
  if (!state.search) return true;
  const needle = state.search.toLowerCase();
  return [layer.title, layer.regionName ?? "", layer.provider.name, layer.id, ...layer.tags]
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

function layerRow(layer: OrthoGeaLayer, kind: "base" | "overlay"): HTMLElement {
  const row = document.createElement("label");
  row.className = "layer";

  const input = document.createElement("input");
  input.type = kind === "base" ? "radio" : "checkbox";
  input.name = kind === "base" ? "base-layer" : layer.id;
  input.value = layer.id;
  input.checked =
    kind === "base" ? state.baseId === layer.id : state.overlayIds.has(layer.id);
  input.addEventListener("change", () => {
    if (kind === "base") {
      state.baseId = layer.id;
    } else if (input.checked) {
      state.overlayIds.add(layer.id);
    } else {
      state.overlayIds.delete(layer.id);
    }
    syncMap();
  });

  const text = document.createElement("span");
  text.className = "layer-text";
  const title = document.createElement("strong");
  title.textContent = layer.title;
  const meta = document.createElement("small");
  const badges: string[] = [layer.service.type];
  if (isQueryableLayer(layer)) badges.push("queryable");
  if (needsTileReprojection(layer)) badges.push("reprojected");
  if (layer.status !== "active") badges.push(layer.status);
  meta.textContent = `${layer.regionName ?? layer.country} · ${badges.join(" · ")}`;
  text.append(title, meta);

  row.append(input, text);
  return row;
}

function renderLayerLists(): void {
  const baseContainer = el("base-layers");
  const overlayContainer = el("overlays");
  baseContainer.replaceChildren();
  overlayContainer.replaceChildren();

  const sorted = [...catalog].sort((a, b) => a.title.localeCompare(b.title));
  for (const layer of sorted) {
    if (!matchesSearch(layer)) continue;
    const target = isOverlay(layer) ? overlayContainer : baseContainer;
    target.append(layerRow(layer, isOverlay(layer) ? "overlay" : "base"));
  }

  if (!baseContainer.childElementCount) {
    baseContainer.innerHTML = '<p class="empty">No base layer matches the search.</p>';
  }
  if (!overlayContainer.childElementCount) {
    overlayContainer.innerHTML = '<p class="empty">No overlay matches the search.</p>';
  }
}

function renderRegionSelect(): void {
  const select = el<HTMLSelectElement>("region-select");
  const tree = buildNutsTree();
  select.replaceChildren();

  const placeholder = new Option("Europe", "EU", true, true);
  select.append(placeholder);

  const walk = (node: CatalogTreeNode, depth: number): void => {
    for (const child of node.children) {
      const indent = "  ".repeat(depth);
      select.append(new Option(`${indent}${child.label} (${child.layerCount})`, child.code));
      walk(child, depth + 1);
    }
  };
  walk(tree, 0);

  select.addEventListener("change", () => {
    const code = select.value;
    const layers =
      code === "EU"
        ? [...catalog]
        : catalog.filter(
            (layer) => layer.nuts?.startsWith(code) || (!layer.nuts && layer.country === code)
          );
    if (layers.length === 0) return;

    const bounds = layers.map((layer) => layer.bbox).reduce((acc, bbox) => bboxUnion(acc, bbox));
    const orthophoto = layers.find((layer) => layer.category === "orthophoto");
    if (orthophoto) {
      state.baseId = orthophoto.id;
      renderLayerLists();
      syncMap();
    }
    map.fitBounds(
      [
        [bounds[0], bounds[1]],
        [bounds[2], bounds[3]]
      ],
      { padding: 40, duration: 800 }
    );
  });
}

// ---------------------------------------------------------------------------
// GetFeatureInfo
// ---------------------------------------------------------------------------
function renderFeatureInfo(responses: FeatureInfoResponse[], lngLat: maplibregl.LngLat): void {
  const panel = el("info-panel");
  const content = el("info-content");
  content.replaceChildren();

  const heading = document.createElement("h3");
  heading.textContent = `${lngLat.lat.toFixed(5)}, ${lngLat.lng.toFixed(5)}`;
  content.append(heading);

  if (responses.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No queryable layer returned a feature here.";
    content.append(empty);
  }

  for (const response of responses) {
    const block = document.createElement("section");
    const title = document.createElement("h4");
    title.textContent = getLayer(response.layerId)?.title ?? response.layerId;
    block.append(title);

    if (response.warning) {
      const warning = document.createElement("p");
      warning.className = "warning";
      warning.textContent = response.warning;
      block.append(warning);
    }

    let rendered = 0;
    for (const feature of response.features.slice(0, 5)) {
      const table = document.createElement("table");
      for (const [key, rawValue] of Object.entries(feature.properties).slice(0, 14)) {
        const value = String(rawValue ?? "");
        if (!value) continue;
        const row = table.insertRow();
        row.insertCell().textContent = key;
        row.insertCell().textContent = value;
      }
      if (table.rows.length > 0) {
        block.append(table);
        rendered += 1;
      }
    }

    if (rendered === 0 && response.features.length > 0) {
      const note = document.createElement("p");
      note.className = "empty";
      note.textContent = `${response.features.length} feature(s) here, but the service publishes no attributes in ${response.format}.`;
      block.append(note);
    }

    if (response.features.length === 0 && response.html) {
      const raw = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "Raw server response";
      const pre = document.createElement("pre");
      pre.textContent = response.raw.slice(0, 2000);
      raw.append(summary, pre);
      block.append(raw);
    }

    content.append(block);
  }

  panel.hidden = false;
}

function reportError(message: string): void {
  const panel = el("info-panel");
  const content = el("info-content");
  content.replaceChildren();
  const paragraph = document.createElement("p");
  paragraph.className = "warning";
  paragraph.textContent = message;
  content.append(paragraph);
  panel.hidden = false;
}

map.on("click", async (event) => {
  const queryable = visibleLayers().filter((layer) => isQueryableLayer(layer));
  if (queryable.length === 0) return;

  const bounds = map.getBounds();
  const canvas = map.getCanvas();
  const query = {
    lngLat: [event.lngLat.lng, event.lngLat.lat] as [number, number],
    bbox: [
      bounds.getWest(),
      bounds.getSouth(),
      bounds.getEast(),
      bounds.getNorth()
    ] as [number, number, number, number],
    width: canvas.clientWidth,
    height: canvas.clientHeight,
    zoom: map.getZoom(),
    featureCount: 5
  };

  el("info-content").innerHTML = '<p class="empty">Querying…</p>';
  el("info-panel").hidden = false;

  const settled = await Promise.allSettled(
    queryable.map((layer) => getFeatureInfo(layer, query, adapterOptions()))
  );

  const responses = settled
    .filter((result): result is PromiseFulfilledResult<FeatureInfoResponse> => result.status === "fulfilled")
    .map((result) => result.value)
    .filter((response) => response.features.length > 0 || response.warning || response.html);

  renderFeatureInfo(responses, event.lngLat);
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
el("search").addEventListener("input", (event) => {
  state.search = (event.target as HTMLInputElement).value;
  renderLayerLists();
});

el("opacity").addEventListener("input", (event) => {
  state.opacity = Number((event.target as HTMLInputElement).value) / 100;
  el("opacity-value").textContent = `${Math.round(state.opacity * 100)}%`;
  for (const id of state.overlayIds) {
    const layer = getLayer(id);
    if (layer && map.getLayer(layerIdFor(layer))) {
      map.setPaintProperty(layerIdFor(layer), "raster-opacity", state.opacity);
    }
  }
});

el("use-proxy").addEventListener("change", (event) => {
  state.proxy = (event.target as HTMLInputElement).checked;
  registerProtocol();
  syncMap();
});

el("info-close").addEventListener("click", () => {
  el("info-panel").hidden = true;
});

map.on("load", () => {
  renderRegionSelect();
  renderLayerLists();
  syncMap();
});

map.on("error", (event) => {
  // Tile errors are common with national services behind strict CORS rules.
  console.warn("MapLibre error", event.error?.message ?? event);
});

// Expose a few handles for console experiments during a demo.
Object.assign(window, { map, catalog, state, bboxCenter });

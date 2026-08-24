import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  DEFAULT_SATELLITE_FALLBACK_ID,
  buildNutsTree,
  catalog,
  catalogStats,
  getLayer,
  type CatalogTreeNode
} from "@orthogea/catalog";
import {
  bboxCenter,
  bboxUnion,
  isQueryableLayer,
  lngLatToTile,
  type OrthoGeaLayer
} from "@orthogea/core";
import {
  DEFAULT_ORTHOPHOTO_FROM_ZOOM,
  createMosaic,
  formatAttribution,
  getFeatureInfo,
  registerMosaicProtocol,
  toMosaicRasterSource,
  type Mosaic,
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

/** Special base-layer id: the seamless, self-selecting imagery mosaic. */
const MOSAIC_ID = "orthogea:mosaic";

const state = {
  baseId: MOSAIC_ID,
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
  attributionControl: false,
  // Keep more tiles around: panning back over an area is then instant, which
  // matters far more than memory on a slow connection.
  maxTileCacheSize: 512,
  refreshExpiredTiles: false,
  fadeDuration: 120
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
map.addControl(new maplibregl.ScaleControl({ maxWidth: 140, unit: "metric" }), "bottom-left");
// Compact by default: the map is the point, not a wall of credits. The full
// list stays one click away, and in the sidebar panel.
let attributionControl = new maplibregl.AttributionControl({ compact: true });
map.addControl(attributionControl, "bottom-right");

/** Adapter options follow the proxy toggle, so both are rebuilt together. */
function adapterOptions() {
  return state.proxy ? { proxyUrl: PROXY_URL } : {};
}

/** Layer currently drawn by the mosaic, shown in the sidebar. */
let mosaic: Mosaic;
let lastMosaicLayer: OrthoGeaLayer | undefined;
let mosaicLabelTimer: number | undefined;

function registerProtocol(): void {
  // Services without EPSG:3857 (the Italian cadastre, Croatia, Umbria, Marche)
  // are fetched through this protocol, which reprojects the tile extent.
  registerOrthoGeaProtocol(maplibregl, {
    layers: [...catalog],
    ...adapterOptions()
  });

  // One seamless imagery layer: the best official orthophoto per tile above
  // zoom 12, the Copernicus Sentinel-2 mosaic below it and wherever no
  // orthophoto exists.
  mosaic = createMosaic({
    layers: [...catalog],
    fallback: DEFAULT_SATELLITE_FALLBACK_ID,
    ...adapterOptions(),
    onTile: ({ layer }) => {
      if (layer.id === lastMosaicLayer?.id) return;
      lastMosaicLayer = layer;
      window.clearTimeout(mosaicLabelTimer);
      mosaicLabelTimer = window.setTimeout(updateMosaicLabel, 120);
    }
  });
  registerMosaicProtocol(maplibregl, mosaic);
}

function updateMosaicLabel(): void {
  const label = document.getElementById("mosaic-source");
  if (label) {
    label.textContent =
      state.baseId === MOSAIC_ID && lastMosaicLayer ? `drawing: ${lastMosaicLayer.title}` : "";
  }
  if (state.baseId !== MOSAIC_ID) return;

  // MapLibre reads source.attribution once, so the control is refreshed by
  // hand as the mosaic starts drawing from new providers.
  map.removeControl(attributionControl);
  attributionControl = new maplibregl.AttributionControl({
    compact: true,
    customAttribution: mosaic.activeAttribution({}, 25_000)
  });
  map.addControl(attributionControl, "bottom-right");
  updateAttribution();
}

registerProtocol();

// ---------------------------------------------------------------------------
// Map synchronisation
// ---------------------------------------------------------------------------
interface MapEntry {
  styleLayerId: string;
  sourceId: string;
  source: unknown;
  styleLayer: unknown;
  opacity: number;
}

/** Style layers currently on the map, in draw order. */
let currentEntries: MapEntry[] = [];

function mosaicEntry(): MapEntry {
  const sourceId = "orthogea-mosaic";
  return {
    styleLayerId: `${sourceId}-raster`,
    sourceId,
    source: toMosaicRasterSource(mosaic),
    styleLayer: {
      id: `${sourceId}-raster`,
      type: "raster",
      source: sourceId,
      paint: { "raster-opacity": 1, "raster-fade-duration": 120 }
    },
    opacity: 1
  };
}

function layerEntry(layer: OrthoGeaLayer, opacity: number): MapEntry | undefined {
  try {
    return {
      styleLayerId: layerIdFor(layer),
      sourceId: sourceIdFor(layer),
      source: toRasterSource(layer, adapterOptions()),
      styleLayer: toRasterLayer(layer, { opacity }),
      opacity
    };
  } catch (error) {
    console.error(`Could not add ${layer.id}`, error);
    reportError(`${layer.title}: ${(error as Error).message}`);
    return undefined;
  }
}

function desiredEntries(): MapEntry[] {
  const entries: MapEntry[] = [];

  if (state.baseId === MOSAIC_ID) {
    entries.push(mosaicEntry());
  } else {
    const base = getLayer(state.baseId);
    const entry = base ? layerEntry(base, 1) : undefined;
    if (entry) entries.push(entry);
  }

  for (const id of state.overlayIds) {
    const overlay = getLayer(id);
    const entry = overlay ? layerEntry(overlay, state.opacity) : undefined;
    if (entry) entries.push(entry);
  }

  return entries;
}

/**
 * Applies the difference between what is on the map and what should be.
 *
 * Rebuilding everything on each toggle used to drop the imagery source and its
 * tiles, so unticking an overlay made the orthophoto blink away while it was
 * fetched again. Only what actually changed is touched now.
 */
function syncMap(): void {
  const next = desiredEntries();
  const nextIds = new Set(next.map((entry) => entry.styleLayerId));

  for (const entry of currentEntries) {
    if (nextIds.has(entry.styleLayerId)) continue;
    if (map.getLayer(entry.styleLayerId)) map.removeLayer(entry.styleLayerId);
    if (map.getSource(entry.sourceId)) map.removeSource(entry.sourceId);
  }

  next.forEach((entry, index) => {
    if (!map.getSource(entry.sourceId)) map.addSource(entry.sourceId, entry.source as never);

    if (!map.getLayer(entry.styleLayerId)) {
      map.addLayer(entry.styleLayer as never);
    } else if (entry.styleLayerId !== "orthogea-mosaic-raster") {
      map.setPaintProperty(entry.styleLayerId, "raster-opacity", entry.opacity);
    }

    // Keep the requested draw order without touching the sources.
    const above = next[index - 1]?.styleLayerId;
    if (above && map.getLayer(entry.styleLayerId)) map.moveLayer(entry.styleLayerId);
  });

  currentEntries = next;
  updateAttribution();
}

function visibleLayers(): OrthoGeaLayer[] {
  const base = state.baseId === MOSAIC_ID ? mosaicLayerAtCentre() : getLayer(state.baseId);
  const overlays = [...state.overlayIds]
    .map((id) => getLayer(id))
    .filter((layer): layer is OrthoGeaLayer => Boolean(layer));
  return base ? [base, ...overlays] : overlays;
}

/**
 * Imagery the mosaic is drawing. The layer actually served wins over the first
 * candidate, because a source can be skipped for being empty over this area.
 */
function mosaicLayerAtCentre(): OrthoGeaLayer | undefined {
  if (lastMosaicLayer) return lastMosaicLayer;
  const zoom = Math.round(map.getZoom());
  const centre = map.getCenter();
  const [x, y] = lngLatToTile(centre.lng, centre.lat, zoom);
  return mosaic.bestFor(x, y, zoom);
}

function updateAttribution(): void {
  const stats = catalogStats();
  el("stats").innerHTML = `${stats.layers} layers · ${stats.countries} countries · verified ${
    stats.lastVerified ?? "-"
  }`;
  const shown =
    state.baseId === MOSAIC_ID
      ? [...mosaic.activeSources(25_000), ...visibleLayers().slice(1)]
      : visibleLayers();
  el("layer-attribution").innerHTML = [...new Set(shown.map((layer) => formatAttribution(layer)))]
    .join(" · ");
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

function mosaicRow(): HTMLElement {
  const row = document.createElement("label");
  row.className = "layer layer-mosaic";

  const input = document.createElement("input");
  input.type = "radio";
  input.name = "base-layer";
  input.value = MOSAIC_ID;
  input.checked = state.baseId === MOSAIC_ID;
  input.addEventListener("change", () => {
    state.baseId = MOSAIC_ID;
    syncMap();
    renderLayerLists();
  });

  const text = document.createElement("span");
  text.className = "layer-text";
  const title = document.createElement("strong");
  title.textContent = "Seamless imagery (recommended)";
  const meta = document.createElement("small");
  meta.textContent = `Copernicus VHR 2021 across Europe, orthophotos from z${DEFAULT_ORTHOPHOTO_FROM_ZOOM}`;
  const source = document.createElement("small");
  source.id = "mosaic-source";
  source.className = "mosaic-source";
  text.append(title, meta, source);

  row.append(input, text);
  return row;
}

function renderLayerLists(): void {
  const baseContainer = el("base-layers");
  const overlayContainer = el("overlays");
  baseContainer.replaceChildren();
  overlayContainer.replaceChildren();

  if (!state.search) baseContainer.append(mosaicRow());

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
    // With the mosaic active there is nothing to switch: it already picks the
    // best imagery for wherever the map goes.
    const orthophoto = layers.find((layer) => layer.category === "orthophoto");
    if (orthophoto && state.baseId !== MOSAIC_ID) {
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

map.on("moveend", () => {
  if (state.baseId === MOSAIC_ID) updateMosaicLabel();
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
Object.assign(window, { map, catalog, state, bboxCenter, getMosaic: () => mosaic });

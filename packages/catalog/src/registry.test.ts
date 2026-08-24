import { describe, expect, it } from "vitest";
import {
  GeoBoundingBoxSchema,
  LayerCollectionSchema,
  isQueryableLayer,
  isSameCrs,
  nutsCountry
} from "@orthogea/core";
import { RAW_COLLECTIONS } from "./data.js";
import {
  DEFAULT_SATELLITE_FALLBACK_ID,
  bestOrthophotoFor,
  catalog,
  catalogStats,
  collections,
  findLayers,
  getLayer,
  getLayers,
  groupByCategory,
  groupByCountry,
  hasLayer,
  imageryStackFor,
  layersForPoint,
  registerCollection,
  safeBuildCatalog
} from "./registry.js";
import { buildNutsTree, flattenTree } from "./tree.js";

describe("schema validation", () => {
  it("validates every bundled JSON file against the Zod schema", () => {
    const result = safeBuildCatalog();
    expect(result.issues).toEqual([]);
    expect(result.collections).toHaveLength(Object.keys(RAW_COLLECTIONS).length);
  });

  it.each(Object.keys(RAW_COLLECTIONS))("%s parses on its own", (file) => {
    const parsed = LayerCollectionSchema.safeParse(RAW_COLLECTIONS[file]);
    expect(parsed.success).toBe(true);
  });

  it("bundles a non-trivial catalogue", () => {
    expect(catalog.length).toBeGreaterThanOrEqual(44);
    expect(collections.length).toBeGreaterThanOrEqual(20);
  });

  it("keeps every id unique", () => {
    const ids = catalog.map((layer) => layer.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("ships the reference layers the framework is documented with", () => {
    for (const id of [
      "eu.copernicus.vhr-2021",
      "it.ade.catasto-particelle",
      "it.toscana.ortofoto-2024",
      "es.ign.pnoa-ma",
      "fr.ign.bdortho"
    ]) {
      expect(hasLayer(id), `${id} is missing`).toBe(true);
    }
  });
});

describe("record hygiene", () => {
  it("prefixes every id with its country scope", () => {
    for (const layer of catalog) {
      expect(layer.id.startsWith(`${layer.country.toLowerCase()}.`), layer.id).toBe(true);
    }
  });

  it("carries a valid extent, attribution and verification date", () => {
    for (const layer of catalog) {
      expect(GeoBoundingBoxSchema.safeParse(layer.bbox).success, layer.id).toBe(true);
      expect(layer.attribution.length, layer.id).toBeGreaterThan(2);
      expect(layer.lastVerified, layer.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(layer.service.url.startsWith("http"), layer.id).toBe(true);
    }
  });

  it("keeps NUTS codes consistent with the country", () => {
    for (const layer of catalog) {
      if (!layer.nuts) continue;
      expect(nutsCountry(layer.nuts), layer.id).toBe(layer.country);
    }
  });

  it("tags the WMS layers that cannot be requested in EPSG:3857", () => {
    for (const layer of catalog) {
      if (layer.service.type !== "WMS") continue;
      const supportsMercator = layer.service.options.crs.some((crs) =>
        isSameCrs(crs, "EPSG:3857")
      );
      expect(supportsMercator === !layer.tags.includes("no-3857"), layer.id).toBe(true);
    }
  });

  it("declares an info format for every queryable layer", () => {
    for (const layer of catalog) {
      if (layer.service.type !== "WMS" && layer.service.type !== "WMTS") continue;
      if (!isQueryableLayer(layer)) continue;
      expect(layer.service.options.infoFormats.length, layer.id).toBeGreaterThan(0);
    }
  });

  it("names every custom licence", () => {
    for (const layer of catalog) {
      if (layer.license.id !== "custom") continue;
      expect(layer.license.name, layer.id).toBeTruthy();
    }
  });
});

describe("queries", () => {
  it("filters by country and category", () => {
    const italian = findLayers({ country: "IT" });
    expect(italian.length).toBeGreaterThanOrEqual(18);
    expect(italian.every((layer) => layer.country === "IT")).toBe(true);

    const cadastre = findLayers({ category: "cadastre" });
    expect(cadastre.map((layer) => layer.id)).toContain("it.ade.catasto-particelle");
    expect(cadastre.every((layer) => layer.category === "cadastre")).toBe(true);
  });

  it("filters by NUTS code, including descendants", () => {
    expect(findLayers({ nuts: "ITI1" }).map((layer) => layer.id)).toContain(
      "it.toscana.ortofoto-2024"
    );
    // ITI is the NUTS-1 parent of Toscana, Umbria, Marche and Lazio.
    const centro = findLayers({ nuts: "ITI" }).map((layer) => layer.id);
    expect(centro).toContain("it.toscana.ortofoto-2024");
    expect(centro).toContain("it.lazio.agea-2023");
    expect(centro).not.toContain("it.sicilia.ortofoto-2022");
  });

  it("filters by service type, tags, status and queryability", () => {
    expect(findLayers({ service: "WMTS" }).length).toBeGreaterThanOrEqual(2);
    expect(findLayers({ tags: ["agea"] }).length).toBeGreaterThanOrEqual(5);
    expect(findLayers({ status: "experimental" }).length).toBeGreaterThanOrEqual(1);
    expect(findLayers({ queryable: true }).every((layer) => isQueryableLayer(layer))).toBe(true);
  });

  it("searches free text over title, description and tags", () => {
    expect(findLayers({ text: "copernicus" }).length).toBeGreaterThanOrEqual(3);
    expect(findLayers({ text: "geoscopio" }).map((layer) => layer.id)).toEqual([
      "it.toscana.ortofoto-2024"
    ]);
  });

  it("filters by extent and zoom", () => {
    const florence = findLayers({ point: { lng: 11.2558, lat: 43.7696 } });
    expect(florence.map((layer) => layer.id)).toContain("it.toscana.ortofoto-2024");
    expect(florence.map((layer) => layer.id)).not.toContain("es.ign.pnoa-ma");

    const box = findLayers({ bbox: [11, 43, 12, 44] });
    expect(box.map((layer) => layer.id)).toContain("it.ade.catasto-particelle");
    expect(findLayers({ zoom: 3 }).every((layer) => layer.minZoom <= 3)).toBe(true);
  });

  it("resolves ids in bulk and ignores the unknown ones", () => {
    expect(getLayers(["it.toscana.ortofoto-2024", "nope"]).map((layer) => layer.id)).toEqual([
      "it.toscana.ortofoto-2024"
    ]);
    expect(getLayer("nope")).toBeUndefined();
  });
});

describe("layersForPoint", () => {
  it("ranks the most local source first", () => {
    const ids = layersForPoint(11.2558, 43.7696, { category: "orthophoto" }).map(
      (layer) => layer.id
    );
    // Ranking uses declared extents, which are rectangles: Firenze also falls
    // inside the Emilia-Romagna bounding box, so regional layers share the top.
    expect(ids.slice(0, 3)).toContain("it.toscana.ortofoto-2024");
    // Only regional orthophotos remain over Italy: the national mosaics were
    // dropped in favour of a single European background.
    expect(ids.every((id) => id.startsWith("it."))).toBe(true);
  });

  it("returns nothing over the ocean for national layers", () => {
    expect(layersForPoint(-40, 20, { country: "IT" })).toEqual([]);
  });
});

describe("grouping, stats and tree", () => {
  it("groups by country and category", () => {
    expect(groupByCountry().get("IT")?.length).toBeGreaterThanOrEqual(18);
    expect(groupByCategory().get("orthophoto")?.length).toBeGreaterThanOrEqual(25);
  });

  it("summarises the catalogue", () => {
    const stats = catalogStats();
    expect(stats.layers).toBe(catalog.length);
    expect(stats.countries).toBeGreaterThanOrEqual(18);
    expect(stats.byService["WMS"]).toBeGreaterThan(28);
    expect(stats.lastVerified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("builds the NUTS hierarchy", () => {
    const tree = buildNutsTree();
    expect(tree.code).toBe("EU");
    expect(tree.layerCount).toBe(catalog.length);
    expect(tree.layers.length).toBeGreaterThanOrEqual(3);

    const italy = tree.children.find((child) => child.code === "IT");
    expect(italy?.label).toBe("Italy");
    expect(italy?.layers.length).toBeGreaterThanOrEqual(3);

    const centro = italy?.children.find((child) => child.code === "ITI");
    const toscana = centro?.children.find((child) => child.code === "ITI1");
    expect(toscana?.label).toBe("Toscana");
    expect(toscana?.layers.map((layer) => layer.id)).toEqual(["it.toscana.ortofoto-2024"]);

    const flat = flattenTree(tree);
    expect(flat[0]).toMatchObject({ code: "EU", depth: 0 });
    expect(flat.some((entry) => entry.code === "ITI1" && entry.depth === 3)).toBe(true);
  });
});

describe("registerCollection", () => {
  it("accepts a valid external collection", () => {
    const before = catalog.length;
    const result = registerCollection(
      {
        scope: "XX",
        title: "Test collection",
        layers: [
          {
            id: "it.test.custom-layer",
            title: "Custom test layer",
            category: "custom",
            provider: { name: "Test provider" },
            country: "IT",
            bbox: [9, 43, 12, 45],
            service: {
              type: "XYZ",
              url: "https://tiles.example.org",
              options: { urlTemplate: "https://tiles.example.org/{z}/{x}/{y}.png" }
            },
            license: { id: "CC-BY-4.0" },
            attribution: "Test provider"
          }
        ]
      },
      "test.json"
    );

    expect(result.issues).toEqual([]);
    expect(result.layers).toHaveLength(1);
    expect(catalog.length).toBe(before + 1);
    expect(getLayer("it.test.custom-layer")?.title).toBe("Custom test layer");
  });

  it("reports duplicates and invalid documents instead of throwing", () => {
    const duplicate = registerCollection(
      {
        scope: "XX",
        title: "Duplicate",
        layers: [{ ...JSON.parse(JSON.stringify(getLayer("it.test.custom-layer"))) }]
      },
      "dup.json"
    );
    expect(duplicate.layers).toHaveLength(0);
    expect(duplicate.issues[0]?.message).toContain("Duplicate layer id");

    const broken = safeBuildCatalog({ "broken.json": { scope: "XX" } });
    expect(broken.issues.length).toBeGreaterThan(0);
    expect(broken.layers).toHaveLength(0);
  });
});

describe("imagery selection", () => {
  it("returns the most local orthophoto for a coordinate", () => {
    expect(bestOrthophotoFor(11.2558, 43.7696)?.country).toBe("IT");
    expect(bestOrthophotoFor(2.35, 48.85)?.id).toBe("fr.ign.bdortho");
    expect(bestOrthophotoFor(-3.7, 40.41)?.id).toBe("es.ign.pnoa-ma");
  });

  it("falls back to the pan-European mosaic outside the catalogued coverage", () => {
    expect(bestOrthophotoFor(-30, 64)?.id).toBe(DEFAULT_SATELLITE_FALLBACK_ID);
    expect(bestOrthophotoFor(-30, 64, { fallback: false })).toBeUndefined();
  });

  it("builds a stack ending with the fallback", () => {
    const stack = imageryStackFor(11.2558, 43.7696).map((layer) => layer.id);
    expect(stack[0]).toMatch(/^it\./);
    expect(stack.at(-1)).toBe(DEFAULT_SATELLITE_FALLBACK_ID);
    expect(new Set(stack).size).toBe(stack.length);
  });
});

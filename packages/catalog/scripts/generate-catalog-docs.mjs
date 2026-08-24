/**
 * Regenerates docs/CATALOG.md from the catalogue itself, so the published
 * table can never drift from the data.
 *
 * Usage: pnpm --filter @orthogea/catalog docs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { catalog, catalogStats, buildNutsTree, flattenTree } from "@orthogea/catalog";
import { isQueryableLayer, isSameCrs, nutsCountryName } from "@orthogea/core";

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, "..", "..", "..", "docs", "CATALOG.md");

const stats = catalogStats();
const escape = (value) => String(value ?? "").replace(/\|/g, "\\|");

const badges = (layer) => {
  const list = [layer.service.type];
  if (isQueryableLayer(layer)) list.push("queryable");
  if (
    layer.service.type === "WMS" &&
    !layer.service.options.crs.some((crs) => isSameCrs(crs, "EPSG:3857"))
  ) {
    list.push("needs reprojection");
  }
  if (layer.status !== "active") list.push(layer.status);
  return list.join(", ");
};

const scopeLabel = (layer) =>
  layer.country === "EU"
    ? "Europe"
    : `${nutsCountryName(layer.country) ?? layer.country}${
        layer.regionName ? ` - ${layer.regionName}` : ""
      }`;

const grouped = new Map();
for (const layer of [...catalog].sort((a, b) => a.id.localeCompare(b.id))) {
  const key = layer.country;
  grouped.set(key, [...(grouped.get(key) ?? []), layer]);
}

const lines = [
  "# Catalogue",
  "",
  "Generated from `packages/catalog/data/*.json` - do not edit by hand, run",
  "`pnpm --filter @orthogea/catalog docs` after changing the data.",
  "",
  `**${stats.layers} layers · ${stats.countries} scopes · ${stats.queryable} queryable · last verified ${stats.lastVerified}**`,
  "",
  "| Category | Layers |",
  "| --- | --- |",
  ...Object.entries(stats.byCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => `| ${category} | ${count} |`),
  "",
  "| Service | Layers |",
  "| --- | --- |",
  ...Object.entries(stats.byService)
    .sort((a, b) => b[1] - a[1])
    .map(([service, count]) => `| ${service} | ${count} |`),
  ""
];

for (const [country, layers] of [...grouped.entries()].sort(([a], [b]) =>
  a === "EU" ? -1 : b === "EU" ? 1 : a.localeCompare(b)
)) {
  lines.push(
    `## ${country === "EU" ? "Pan-European" : nutsCountryName(country) ?? country} (${country})`,
    "",
    "| Id | Title | Scope | Category | Service | Licence | Provider |",
    "| --- | --- | --- | --- | --- | --- | --- |"
  );
  for (const layer of layers) {
    lines.push(
      `| \`${layer.id}\` | ${escape(layer.title)} | ${escape(scopeLabel(layer))} | ${
        layer.category
      } | ${escape(badges(layer))} | ${escape(layer.license.name ?? layer.license.id)} | ${escape(
        layer.provider.shortName ?? layer.provider.name
      )} |`
    );
  }
  lines.push("");
}

const tree = flattenTree(buildNutsTree());
lines.push(
  "## NUTS tree",
  "",
  "```",
  ...tree.map(
    (node) => `${"  ".repeat(node.depth)}${node.code.padEnd(6)} ${node.label} (${node.layerCount})`
  ),
  "```",
  ""
);

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${lines.join("\n")}`, "utf8");
console.log(`Wrote ${target} (${stats.layers} layers)`);

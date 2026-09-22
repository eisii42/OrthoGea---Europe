/**
 * Finds records whose advertised extent overhangs into a neighbour.
 *
 * A service publishes the bounding rectangle of its region, and no region is a
 * rectangle. The hull therefore covers ground the service holds no imagery
 * for, and because "most local first" ranks on area, a small hull overhanging
 * a large one wins for points it cannot serve: Emilia-Romagna's hull reaches
 * past Florence, Sweden's reaches Copenhagen.
 *
 * The cure is a `coverage` on the offending record - a few boxes approximating
 * the real footprint, which containment and ranking use instead of the hull.
 * This script says which records are worth the effort and how much ground is
 * at stake, so the work can be prioritised rather than guessed at.
 *
 * Usage:
 *   node scripts/audit-coverage.mjs                 report every suspect pair
 *   node scripts/audit-coverage.mjs --json out.json write a machine readable report
 *   node scripts/audit-coverage.mjs --strict        exit 1 if any record regressed
 */
import { writeFileSync } from "node:fs";
import { catalog } from "@orthogea/catalog";
import { bboxAreaSqKm, layerCoversPoint } from "@orthogea/core";

const args = process.argv.slice(2);
const jsonOut = (() => {
  const index = args.indexOf("--json");
  return index === -1 ? undefined : args[index + 1];
})();
const strict = args.includes("--strict");

const imagery = catalog.filter(
  (layer) =>
    layer.category === "orthophoto" &&
    layer.status === "active" &&
    !layer.tags.includes("alternative")
);

const overlapArea = (a, b) => {
  const width = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const height = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  return width > 0 && height > 0 ? width * height : 0;
};

/**
 * Samples the overlap of two hulls and counts the points the smaller one wins
 * but cannot plausibly serve - it belongs to a different country or region.
 */
function contestedPoints(small, big) {
  const box = [
    Math.max(small.bbox[0], big.bbox[0]),
    Math.max(small.bbox[1], big.bbox[1]),
    Math.min(small.bbox[2], big.bbox[2]),
    Math.min(small.bbox[3], big.bbox[3])
  ];
  const STEPS = 12;
  let contested = 0;
  for (let i = 0; i <= STEPS; i++) {
    for (let j = 0; j <= STEPS; j++) {
      const lng = box[0] + ((box[2] - box[0]) * i) / STEPS;
      const lat = box[1] + ((box[3] - box[1]) * j) / STEPS;
      if (layerCoversPoint(small, lng, lat) && layerCoversPoint(big, lng, lat)) contested++;
    }
  }
  return { contested, total: (STEPS + 1) ** 2 };
}

const findings = [];
for (let i = 0; i < imagery.length; i++) {
  for (let j = i + 1; j < imagery.length; j++) {
    const a = imagery[i];
    const b = imagery[j];
    if (overlapArea(a.bbox, b.bbox) <= 0) continue;

    const [small, big] =
      bboxAreaSqKm(a.bbox) < bboxAreaSqKm(b.bbox) ? [a, b] : [b, a];
    // Two records for the same ground are not a conflict; a different
    // authority winning ground it does not hold is.
    const sameScope = small.country === big.country && small.nuts === big.nuts;
    if (sameScope) continue;

    const { contested, total } = contestedPoints(small, big);
    if (contested === 0) continue;

    findings.push({
      winner: small.id,
      winnerScope: small.nuts ?? small.country,
      loser: big.id,
      loserScope: big.nuts ?? big.country,
      crossBorder: small.country !== big.country,
      narrowed: Boolean(small.coverage),
      contestedShare: Number((contested / total).toFixed(3))
    });
  }
}

findings.sort((a, b) => b.contestedShare - a.contestedShare);

const byWinner = new Map();
for (const finding of findings) {
  const entry = byWinner.get(finding.winner) ?? { conflicts: 0, crossBorder: 0, narrowed: finding.narrowed };
  entry.conflicts++;
  if (finding.crossBorder) entry.crossBorder++;
  byWinner.set(finding.winner, entry);
}

console.log(`Checked ${imagery.length} active orthophoto records.`);
console.log(`${findings.length} hull pairs contest ground across a country or region boundary.\n`);
console.log("Records whose hull wins ground belonging to someone else, worst first:");
const ranked = [...byWinner.entries()].sort((a, b) => b[1].conflicts - a[1].conflicts);
for (const [id, entry] of ranked) {
  const flag = entry.narrowed ? " [has coverage]" : "";
  console.log(
    `  ${id.padEnd(34)} ${String(entry.conflicts).padStart(2)} conflicts` +
      ` (${entry.crossBorder} cross-border)${flag}`
  );
}
console.log(
  `\nAdd a "coverage" array to a record to narrow it; see the field docs in` +
    ` @orthogea/core schemas/layer.ts.`
);

if (jsonOut) {
  writeFileSync(
    jsonOut,
    `${JSON.stringify({ checkedAt: new Date().toISOString(), findings }, null, 2)}\n`
  );
  console.log(`Report written to ${jsonOut}`);
}

// Only a record that already declares a coverage and still contests ground is
// a regression: the others are known, tracked work rather than a broken build.
const regressed = findings.filter((finding) => finding.narrowed);
if (strict && regressed.length > 0) {
  console.error(
    `\n${regressed.length} record(s) declare a coverage and still contest a neighbour:`
  );
  for (const finding of regressed) console.error(`  ${finding.winner} over ${finding.loser}`);
  process.exitCode = 1;
}

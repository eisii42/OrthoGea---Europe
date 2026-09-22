/**
 * Turns Natural Earth country outlines into the compact table shipped by
 * `@orthogea/core/boundaries`.
 *
 * Why this exists: a service publishes the bounding rectangle of the area it
 * covers, no country is a rectangle, and the catalogue ranks by extent - so a
 * small hull overhanging a large one wins for points it cannot serve. Knowing
 * which country a coordinate is actually in settles those cases, and nothing
 * short of real outlines can do it.
 *
 * The source is Natural Earth 1:50m Admin 0, which is public domain. 1:110m
 * was measured first and is six times smaller, but it places Geneva in France
 * - the Swiss enclave is below its resolution - and a confidently wrong answer
 * is worse here than no answer at all. 1:50m returned no wrong answer at any
 * precision tried.
 *
 * Coordinates are quantised to 1/100 degree, about 1.1 km, which is the vertex
 * spacing of the source: finer settings were measured and changed no result
 * while adding 50 % to the file. Each ring is delta encoded and written as
 * zigzag varints in a 64 character alphabet, which is what keeps the whole
 * world at roughly 240 kB rather than the 3 MB of the GeoJSON.
 *
 * The output is committed, so building the package needs no network. Re-run
 * this by hand when Natural Earth publishes a new edition.
 *
 * Usage:
 *   node scripts/build-boundaries.mjs                       download the source
 *   node scripts/build-boundaries.mjs path/to/ne_50m.geojson  use a local copy
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const outputPath = join(root, "src", "generated", "boundaries.json");

const SOURCE_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson";

/** Quantisation grid, in units per degree. */
const SCALE = 100;

/** Alphabet for the varint encoding; URL safe and free of JSON escaping. */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * Territories Natural Earth carries without an ISO code, mapped to the country
 * ISO 3166 assigns the ground to. Leaving them out would punch holes in the
 * lookup, and a hole reads as "no country" - which silently disables the very
 * disambiguation this table exists for.
 */
const UNCODED_TERRITORIES = { CYN: "CY", SOL: "SO" };

function encodeSigned(values) {
  let out = "";
  for (const raw of values) {
    let value = raw < 0 ? (-raw << 1) | 1 : raw << 1; // zigzag: small negatives stay short
    do {
      const chunk = value & 31;
      value >>>= 5;
      out += ALPHABET[value > 0 ? chunk | 32 : chunk];
    } while (value > 0);
  }
  return out;
}

const localPath = process.argv[2];
const source = JSON.parse(
  localPath
    ? readFileSync(localPath, "utf8")
    : await (async () => {
        console.log(`Downloading ${SOURCE_URL}`);
        const response = await fetch(SOURCE_URL);
        if (!response.ok) throw new Error(`Natural Earth returned HTTP ${response.status}`);
        return response.text();
      })()
);

const byCountry = new Map();
const skipped = [];
for (const feature of source.features) {
  const properties = feature.properties;
  // ISO_A2 is "-99" for France and Norway in every recent edition; ISO_A2_EH
  // is the field that carries their codes, and Kosovo's XK.
  const iso =
    properties.ISO_A2_EH !== "-99"
      ? properties.ISO_A2_EH
      : UNCODED_TERRITORIES[properties.ADM0_A3];
  if (!iso || iso === "-99") {
    skipped.push(properties.NAME);
    continue;
  }
  const geometry = feature.geometry;
  const polygons =
    geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.type === "MultiPolygon"
        ? geometry.coordinates
        : [];
  const bucket = byCountry.get(iso) ?? [];
  for (const polygon of polygons) bucket.push(polygon);
  byCountry.set(iso, bucket);
}

const countries = {};
let ringCount = 0;
let pointCount = 0;

for (const [iso, polygons] of [...byCountry.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const shapes = [];
  for (const polygon of polygons) {
    const rings = [];
    let outerSurvived = false;

    for (let index = 0; index < polygon.length; index++) {
      const numbers = [];
      let previousX = 0;
      let previousY = 0;
      let kept = 0;

      for (const [lng, lat] of polygon[index]) {
        const x = Math.round(lng * SCALE);
        const y = Math.round(lat * SCALE);
        if (kept > 0 && x === previousX && y === previousY) continue; // collapsed by quantising
        numbers.push(x - previousX, y - previousY);
        previousX = x;
        previousY = y;
        kept++;
      }

      // The outer ring decides whether the polygon survives at all. Dropping it
      // while keeping a hole would promote the hole to being the outline.
      if (kept < 4) {
        if (index === 0) {
          outerSurvived = false;
          break;
        }
        continue;
      }
      if (index === 0) outerSurvived = true;

      rings.push(encodeSigned(numbers));
      ringCount++;
      pointCount += kept;
    }

    if (outerSurvived && rings.length > 0) shapes.push(rings);
  }
  if (shapes.length > 0) countries[iso] = shapes;
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify({ scale: SCALE, alphabet: ALPHABET, countries })}\n`);

const bytes = readFileSync(outputPath).length;
console.log(
  `${Object.keys(countries).length} countries, ${ringCount} rings, ${pointCount} points ` +
    `-> src/generated/boundaries.json (${(bytes / 1024).toFixed(0)} kB)`
);
if (skipped.length > 0) {
  console.log(`Skipped, no ISO 3166 code: ${skipped.join(", ")}`);
}

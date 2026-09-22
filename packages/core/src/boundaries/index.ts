/**
 * `@orthogea/core/boundaries` - which country a coordinate is in.
 *
 * A separate entry point, and deliberately so. The rest of `@orthogea/core` is
 * arithmetic and string handling, because it sits on the drawing path of every
 * map that uses the framework. This module carries about 230 kB of country
 * outlines, which a map that only renders tiles has no reason to load. Import
 * it when you need the answer, and pay for it then.
 *
 * ```ts
 * import { countryAt } from "@orthogea/core/boundaries";
 * import { setCountryResolver } from "@orthogea/catalog";
 *
 * setCountryResolver(countryAt);   // once, at startup
 * ```
 *
 * What it is for: a service publishes the bounding rectangle of the area it
 * covers, no country is a rectangle, and the catalogue ranks candidates by
 * extent - so a small hull overhanging a large one wins for ground it holds no
 * imagery for. France's hull reaches Barcelona, Czechia's reaches Vienna,
 * Sweden's reaches Copenhagen. Knowing the real country settles all three.
 *
 * Accuracy: Natural Earth 1:50m, quantised to about 1.1 km. That is a
 * generalised outline, not a survey. It is good to a kilometre or so, which is
 * the scale the question is asked at - the nearest wrong border in every case
 * above is tens of kilometres away. Do not use it to decide which side of a
 * border a field is on.
 */

import boundaries from "../generated/boundaries.json" with { type: "json" };

interface EncodedBoundaries {
  scale: number;
  alphabet: string;
  countries: Record<string, string[][]>;
}

const table = boundaries as EncodedBoundaries;

type Ring = readonly (readonly [number, number])[];

interface Shape {
  readonly iso: string;
  /** Outer ring first, holes after. */
  readonly rings: readonly Ring[];
  readonly bbox: readonly [number, number, number, number];
}

const symbolValues = new Map<string, number>(
  [...table.alphabet].map((character, index) => [character, index])
);

/** Reverses the delta plus zigzag varint encoding written by the build script. */
function decodeRing(encoded: string, scale: number): Ring {
  const points: [number, number][] = [];
  let cursor = 0;
  let x = 0;
  let y = 0;

  while (cursor < encoded.length) {
    const delta: number[] = [];
    for (let axis = 0; axis < 2; axis++) {
      let value = 0;
      let shift = 0;
      let symbol: number;
      do {
        symbol = symbolValues.get(encoded[cursor++] as string) ?? 0;
        value |= (symbol & 31) << shift;
        shift += 5;
      } while (symbol & 32);
      delta.push(value & 1 ? -(value >>> 1) : value >>> 1);
    }
    x += delta[0] as number;
    y += delta[1] as number;
    points.push([x / scale, y / scale]);
  }

  return points;
}

/**
 * Decoded lazily, on the first lookup rather than at import.
 *
 * Importing the module should cost the JSON parse and nothing more; an
 * application that pulls it in behind a dynamic import and never calls it
 * should not pay for 99 000 points of ring decoding.
 */
let shapes: Shape[] | undefined;

function allShapes(): Shape[] {
  if (shapes) return shapes;
  const decoded: Shape[] = [];
  for (const [iso, polygons] of Object.entries(table.countries)) {
    for (const encodedRings of polygons) {
      const rings = encodedRings.map((ring) => decodeRing(ring, table.scale));
      const outer = rings[0] as Ring;
      let minLng = Infinity;
      let minLat = Infinity;
      let maxLng = -Infinity;
      let maxLat = -Infinity;
      for (const [lng, lat] of outer) {
        if (lng < minLng) minLng = lng;
        if (lat < minLat) minLat = lat;
        if (lng > maxLng) maxLng = lng;
        if (lat > maxLat) maxLat = lat;
      }
      decoded.push({ iso, rings, bbox: [minLng, minLat, maxLng, maxLat] });
    }
  }
  shapes = decoded;
  return decoded;
}

/** Ray casting: counts how often a ray to the east crosses the ring. */
function ringContains(ring: Ring, lng: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as readonly [number, number];
    const [xj, yj] = ring[j] as readonly [number, number];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function shapeContains(shape: Shape, lng: number, lat: number): boolean {
  const [minLng, minLat, maxLng, maxLat] = shape.bbox;
  if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) return false;
  if (!ringContains(shape.rings[0] as Ring, lng, lat)) return false;
  for (let hole = 1; hole < shape.rings.length; hole++) {
    if (ringContains(shape.rings[hole] as Ring, lng, lat)) return false;
  }
  return true;
}

/** Squared distance from a point to a segment, longitude scaled by latitude. */
function segmentDistanceSq(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  lngScale: number
): number {
  const dx = (bx - ax) * lngScale;
  const dy = by - ay;
  const wx = (px - ax) * lngScale;
  const wy = py - ay;
  const lengthSq = dx * dx + dy * dy;
  let t = lengthSq > 0 ? (wx * dx + wy * dy) / lengthSq : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = wx - t * dx;
  const cy = wy - t * dy;
  return cx * cx + cy * cy;
}

function ringDistanceSq(ring: Ring, lng: number, lat: number, lngScale: number): number {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as readonly [number, number];
    const [xj, yj] = ring[j] as readonly [number, number];
    const distance = segmentDistanceSq(lng, lat, xj, yj, xi, yi, lngScale);
    if (distance < best) best = distance;
  }
  return best;
}

/**
 * How far offshore a point may sit and still count as being in a country.
 *
 * Generalised coastlines cut corners, and a city on the water - Venice on its
 * lagoon, Copenhagen on the Oresund, Lisbon on the Tagus - lands a few hundred
 * metres outside its own country's outline. Without this, those coordinates
 * answer "no country", which quietly switches the disambiguation off exactly
 * where a coastal orthophoto is being chosen. Five kilometres covers the
 * generalisation without reaching across any border that matters.
 */
export const DEFAULT_COASTAL_TOLERANCE_KM = 5;

export interface CountryAtOptions {
  /**
   * Metres of slack, expressed in kilometres, for a point just off a
   * generalised coastline. Defaults to {@link DEFAULT_COASTAL_TOLERANCE_KM};
   * set `0` to demand that the point be strictly inside an outline.
   */
  toleranceKm?: number;
}

/**
 * The ISO 3166-1 alpha-2 country a coordinate falls in, or `undefined`.
 *
 * `undefined` means "cannot say", not "open sea", and callers are expected to
 * treat it as a reason to do nothing rather than a reason to exclude
 * something. Being silent is the safe answer: the outlines are generalised,
 * and a confidently wrong country would send a map to the wrong national
 * service.
 */
export function countryAt(
  lng: number,
  lat: number,
  options: CountryAtOptions = {}
): string | undefined {
  const candidates = allShapes();

  for (const shape of candidates) {
    if (shapeContains(shape, lng, lat)) return shape.iso;
  }

  const toleranceKm = options.toleranceKm ?? DEFAULT_COASTAL_TOLERANCE_KM;
  if (toleranceKm <= 0) return undefined;

  // Not strictly inside anything. Take the nearest outline within tolerance,
  // which is what rescues a coastal city from its own generalised shoreline.
  const toleranceDeg = toleranceKm / 111;
  const lngScale = Math.cos((lat * Math.PI) / 180);
  let best = Infinity;
  let nearest: string | undefined;

  for (const shape of candidates) {
    const [minLng, minLat, maxLng, maxLat] = shape.bbox;
    if (
      lng < minLng - toleranceDeg ||
      lng > maxLng + toleranceDeg ||
      lat < minLat - toleranceDeg ||
      lat > maxLat + toleranceDeg
    ) {
      continue;
    }
    const distance = ringDistanceSq(shape.rings[0] as Ring, lng, lat, lngScale);
    if (distance < best) {
      best = distance;
      nearest = shape.iso;
    }
  }

  return best <= toleranceDeg * toleranceDeg ? nearest : undefined;
}

/** True when the coordinate falls in the given ISO 3166-1 alpha-2 country. */
export function isPointInCountry(
  iso: string,
  lng: number,
  lat: number,
  options: CountryAtOptions = {}
): boolean {
  return countryAt(lng, lat, options) === iso;
}

/** Every ISO 3166-1 alpha-2 code the boundary table can return. */
export function boundedCountries(): string[] {
  return Object.keys(table.countries);
}

/**
 * `bestOrthophotoFor` against known ground.
 *
 * The function is the one-call entry point a portal uses to replace a
 * proprietary satellite basemap, so it is worth pinning to real coordinates
 * rather than to the shape of its return value. The previous test asserted
 * only that a point in Italy returned an Italian layer, which passes even when
 * the wrong region wins.
 */

import { describe, expect, it } from "vitest";
import { bestOrthophotoFor, DEFAULT_SATELLITE_FALLBACK_ID } from "./registry.js";
import { countryToNuts } from "@orthogea/core";

/** `[name, lng, lat, ISO 3166-1 country, NUTS region or null]`. */
type City = readonly [string, number, number, string, string | null];

const CITIES: readonly City[] = [
  ["Firenze", 11.2558, 43.7696, "IT", "ITI1"],
  ["Bologna", 11.3426, 44.4949, "IT", "ITH5"],
  ["Milano", 9.19, 45.4642, "IT", "ITC4"],
  ["Torino", 7.6869, 45.0703, "IT", "ITC1"],
  ["Roma", 12.4964, 41.9028, "IT", "ITI4"],
  ["Venezia", 12.3155, 45.4408, "IT", "ITH3"],
  ["Bari", 16.8719, 41.1171, "IT", "ITF4"],
  ["Palermo", 13.3615, 38.1157, "IT", "ITG1"],
  ["Cagliari", 9.1217, 39.2238, "IT", "ITG2"],
  ["Trento", 11.1211, 46.0748, "IT", "ITH2"],
  ["Bolzano", 11.3548, 46.4983, "IT", "ITH1"],
  ["Trieste", 13.7768, 45.6495, "IT", "ITH4"],
  ["Perugia", 12.3888, 43.1107, "IT", "ITI2"],
  ["Ancona", 13.5189, 43.6158, "IT", "ITI3"],
  ["Genova", 8.9463, 44.4056, "IT", "ITC3"],
  ["Briancon", 6.645, 44.899, "FR", null],
  ["Nice", 7.262, 43.7102, "FR", null],
  ["Paris", 2.3522, 48.8566, "FR", null],
  ["Lyon", 4.8357, 45.764, "FR", null],
  ["Madrid", -3.7038, 40.4168, "ES", null],
  ["Barcelona", 2.1734, 41.3851, "ES", null],
  ["Lisboa", -9.1393, 38.7223, "PT", null],
  ["Porto", -8.611, 41.1496, "PT", null],
  ["Berlin", 13.405, 52.52, "DE", null],
  ["Munchen", 11.582, 48.1351, "DE", null],
  ["Amsterdam", 4.9041, 52.3676, "NL", null],
  ["Bruxelles", 4.3517, 50.8503, "BE", null],
  ["Antwerpen", 4.4025, 51.2194, "BE", null],
  ["Luxembourg", 6.1296, 49.6116, "LU", null],
  ["Zurich", 8.5417, 47.3769, "CH", null],
  ["Geneve", 6.1432, 46.2044, "CH", null],
  ["Wien", 16.3738, 48.2082, "AT", null],
  ["Innsbruck", 11.4041, 47.2692, "AT", null],
  ["Praha", 14.4378, 50.0755, "CZ", null],
  ["Warszawa", 21.0122, 52.2297, "PL", null],
  ["Bratislava", 17.1077, 48.1486, "SK", null],
  ["Ljubljana", 14.5058, 46.0569, "SI", null],
  ["Zagreb", 15.9819, 45.815, "HR", null],
  ["Tallinn", 24.7536, 59.437, "EE", null],
  ["Kobenhavn", 12.5683, 55.6761, "DK", null],
  ["Stockholm", 18.0686, 59.3293, "SE", null]
];

/**
 * Points served by the wrong source, and the source they currently return.
 *
 * Every one of these is the same defect: a service extent is the bounding
 * rectangle of a region that is not rectangular, so the hull overhangs into a
 * neighbour and - being the smaller of the two - wins "most local first".
 * Emilia-Romagna's hull reaches past Florence, Sweden's reaches Copenhagen.
 *
 * They are listed rather than skipped so that the count cannot grow unnoticed
 * and so that authoring a `coverage` for one of these records makes this test
 * fail, which is the reminder to strike it off the list.
 */
const KNOWN_HULL_OVERHANGS: ReadonlyMap<string, string> = new Map([
  ["Firenze", "it.emilia-romagna.agea-2023"],
  ["Bari", "it.basilicata.ortofoto-2013"],
  ["Bolzano", "it.trento.ortofoto-2015"],
  ["Genova", "it.piemonte.agea-2024"],
  ["Briancon", "it.piemonte.agea-2024"],
  ["Barcelona", "fr.ign.bdortho"],
  ["Wien", "cz.cuzk.ortofoto"],
  ["Innsbruck", "de.bayern.dop"],
  ["Zagreb", "si.gurs.dof025"],
  ["Kobenhavn", "se.lantmateriet.ortofoto-025"]
]);

const sound = CITIES.filter(([name]) => !KNOWN_HULL_OVERHANGS.has(name));

describe("bestOrthophotoFor", () => {
  it.each(sound)("serves %s from its own country", (name, lng, lat, iso) => {
    const layer = bestOrthophotoFor(lng, lat);
    expect(layer, `${name} has no imagery at all`).toBeDefined();
    expect(layer?.country, `${name} -> ${layer?.id}`).toBe(iso);
  });

  it.each(sound.filter((city) => city[4] !== null))(
    "serves %s from its own region",
    (name, lng, lat, _iso, nuts) => {
      const layer = bestOrthophotoFor(lng, lat);
      // A national source legitimately covers a region; what must not happen
      // is a *different* region's source winning.
      if (!layer?.nuts) return;
      expect(layer.nuts, `${name} -> ${layer.id}`).toBe(nuts);
    }
  );

  it("still mis-serves exactly the documented overhangs, no more", () => {
    const observed = new Map<string, string>();
    for (const [name, lng, lat, iso, nuts] of CITIES) {
      const layer = bestOrthophotoFor(lng, lat);
      if (!layer) continue;
      const countryOk = layer.country === iso;
      const regionOk = nuts === null || !layer.nuts || layer.nuts === nuts;
      if (!countryOk || !regionOk) observed.set(name, layer.id);
    }
    expect(Object.fromEntries(observed)).toEqual(Object.fromEntries(KNOWN_HULL_OVERHANGS));
  });

  it("falls back to the European base where nothing is catalogued", () => {
    // Mid-Atlantic: no national orthophoto can cover this.
    expect(bestOrthophotoFor(-30, 64)?.id).toBe(DEFAULT_SATELLITE_FALLBACK_ID);
    expect(bestOrthophotoFor(-30, 64, { fallback: false })).toBeUndefined();
  });

  it("returns a layer whose NUTS scope matches its ISO country", () => {
    // Guards the ISO/NUTS split: every catalogued record must stay consistent
    // across the two vocabularies, whichever way it is read.
    for (const [, lng, lat] of CITIES) {
      const layer = bestOrthophotoFor(lng, lat);
      if (!layer?.nuts) continue;
      expect(layer.nuts.slice(0, 2)).toBe(countryToNuts(layer.country));
    }
  });
});

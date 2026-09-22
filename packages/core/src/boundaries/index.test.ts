import { describe, expect, it } from "vitest";
import { boundedCountries, countryAt, isPointInCountry } from "./index.js";

describe("countryAt", () => {
  it("resolves capitals and major cities", () => {
    expect(countryAt(12.4964, 41.9028)).toBe("IT"); // Roma
    expect(countryAt(2.3522, 48.8566)).toBe("FR"); // Paris
    expect(countryAt(-3.7038, 40.4168)).toBe("ES"); // Madrid
    expect(countryAt(13.405, 52.52)).toBe("DE"); // Berlin
    expect(countryAt(21.0122, 52.2297)).toBe("PL"); // Warszawa
    expect(countryAt(-98.0, 38.5)).toBe("US"); // Kansas, for the NAIP case
  });

  it("settles the extents that overhang a border", () => {
    // Each of these sits inside a *neighbouring* service's bounding rectangle
    // and used to be served by it. They are the reason this module exists.
    expect(countryAt(2.1734, 41.3851)).toBe("ES"); // Barcelona, inside France's hull
    expect(countryAt(16.3738, 48.2082)).toBe("AT"); // Wien, inside Czechia's hull
    expect(countryAt(11.4041, 47.2692)).toBe("AT"); // Innsbruck, inside Bavaria's hull
    expect(countryAt(15.9819, 45.815)).toBe("HR"); // Zagreb, inside Slovenia's hull
    expect(countryAt(12.5683, 55.6761)).toBe("DK"); // Kobenhavn, inside Sweden's hull
    expect(countryAt(6.645, 44.899)).toBe("FR"); // Briancon, inside Piemonte's hull
  });

  it("keeps coastal cities in their own country", () => {
    // A generalised coastline cuts corners, and these all sit on water: the
    // Venice lagoon, the Tagus, the Oresund, the Stockholm archipelago. Without
    // the coastal tolerance they answer "no country", which would switch the
    // disambiguation off exactly where it is needed.
    expect(countryAt(12.3155, 45.4408)).toBe("IT"); // Venezia
    expect(countryAt(-9.1393, 38.7223)).toBe("PT"); // Lisboa
    expect(countryAt(18.0686, 59.3293)).toBe("SE"); // Stockholm
    expect(countryAt(13.5189, 43.6158)).toBe("IT"); // Ancona
    expect(countryAt(13.3615, 38.1157)).toBe("IT"); // Palermo
  });

  it("says nothing rather than guessing out at sea", () => {
    // `undefined` means "cannot say". Callers treat it as a reason to leave
    // the ranking alone, so a wrong answer is far worse than none.
    expect(countryAt(-30, 45)).toBeUndefined(); // mid-Atlantic
    expect(countryAt(-140, 0)).toBeUndefined(); // mid-Pacific
  });

  it("can be asked for strict containment", () => {
    // Venice is inside the tolerance but outside the outline itself.
    expect(countryAt(12.3155, 45.4408, { toleranceKm: 0 })).toBeUndefined();
    expect(countryAt(12.4964, 41.9028, { toleranceKm: 0 })).toBe("IT");
  });

  it("does not let the tolerance reach across a border", () => {
    // 5 km of slack must not turn a Danish coordinate Swedish, which is the
    // failure mode that would make the whole thing counterproductive.
    expect(countryAt(12.5683, 55.6761)).not.toBe("SE");
    expect(countryAt(6.1432, 46.2044)).toBe("CH"); // Geneve, a Swiss enclave in France
  });

  it("exposes the countries it knows", () => {
    const codes = boundedCountries();
    expect(codes.length).toBeGreaterThan(200);
    expect(codes).toContain("IT");
    expect(codes).toContain("US");
    // Natural Earth carries these without an ISO code; they are mapped to the
    // country ISO assigns the ground to, so they are not holes in the lookup.
    expect(countryAt(33.3, 35.2)).toBe("CY"); // northern Cyprus
  });

  it("answers isPointInCountry consistently", () => {
    expect(isPointInCountry("IT", 12.4964, 41.9028)).toBe(true);
    expect(isPointInCountry("FR", 12.4964, 41.9028)).toBe(false);
  });
});

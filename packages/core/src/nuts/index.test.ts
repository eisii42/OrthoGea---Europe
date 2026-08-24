import { describe, expect, it } from "vitest";
import {
  CountryCodeSchema,
  NUTS_COUNTRIES,
  isNutsWithin,
  isValidNutsCode,
  isoToNuts,
  nutsAncestors,
  nutsCountry,
  nutsCountryName,
  nutsLevel,
  nutsParent,
  nutsToIso
} from "./index.js";

describe("NUTS codes", () => {
  it("validates real codes and rejects junk", () => {
    expect(isValidNutsCode("IT")).toBe(true);
    expect(isValidNutsCode("ITI")).toBe(true);
    expect(isValidNutsCode("ITI1")).toBe(true);
    expect(isValidNutsCode("ITI14")).toBe(true);
    expect(isValidNutsCode("ITI145")).toBe(false);
    expect(isValidNutsCode("ZZ1")).toBe(false);
    expect(isValidNutsCode("it")).toBe(false);
  });

  it("derives the level", () => {
    expect(nutsLevel("IT")).toBe(0);
    expect(nutsLevel("ITI")).toBe(1);
    expect(nutsLevel("ITI1")).toBe(2);
    expect(nutsLevel("ITI14")).toBe(3);
  });

  it("walks the hierarchy", () => {
    expect(nutsParent("ITI14")).toBe("ITI1");
    expect(nutsParent("IT")).toBeUndefined();
    expect(nutsAncestors("ITI14")).toEqual(["ITI1", "ITI", "IT"]);
    expect(nutsCountry("ITI14")).toBe("IT");
    expect(isNutsWithin("ITI14", "IT")).toBe(true);
    expect(isNutsWithin("ITI14", "ITI1")).toBe(true);
    expect(isNutsWithin("ITI14", "ITF")).toBe(false);
  });

  it("maps between NUTS and ISO country codes", () => {
    expect(nutsToIso("EL30")).toBe("GR");
    expect(nutsToIso("UKI")).toBe("GB");
    expect(nutsToIso("ITI1")).toBe("IT");
    expect(isoToNuts("GR")).toBe("EL");
    expect(isoToNuts("gb")).toBe("UK");
    expect(nutsCountryName("ESC1")).toBe("Spain");
  });

  it("accepts EU as a pan-European country code", () => {
    expect(CountryCodeSchema.safeParse("EU").success).toBe(true);
    expect(CountryCodeSchema.safeParse("GB").success).toBe(false);
    expect(NUTS_COUNTRIES.filter((country) => country.eu)).toHaveLength(27);
  });
});

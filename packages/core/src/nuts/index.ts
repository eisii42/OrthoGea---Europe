import { z } from "zod";

export interface NutsCountry {
  /** NUTS-0 code (differs from ISO 3166-1 for Greece and the UK). */
  readonly code: string;
  readonly iso2: string;
  readonly name: string;
  readonly eu: boolean;
}

/** NUTS-0 entities: EU member states plus EFTA, candidate and neighbour countries. */
export const NUTS_COUNTRIES: readonly NutsCountry[] = [
  { code: "AT", iso2: "AT", name: "Austria", eu: true },
  { code: "BE", iso2: "BE", name: "Belgium", eu: true },
  { code: "BG", iso2: "BG", name: "Bulgaria", eu: true },
  { code: "CY", iso2: "CY", name: "Cyprus", eu: true },
  { code: "CZ", iso2: "CZ", name: "Czechia", eu: true },
  { code: "DE", iso2: "DE", name: "Germany", eu: true },
  { code: "DK", iso2: "DK", name: "Denmark", eu: true },
  { code: "EE", iso2: "EE", name: "Estonia", eu: true },
  { code: "EL", iso2: "GR", name: "Greece", eu: true },
  { code: "ES", iso2: "ES", name: "Spain", eu: true },
  { code: "FI", iso2: "FI", name: "Finland", eu: true },
  { code: "FR", iso2: "FR", name: "France", eu: true },
  { code: "HR", iso2: "HR", name: "Croatia", eu: true },
  { code: "HU", iso2: "HU", name: "Hungary", eu: true },
  { code: "IE", iso2: "IE", name: "Ireland", eu: true },
  { code: "IT", iso2: "IT", name: "Italy", eu: true },
  { code: "LT", iso2: "LT", name: "Lithuania", eu: true },
  { code: "LU", iso2: "LU", name: "Luxembourg", eu: true },
  { code: "LV", iso2: "LV", name: "Latvia", eu: true },
  { code: "MT", iso2: "MT", name: "Malta", eu: true },
  { code: "NL", iso2: "NL", name: "Netherlands", eu: true },
  { code: "PL", iso2: "PL", name: "Poland", eu: true },
  { code: "PT", iso2: "PT", name: "Portugal", eu: true },
  { code: "RO", iso2: "RO", name: "Romania", eu: true },
  { code: "SE", iso2: "SE", name: "Sweden", eu: true },
  { code: "SI", iso2: "SI", name: "Slovenia", eu: true },
  { code: "SK", iso2: "SK", name: "Slovakia", eu: true },
  { code: "CH", iso2: "CH", name: "Switzerland", eu: false },
  { code: "IS", iso2: "IS", name: "Iceland", eu: false },
  { code: "LI", iso2: "LI", name: "Liechtenstein", eu: false },
  { code: "NO", iso2: "NO", name: "Norway", eu: false },
  { code: "UK", iso2: "GB", name: "United Kingdom", eu: false },
  { code: "AL", iso2: "AL", name: "Albania", eu: false },
  { code: "BA", iso2: "BA", name: "Bosnia and Herzegovina", eu: false },
  { code: "ME", iso2: "ME", name: "Montenegro", eu: false },
  { code: "MD", iso2: "MD", name: "Moldova", eu: false },
  { code: "MK", iso2: "MK", name: "North Macedonia", eu: false },
  { code: "RS", iso2: "RS", name: "Serbia", eu: false },
  { code: "TR", iso2: "TR", name: "Türkiye", eu: false },
  { code: "UA", iso2: "UA", name: "Ukraine", eu: false },
  { code: "XK", iso2: "XK", name: "Kosovo", eu: false }
];

/** Pseudo-code used by pan-European datasets (Copernicus, EEA, Eurostat). */
export const EU_WIDE_CODE = "EU";

const byNuts = new Map(NUTS_COUNTRIES.map((country) => [country.code, country]));
const byIso = new Map(NUTS_COUNTRIES.map((country) => [country.iso2, country]));

const NUTS_RE = /^[A-Z]{2}[A-Z0-9]{0,3}$/;

/** NUTS-0 country code, or `EU` for pan-European datasets. */
export const CountryCodeSchema = z
  .string()
  .refine((code) => code === EU_WIDE_CODE || byNuts.has(code), {
    message: "must be a NUTS-0 country code (e.g. IT, ES, FR, EL, UK) or EU"
  });
export type CountryCode = z.infer<typeof CountryCodeSchema>;

/** NUTS code of any level, e.g. `IT`, `ITI`, `ITI1`, `ITI14`. */
export const NutsCodeSchema = z
  .string()
  .regex(NUTS_RE, { message: "must be a NUTS code such as IT, ITI, ITI1 or ITI14" })
  .refine((code) => code === EU_WIDE_CODE || byNuts.has(code.slice(0, 2)), {
    message: "unknown NUTS country prefix"
  });
export type NutsCode = z.infer<typeof NutsCodeSchema>;

/** True when the string is a syntactically valid NUTS code of a known country. */
export function isValidNutsCode(code: string): boolean {
  return NutsCodeSchema.safeParse(code).success;
}

/** NUTS level: 0 (country) to 3 (province/department). */
export function nutsLevel(code: string): 0 | 1 | 2 | 3 {
  const level = Math.max(0, Math.min(3, code.trim().length - 2));
  return level as 0 | 1 | 2 | 3;
}

/** Parent code one level up, or `undefined` for NUTS-0. */
export function nutsParent(code: string): string | undefined {
  const trimmed = code.trim();
  return trimmed.length <= 2 ? undefined : trimmed.slice(0, trimmed.length - 1);
}

/** All ancestors from the immediate parent up to the country code. */
export function nutsAncestors(code: string): string[] {
  const chain: string[] = [];
  let current = nutsParent(code);
  while (current) {
    chain.push(current);
    current = nutsParent(current);
  }
  return chain;
}

/** NUTS-0 prefix of any NUTS code. */
export function nutsCountry(code: string): string {
  return code.trim().slice(0, 2);
}

/** True when `code` is `ancestor` itself or one of its descendants. */
export function isNutsWithin(code: string, ancestor: string): boolean {
  const child = code.trim();
  const parent = ancestor.trim();
  return child === parent || child.startsWith(parent);
}

/** Country metadata for a NUTS code of any level. */
export function nutsCountryInfo(code: string): NutsCountry | undefined {
  return byNuts.get(nutsCountry(code));
}

/** Converts a NUTS-0 code to ISO 3166-1 alpha-2 (`EL` becomes `GR`). */
export function nutsToIso(code: string): string | undefined {
  return byNuts.get(nutsCountry(code))?.iso2;
}

/** Converts an ISO 3166-1 alpha-2 code to NUTS-0 (`GB` becomes `UK`). */
export function isoToNuts(iso2: string): string | undefined {
  return byIso.get(iso2.trim().toUpperCase())?.code;
}

/** English country name for a NUTS code of any level. */
export function nutsCountryName(code: string): string | undefined {
  return nutsCountryInfo(code)?.name;
}

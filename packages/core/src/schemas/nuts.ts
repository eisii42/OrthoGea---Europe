import { z } from "zod";
import { EU_WIDE_CODE } from "../constants.js";
import { NUTS_CODE_PATTERN, isKnownCountryCode, isValidNutsCode } from "../nuts/index.js";

/**
 * ISO 3166-1 alpha-2 country code, or `EU` for pan-European datasets.
 *
 * ISO rather than NUTS-0, so a catalogue is not confined to Europe. The
 * European sub-national hierarchy lives on the separate, optional `nuts` field,
 * which is where `EL` and `UK` belong.
 */
export const CountryCodeSchema = z.string().refine(isKnownCountryCode, {
  error: "must be an ISO 3166-1 alpha-2 country code (e.g. IT, ES, FR, GR, GB) or EU"
});

/** NUTS code of any level, e.g. `IT`, `ITI`, `ITI1`, `ITI14`. */
export const NutsCodeSchema = z
  .string()
  .regex(NUTS_CODE_PATTERN, { error: "must be a NUTS code such as IT, ITI, ITI1 or ITI14" })
  .refine((code) => code === EU_WIDE_CODE || isValidNutsCode(code), {
    error: "unknown NUTS country prefix"
  });

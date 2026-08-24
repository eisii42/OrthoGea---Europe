import { z } from "zod";
import { EU_WIDE_CODE } from "../constants.js";
import { NUTS_CODE_PATTERN, isKnownCountryCode, isValidNutsCode } from "../nuts/index.js";

/** NUTS-0 country code, or `EU` for pan-European datasets. */
export const CountryCodeSchema = z.string().refine(isKnownCountryCode, {
  message: "must be a NUTS-0 country code (e.g. IT, ES, FR, EL, UK) or EU"
});

/** NUTS code of any level, e.g. `IT`, `ITI`, `ITI1`, `ITI14`. */
export const NutsCodeSchema = z
  .string()
  .regex(NUTS_CODE_PATTERN, { message: "must be a NUTS code such as IT, ITI, ITI1 or ITI14" })
  .refine((code) => code === EU_WIDE_CODE || isValidNutsCode(code), {
    message: "unknown NUTS country prefix"
  });

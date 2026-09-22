/**
 * ISO 3166-1 alpha-2 country codes.
 *
 * A layer's `country` is an ISO 3166-1 alpha-2 code, which is what makes the
 * catalogue able to describe sources outside Europe (USDA NAIP for the United
 * States, for instance) without a second vocabulary. The NUTS system stays
 * available on the optional `nuts` field, where it carries what ISO cannot:
 * the sub-national hierarchy European open data is published against.
 *
 * The two vocabularies agree on every code but two - Greece is `EL` in NUTS and
 * `GR` in ISO, the United Kingdom is `UK` and `GB` - which is exactly why the
 * fields are kept apart. Use {@link isoToNuts} and {@link nutsToIso} to cross
 * between them rather than assuming they match.
 */

/**
 * The 249 officially assigned ISO 3166-1 alpha-2 codes.
 *
 * Stored as one string and split at load: a few hundred bytes of source rather
 * than a 249-entry array literal, and the lookup below is a `Set` either way.
 */
const ISO_3166_1_ALPHA2_CODES =
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ " +
  "BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
  "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ " +
  "DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
  "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY " +
  "HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
  "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY " +
  "MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ " +
  "NA NC NE NF NG NI NL NO NP NR NU NZ OM " +
  "PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
  "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ " +
  "TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ " +
  "UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW";

/**
 * User-assigned codes the framework accepts alongside the official list.
 *
 * `XK` is not an officially assigned ISO code, but it is what the European
 * Commission, Eurostat and the NUTS table in this package all use for Kosovo.
 * Rejecting it would make a catalogued Kosovan source unrepresentable.
 */
export const USER_ASSIGNED_COUNTRY_CODES: readonly string[] = ["XK"];

/** Every officially assigned ISO 3166-1 alpha-2 code, uppercase. */
export const ISO_3166_1_ALPHA2: readonly string[] = ISO_3166_1_ALPHA2_CODES.split(" ");

const isoCodes = new Set([...ISO_3166_1_ALPHA2, ...USER_ASSIGNED_COUNTRY_CODES]);

/**
 * True when the string is an ISO 3166-1 alpha-2 code the framework accepts:
 * an officially assigned one, or a code from
 * {@link USER_ASSIGNED_COUNTRY_CODES}.
 */
export function isIsoCountryCode(code: string): boolean {
  return isoCodes.has(code);
}

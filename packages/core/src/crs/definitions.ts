/**
 * Coordinate Reference System registry.
 *
 * The `axisOrder` field describes the order mandated by the *authority*
 * definition, which is what OGC-compliant services (WMS 1.3.0, WMTS, WFS 2.0)
 * must honour. WMS 1.1.1 always uses `lonlat` ("x,y") regardless of this value.
 */

export type AxisOrder = "lonlat" | "latlon";

export type CrsKind = "geographic" | "projected";

export interface CrsDefinition {
  /** Canonical short code, e.g. `EPSG:4326` or `CRS:84`. */
  readonly code: string;
  readonly authority: "EPSG" | "OGC";
  readonly name: string;
  readonly kind: CrsKind;
  /**
   * Axis order as defined by the authority (used by WMS 1.3.0 / WMTS / WFS 2).
   * `latlon` means "northing/latitude first".
   */
  readonly axisOrder: AxisOrder;
  readonly units: "degree" | "metre";
  /** Alternative spellings normalised to {@link CrsDefinition.code}. */
  readonly aliases: readonly string[];
  /** Rough area of validity, informational only. */
  readonly area?: string;
}

/**
 * CRS commonly advertised by European open geodata services.
 * Extend at runtime with `registerCrs()`.
 */
export const CRS_DEFINITIONS: readonly CrsDefinition[] = [
  {
    code: "CRS:84",
    authority: "OGC",
    name: "WGS 84 longitude-latitude",
    kind: "geographic",
    axisOrder: "lonlat",
    units: "degree",
    aliases: ["CRS84", "OGC:CRS84", "URN:OGC:DEF:CRS:OGC:1.3:CRS84", "URN:OGC:DEF:CRS:OGC:2:84", "URN:OGC:DEF:CRS:OGC::CRS84"],
    area: "World"
  },
  {
    code: "EPSG:4326",
    authority: "EPSG",
    name: "WGS 84",
    kind: "geographic",
    axisOrder: "latlon",
    units: "degree",
    aliases: ["WGS84", "WGS 84"],
    area: "World"
  },
  {
    code: "EPSG:4258",
    authority: "EPSG",
    name: "ETRS89",
    kind: "geographic",
    axisOrder: "latlon",
    units: "degree",
    aliases: ["ETRS89"],
    area: "Europe"
  },
  {
    code: "EPSG:6706",
    authority: "EPSG",
    name: "RDN2008",
    kind: "geographic",
    axisOrder: "latlon",
    units: "degree",
    aliases: ["RDN2008"],
    area: "Italy"
  },
  {
    code: "EPSG:4230",
    authority: "EPSG",
    name: "ED50",
    kind: "geographic",
    axisOrder: "latlon",
    units: "degree",
    aliases: ["ED50"],
    area: "Europe - west"
  },
  {
    code: "EPSG:4171",
    authority: "EPSG",
    name: "RGF93 v1",
    kind: "geographic",
    axisOrder: "latlon",
    units: "degree",
    aliases: ["RGF93"],
    area: "France"
  },
  {
    code: "EPSG:3857",
    authority: "EPSG",
    name: "WGS 84 / Pseudo-Mercator",
    kind: "projected",
    axisOrder: "lonlat",
    units: "metre",
    aliases: ["EPSG:900913", "EPSG:3785", "EPSG:102100", "EPSG:102113", "OSGEO:41001", "GOOGLE:PROJECTION"],
    area: "World between 85.06S and 85.06N"
  },
  {
    code: "EPSG:3035",
    authority: "EPSG",
    name: "ETRS89-extended / LAEA Europe",
    kind: "projected",
    // EPSG defines 3035 with northing (Y) before easting (X).
    axisOrder: "latlon",
    units: "metre",
    aliases: ["ETRS89-LAEA", "LAEA"],
    area: "Europe (INSPIRE statistical grid)"
  },
  {
    code: "EPSG:3034",
    authority: "EPSG",
    name: "ETRS89-extended / LCC Europe",
    kind: "projected",
    axisOrder: "latlon",
    units: "metre",
    aliases: [],
    area: "Europe"
  },
  {
    code: "EPSG:3003",
    authority: "EPSG",
    name: "Monte Mario / Italy zone 1",
    kind: "projected",
    axisOrder: "lonlat",
    units: "metre",
    aliases: ["GAUSS-BOAGA-OVEST"],
    area: "Italy - west of 12E"
  },
  {
    code: "EPSG:3004",
    authority: "EPSG",
    name: "Monte Mario / Italy zone 2",
    kind: "projected",
    axisOrder: "lonlat",
    units: "metre",
    aliases: ["GAUSS-BOAGA-EST"],
    area: "Italy - east of 12E"
  },
  {
    code: "EPSG:6707",
    authority: "EPSG",
    name: "RDN2008 / TM32 (N-E)",
    kind: "projected",
    axisOrder: "latlon",
    units: "metre",
    aliases: [],
    area: "Italy - west of 12E"
  },
  {
    code: "EPSG:6708",
    authority: "EPSG",
    name: "RDN2008 / TM33 (N-E)",
    kind: "projected",
    axisOrder: "latlon",
    units: "metre",
    aliases: [],
    area: "Italy - 12E to 18E"
  },
  {
    code: "EPSG:7791",
    authority: "EPSG",
    name: "RDN2008 / UTM zone 32N",
    kind: "projected",
    axisOrder: "lonlat",
    units: "metre",
    aliases: [],
    area: "Italy - west of 12E"
  },
  {
    code: "EPSG:7792",
    authority: "EPSG",
    name: "RDN2008 / UTM zone 33N",
    kind: "projected",
    axisOrder: "lonlat",
    units: "metre",
    aliases: [],
    area: "Italy - 12E to 18E"
  },
  {
    code: "EPSG:25832",
    authority: "EPSG",
    name: "ETRS89 / UTM zone 32N",
    kind: "projected",
    axisOrder: "lonlat",
    units: "metre",
    aliases: [],
    area: "Europe - 6E to 12E"
  },
  {
    code: "EPSG:25833",
    authority: "EPSG",
    name: "ETRS89 / UTM zone 33N",
    kind: "projected",
    axisOrder: "lonlat",
    units: "metre",
    aliases: [],
    area: "Europe - 12E to 18E"
  },
  {
    code: "EPSG:25830",
    authority: "EPSG",
    name: "ETRS89 / UTM zone 30N",
    kind: "projected",
    axisOrder: "lonlat",
    units: "metre",
    aliases: [],
    area: "Europe - 6W to 0"
  },
  {
    code: "EPSG:25831",
    authority: "EPSG",
    name: "ETRS89 / UTM zone 31N",
    kind: "projected",
    axisOrder: "lonlat",
    units: "metre",
    aliases: [],
    area: "Europe - 0 to 6E"
  },
  {
    code: "EPSG:32632",
    authority: "EPSG",
    name: "WGS 84 / UTM zone 32N",
    kind: "projected",
    axisOrder: "lonlat",
    units: "metre",
    aliases: [],
    area: "World - 6E to 12E, northern hemisphere"
  },
  {
    code: "EPSG:32633",
    authority: "EPSG",
    name: "WGS 84 / UTM zone 33N",
    kind: "projected",
    axisOrder: "lonlat",
    units: "metre",
    aliases: [],
    area: "World - 12E to 18E, northern hemisphere"
  },
  {
    code: "EPSG:32628",
    authority: "EPSG",
    name: "WGS 84 / UTM zone 28N",
    kind: "projected",
    axisOrder: "lonlat",
    units: "metre",
    aliases: [],
    area: "Canary Islands"
  },
  {
    code: "EPSG:2154",
    authority: "EPSG",
    name: "RGF93 v1 / Lambert-93",
    kind: "projected",
    axisOrder: "lonlat",
    units: "metre",
    aliases: ["LAMBERT93"],
    area: "France - mainland"
  },
  {
    code: "EPSG:27700",
    authority: "EPSG",
    name: "OSGB36 / British National Grid",
    kind: "projected",
    axisOrder: "lonlat",
    units: "metre",
    aliases: ["BNG"],
    area: "United Kingdom"
  },
  {
    code: "EPSG:28992",
    authority: "EPSG",
    name: "Amersfoort / RD New",
    kind: "projected",
    axisOrder: "lonlat",
    units: "metre",
    aliases: ["RDNEW"],
    area: "Netherlands"
  },
  {
    code: "EPSG:31370",
    authority: "EPSG",
    name: "BD72 / Belgian Lambert 72",
    kind: "projected",
    axisOrder: "lonlat",
    units: "metre",
    aliases: [],
    area: "Belgium"
  },
  {
    code: "EPSG:2180",
    authority: "EPSG",
    name: "ETRF2000-PL / CS92",
    kind: "projected",
    // EPSG defines 2180 with northing (x) before easting (y).
    axisOrder: "latlon",
    units: "metre",
    aliases: [],
    area: "Poland"
  },
  {
    code: "EPSG:3006",
    authority: "EPSG",
    name: "SWEREF99 TM",
    kind: "projected",
    axisOrder: "latlon",
    units: "metre",
    aliases: [],
    area: "Sweden"
  },
  {
    code: "EPSG:3067",
    authority: "EPSG",
    name: "ETRS89 / TM35FIN(E,N)",
    kind: "projected",
    axisOrder: "lonlat",
    units: "metre",
    aliases: [],
    area: "Finland"
  },
  {
    code: "EPSG:5514",
    authority: "EPSG",
    name: "S-JTSK / Krovak East North",
    kind: "projected",
    axisOrder: "lonlat",
    units: "metre",
    aliases: [],
    area: "Czechia and Slovakia"
  },
  {
    code: "EPSG:23030",
    authority: "EPSG",
    name: "ED50 / UTM zone 30N",
    kind: "projected",
    axisOrder: "lonlat",
    units: "metre",
    aliases: [],
    area: "Europe - 6W to 0"
  },
  {
    code: "EPSG:23031",
    authority: "EPSG",
    name: "ED50 / UTM zone 31N",
    kind: "projected",
    axisOrder: "lonlat",
    units: "metre",
    aliases: [],
    area: "Europe - 0 to 6E"
  }
];

/** Codes that describe the very same geodetic/projected space. */
export const CRS_EQUIVALENCE_GROUPS: readonly (readonly string[])[] = [
  ["EPSG:3857", "EPSG:900913", "EPSG:3785", "EPSG:102100", "EPSG:102113"],
  ["EPSG:4326", "CRS:84"],
  ["EPSG:4258", "EPSG:4937"]
];

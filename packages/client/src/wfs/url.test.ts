import { describe, expect, it } from "vitest";
import { UnsupportedServiceError, type OrthoGeaLayer, type WfsService } from "@orthogea/core";
import { cadastreLayer, wfsLayer } from "../__fixtures__/layers.js";
import { buildWfsGetFeatureUrl, toGeoJsonUrl } from "./url.js";

const service = (layer: OrthoGeaLayer): WfsService => {
  if (layer.service.type !== "WFS") throw new Error(`${layer.id} is not a WFS layer`);
  return layer.service;
};

describe("buildWfsGetFeatureUrl", () => {
  it("uses WFS 2.0.0 parameter names", () => {
    const params = new URL(buildWfsGetFeatureUrl(service(wfsLayer))).searchParams;
    expect(params.get("SERVICE")).toBe("WFS");
    expect(params.get("VERSION")).toBe("2.0.0");
    expect(params.get("REQUEST")).toBe("GetFeature");
    expect(params.get("TYPENAMES")).toBe("cp:CadastralParcel");
    expect(params.get("TYPENAME")).toBeNull();
    expect(params.get("COUNT")).toBe("50");
    expect(params.get("SRSNAME")).toBe("EPSG:4326");
  });

  it("falls back to 1.x names when the service is older", () => {
    const legacy: WfsService = {
      ...service(wfsLayer),
      options: { ...service(wfsLayer).options, version: "1.1.0" }
    };
    const params = new URL(buildWfsGetFeatureUrl(legacy)).searchParams;
    expect(params.get("TYPENAME")).toBe("cp:CadastralParcel");
    expect(params.get("MAXFEATURES")).toBe("50");
  });

  it("writes the BBOX with an explicit CRS and the right axis order", () => {
    const params = new URL(
      buildWfsGetFeatureUrl(service(wfsLayer), { bbox: [11, 43, 12, 44] })
    ).searchParams;
    // EPSG:4326 is latitude-first, so the filter must be written that way.
    expect(params.get("BBOX")).toBe("43,11,44,12,EPSG:4326");
  });

  it("passes filters, property selection and paging", () => {
    const params = new URL(
      buildWfsGetFeatureUrl(service(wfsLayer), {
        cqlFilter: "comune='Firenze'",
        propertyNames: ["label", "areaValue"],
        count: 5,
        sortBy: "label"
      })
    ).searchParams;
    expect(params.get("CQL_FILTER")).toBe("comune='Firenze'");
    expect(params.get("PROPERTYNAME")).toBe("label,areaValue");
    expect(params.get("COUNT")).toBe("5");
    expect(params.get("SORTBY")).toBe("label");
  });
});

describe("toGeoJsonUrl", () => {
  it("requests GeoJSON output", () => {
    expect(toGeoJsonUrl(wfsLayer)).toContain("OUTPUTFORMAT=application%2Fjson");
  });

  it("refuses non-WFS layers", () => {
    expect(() => toGeoJsonUrl(cadastreLayer)).toThrow(UnsupportedServiceError);
  });
});

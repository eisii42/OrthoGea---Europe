import { describe, expect, it } from "vitest";
import { CapabilitiesParseError, ServiceExceptionError } from "@orthogea/core";
import { WMS_111_CAPABILITIES, WMS_SERVICE_EXCEPTION } from "../__fixtures__/wms111.js";
import { WMS_130_CAPABILITIES } from "../__fixtures__/wms130.js";
import { findLayer, parseWmsCapabilities } from "./parse.js";

describe("WMS 1.3.0", () => {
  const capabilities = parseWmsCapabilities(WMS_130_CAPABILITIES);

  it("detects the version from a namespaced document", () => {
    expect(capabilities.version).toBe("1.3.0");
    expect(capabilities.serviceType).toBe("WMS");
  });

  it("reads service metadata", () => {
    expect(capabilities.service.title).toBe("Cadastral Parcels - INSPIRE");
    expect(capabilities.service.keywords).toEqual(["cadastre", "INSPIRE"]);
    expect(capabilities.service.maxWidth).toBe(2048);
    expect(capabilities.service.maxHeight).toBe(2048);
    expect(capabilities.service.contactEmail).toBe("gis@example.gov.it");
    expect(capabilities.service.onlineResource).toBe(
      "https://wms.example.gov.it/inspire/wms/owsproxy.sub?"
    );
  });

  it("reads the operations and their formats", () => {
    expect(capabilities.operations.getMap?.formats).toEqual(["image/png", "image/jpeg"]);
    expect(capabilities.operations.getFeatureInfo?.formats).toEqual([
      "text/html",
      "application/json"
    ]);
    expect(capabilities.exceptionFormats).toEqual(["XML", "INIMAGE"]);
  });

  it("prefers the endpoint the document was fetched from", () => {
    expect(capabilities.operations.getMap?.url).toBe("https://internal.example.gov.it/wms?");
    const proxied = parseWmsCapabilities(WMS_130_CAPABILITIES, {
      endpointUrl: "https://wms.example.gov.it/inspire/wms/owsproxy.sub?"
    });
    expect(proxied.operations.getMap?.url).toBe(
      "https://wms.example.gov.it/inspire/wms/owsproxy.sub?"
    );
    const advertised = parseWmsCapabilities(WMS_130_CAPABILITIES, {
      endpointUrl: "https://wms.example.gov.it/inspire/wms/owsproxy.sub?",
      preferAdvertisedUrls: true
    });
    expect(advertised.operations.getMap?.url).toBe("https://internal.example.gov.it/wms?");
  });

  it("flattens only the requestable layers", () => {
    expect(capabilities.layers.map((layer) => layer.name)).toEqual([
      "CP.CadastralParcel",
      "BU.Building",
      "CP.CadastralZoning"
    ]);
    expect(capabilities.rootLayer?.name).toBeUndefined();
    expect(capabilities.rootLayer?.title).toBe("Cadastre root");
  });

  it("reads EX_GeographicBoundingBox as west/south/east/north", () => {
    expect(capabilities.rootLayer?.bbox).toEqual([6.6, 35.4, 18.6, 47.2]);
  });

  it("undoes the latitude-first axis order of EPSG:6706 and EPSG:4326", () => {
    const box = capabilities.rootLayer?.boundingBoxes.find((item) => item.crs === "EPSG:6706");
    expect(box?.raw).toEqual([35.4, 6.6, 47.2, 18.6]);
    expect(box?.bbox).toEqual([6.6, 35.4, 18.6, 47.2]);
  });

  it("keeps EPSG:3857 corners untouched", () => {
    const box = capabilities.rootLayer?.boundingBoxes.find((item) => item.crs === "EPSG:3857");
    expect(box?.bbox).toEqual([734730, 4226661, 2070707, 5961261]);
    expect(box?.raw).toEqual(box?.bbox);
  });

  it("inherits CRS, bbox and attribution from the parent layer", () => {
    const parcels = findLayer(capabilities, "CP.CadastralParcel");
    expect(parcels?.crs).toEqual(["EPSG:6706", "EPSG:4326", "EPSG:3857", "CRS:84"]);
    expect(parcels?.bbox).toEqual([6.6, 35.4, 18.6, 47.2]);
    expect(parcels?.attribution?.title).toBe("Agenzia Nazionale - Cadastre");
    expect(parcels?.path).toEqual(["Cadastre root"]);
    expect(parcels?.depth).toBe(1);
  });

  it("adds layer-specific CRS on top of the inherited ones", () => {
    const buildings = findLayer(capabilities, "BU.Building");
    expect(buildings?.crs).toContain("EPSG:3003");
    expect(buildings?.crs).toContain("EPSG:6706");
    expect(buildings?.boundingBoxes.map((box) => box.crs)).toContain("EPSG:3003");
  });

  it("reads queryable, styles, scale range and metadata", () => {
    const parcels = findLayer(capabilities, "CP.CadastralParcel");
    expect(parcels?.queryable).toBe(true);
    expect(parcels?.styles[0]?.name).toBe("CP.CadastralParcel.Default");
    expect(parcels?.styles[0]?.legendUrl).toBe("https://wms.example.gov.it/legend/parcel.png");
    expect(parcels?.styles[0]?.legendWidth).toBe(120);
    expect(parcels?.minScaleDenominator).toBe(100);
    expect(parcels?.maxScaleDenominator).toBe(8000);
    expect(parcels?.metadataUrls[0]?.url).toBe("https://metadata.example.gov.it/parcel.xml");
    expect(parcels?.metadataUrls[0]?.type).toBe("ISO19115:2003");
  });

  it("inherits queryable from the parent when the attribute is absent", () => {
    expect(findLayer(capabilities, "CP.CadastralZoning")?.queryable).toBe(false);
  });

  it("reads WMS 1.3.0 dimensions", () => {
    const dimension = findLayer(capabilities, "BU.Building")?.dimensions[0];
    expect(dimension?.name).toBe("time");
    expect(dimension?.units).toBe("ISO8601");
    expect(dimension?.default).toBe("2024-01-01");
    expect(dimension?.values).toBe("2020-01-01/2024-01-01/P1Y");
  });
});

describe("WMS 1.1.1", () => {
  const capabilities = parseWmsCapabilities(WMS_111_CAPABILITIES);

  it("detects the version from WMT_MS_Capabilities", () => {
    expect(capabilities.version).toBe("1.1.1");
    expect(capabilities.service.title).toBe("Regional orthophoto service");
  });

  it("splits whitespace-separated SRS lists", () => {
    expect(capabilities.rootLayer?.crs).toEqual([
      "EPSG:4326",
      "EPSG:3003",
      "EPSG:3857",
      "EPSG:25832"
    ]);
  });

  it("reads LatLonBoundingBox as longitude/latitude", () => {
    expect(capabilities.rootLayer?.bbox).toEqual([9.68, 42.23, 12.37, 44.47]);
  });

  it("never swaps axes in 1.1.1, not even for EPSG:4326", () => {
    const box = capabilities.rootLayer?.boundingBoxes.find((item) => item.crs === "EPSG:4326");
    expect(box?.raw).toEqual([9.68, 42.23, 12.37, 44.47]);
    expect(box?.bbox).toEqual([9.68, 42.23, 12.37, 44.47]);
  });

  it("converts ScaleHint into scale denominators", () => {
    const layer = findLayer(capabilities, "rt_ofc.10k22.32bit");
    expect(layer?.minScaleDenominator).toBeCloseTo(707.1, 0);
    expect(layer?.maxScaleDenominator).toBeCloseTo(7071067.8, -2);
  });

  it("lets a child override the inherited geographic bbox", () => {
    expect(findLayer(capabilities, "rt_ofc.10k19")?.bbox).toEqual([10, 42.5, 12, 44]);
    expect(findLayer(capabilities, "rt_ofc.10k22.32bit")?.bbox).toEqual([
      9.68, 42.23, 12.37, 44.47
    ]);
  });

  it("resolves queryable per layer", () => {
    expect(findLayer(capabilities, "rt_ofc.10k22.32bit")?.queryable).toBe(true);
    expect(findLayer(capabilities, "rt_ofc.10k19")?.queryable).toBe(false);
  });
});

describe("error handling", () => {
  it("raises a typed error for ServiceExceptionReport documents", () => {
    expect(() => parseWmsCapabilities(WMS_SERVICE_EXCEPTION)).toThrow(ServiceExceptionError);
    try {
      parseWmsCapabilities(WMS_SERVICE_EXCEPTION);
    } catch (error) {
      expect((error as ServiceExceptionError).exceptions[0]).toContain("Unsupported format");
    }
  });

  it("rejects empty, malformed and unrelated documents", () => {
    expect(() => parseWmsCapabilities("")).toThrow(CapabilitiesParseError);
    expect(() => parseWmsCapabilities("<a><b></a>")).toThrow(CapabilitiesParseError);
    expect(() => parseWmsCapabilities("<html><body>404</body></html>")).toThrow(
      CapabilitiesParseError
    );
  });
});

describe("robustness on real-world documents", () => {
  it("parses documents carrying thousands of XML entities", () => {
    // fast-xml-parser caps entity expansions at 1000 by default, which large
    // national services (IGN France, swisstopo) exceed with plain &amp;.
    const layers = Array.from(
      { length: 600 },
      (_, index) =>
        `<Layer queryable="1"><Name>layer.${index}</Name><Title>Ortofoto &amp; DTM &amp; DSM ${index}</Title></Layer>`
    ).join("\n");
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<WMS_Capabilities version="1.3.0">
  <Service><Title>Large service</Title></Service>
  <Capability>
    <Layer>
      <Title>Root</Title>
      <CRS>EPSG:3857</CRS>
      <EX_GeographicBoundingBox>
        <westBoundLongitude>-10</westBoundLongitude>
        <eastBoundLongitude>10</eastBoundLongitude>
        <southBoundLatitude>40</southBoundLatitude>
        <northBoundLatitude>50</northBoundLatitude>
      </EX_GeographicBoundingBox>
      ${layers}
    </Layer>
  </Capability>
</WMS_Capabilities>`;

    const capabilities = parseWmsCapabilities(xml);
    expect(capabilities.layers).toHaveLength(600);
    expect(capabilities.layers[42]?.title).toBe("Ortofoto & DTM & DSM 42");
    expect(capabilities.layers[42]?.bbox).toEqual([-10, 40, 10, 50]);
  });
});

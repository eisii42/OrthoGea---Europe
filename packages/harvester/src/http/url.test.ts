import { describe, expect, it } from "vitest";
import {
  applyProxy,
  buildCapabilitiesUrl,
  getParamCaseInsensitive,
  toBaseServiceUrl
} from "./url.js";

describe("buildCapabilitiesUrl", () => {
  it("adds the OGC parameters to a bare endpoint", () => {
    const url = new URL(buildCapabilitiesUrl("https://example.org/geoserver/wms"));
    expect(url.searchParams.get("SERVICE")).toBe("WMS");
    expect(url.searchParams.get("REQUEST")).toBe("GetCapabilities");
    expect(url.searchParams.get("VERSION")).toBe("1.3.0");
  });

  it("keeps vendor parameters used by INSPIRE proxies", () => {
    const url = buildCapabilitiesUrl("https://wms.example.gov.it/owsproxy.sub?map=cadastre&lang=it");
    expect(url).toContain("map=cadastre");
    expect(url).toContain("lang=it");
  });

  it("replaces parameters whatever their casing", () => {
    const url = new URL(
      buildCapabilitiesUrl("https://example.org/wms?service=wms&Request=GetMap&version=1.1.1")
    );
    expect([...url.searchParams.keys()].filter((key) => key.toLowerCase() === "service")).toHaveLength(1);
    expect(getParamCaseInsensitive(url.searchParams, "request")).toBe("GetCapabilities");
    expect(getParamCaseInsensitive(url.searchParams, "version")).toBe("1.3.0");
  });

  it("uses the right default version per service", () => {
    expect(buildCapabilitiesUrl("https://example.org/wmts", { service: "WMTS" })).toContain(
      "VERSION=1.0.0"
    );
    expect(buildCapabilitiesUrl("https://example.org/wfs", { service: "WFS" })).toContain(
      "VERSION=2.0.0"
    );
    expect(
      buildCapabilitiesUrl("https://example.org/wms", { service: "WMS", version: "1.1.1" })
    ).toContain("VERSION=1.1.1");
  });
});

describe("toBaseServiceUrl", () => {
  it("drops OGC parameters but keeps vendor ones", () => {
    expect(
      toBaseServiceUrl("https://example.org/wms?SERVICE=WMS&REQUEST=GetCapabilities&map=ortho")
    ).toBe("https://example.org/wms?map=ortho");
  });

  it("returns a clean endpoint when nothing is left", () => {
    expect(toBaseServiceUrl("https://example.org/wms?SERVICE=WMS&REQUEST=GetCapabilities")).toBe(
      "https://example.org/wms"
    );
  });
});

describe("applyProxy", () => {
  it("returns the URL untouched without a proxy", () => {
    expect(applyProxy("https://example.org/wms")).toBe("https://example.org/wms");
  });

  it("fills a {url} placeholder with the encoded URL", () => {
    expect(applyProxy("https://example.org/wms?a=1", "https://proxy.test/?target={url}")).toBe(
      "https://proxy.test/?target=https%3A%2F%2Fexample.org%2Fwms%3Fa%3D1"
    );
  });

  it("encodes when the proxy prefix ends with an equals sign", () => {
    expect(applyProxy("https://example.org/wms", "https://proxy.test/?url=")).toBe(
      "https://proxy.test/?url=https%3A%2F%2Fexample.org%2Fwms"
    );
  });

  it("concatenates plain path proxies", () => {
    expect(applyProxy("https://example.org/wms", "https://proxy.test/")).toBe(
      "https://proxy.test/https://example.org/wms"
    );
  });
});

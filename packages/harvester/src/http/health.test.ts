import { describe, expect, it, vi } from "vitest";
import { WMS_130_CAPABILITIES } from "../__fixtures__/wms130.js";
import { WMTS_100_CAPABILITIES } from "../__fixtures__/wmts100.js";
import { checkEndpoint, checkEndpoints, fetchCapabilities, harvestWms } from "./health.js";
import type { FetchLike } from "./health.js";

const xmlResponse = (body: string, status = 200): Response =>
  new Response(body, {
    status,
    statusText: status === 200 ? "OK" : "Server Error",
    headers: { "content-type": "text/xml" }
  });

describe("checkEndpoint", () => {
  it("reports a healthy WMS endpoint with its layer count", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => xmlResponse(WMS_130_CAPABILITIES));
    const health = await checkEndpoint("https://example.org/wms", { fetchImpl });

    expect(health.ok).toBe(true);
    expect(health.status).toBe(200);
    expect(health.serviceType).toBe("WMS");
    expect(health.version).toBe("1.3.0");
    expect(health.title).toBe("Cadastral Parcels - INSPIRE");
    expect(health.layerCount).toBe(3);
    expect(health.queryableLayerCount).toBe(2);
    expect(health.responseTimeMs).toBeGreaterThanOrEqual(0);
    expect(health.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(fetchImpl.mock.calls[0]?.[0]).toContain("REQUEST=GetCapabilities");
  });

  it("summarises WMTS endpoints too", async () => {
    const health = await checkEndpoint("https://example.org/wmts", {
      service: "WMTS",
      fetchImpl: async () => xmlResponse(WMTS_100_CAPABILITIES)
    });
    expect(health.ok).toBe(true);
    expect(health.layerCount).toBe(1);
    expect(health.title).toBe("Sentinel-2 tiles");
  });

  it("reports HTTP errors without throwing", async () => {
    const health = await checkEndpoint("https://example.org/wms", {
      fetchImpl: async () => xmlResponse("boom", 500)
    });
    expect(health.ok).toBe(false);
    expect(health.status).toBe(500);
    expect(health.errorCode).toBe("ENDPOINT_UNAVAILABLE");
    expect(health.error).toContain("500");
  });

  it("reports a parse failure separately from a transport failure", async () => {
    const health = await checkEndpoint("https://example.org/wms", {
      fetchImpl: async () => xmlResponse("<html>not xml capabilities</html>")
    });
    expect(health.ok).toBe(false);
    expect(health.errorCode).toBe("CAPABILITIES_PARSE_ERROR");
  });

  it("skips parsing when asked to", async () => {
    const health = await checkEndpoint("https://example.org/wms", {
      parse: false,
      fetchImpl: async () => xmlResponse("<html>not xml capabilities</html>")
    });
    expect(health.ok).toBe(true);
    expect(health.layerCount).toBeUndefined();
  });

  it("aborts the request once the timeout elapses", async () => {
    const fetchImpl: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });

    const health = await checkEndpoint("https://example.org/wms", { fetchImpl, timeoutMs: 20 });
    expect(health.ok).toBe(false);
    expect(health.error).toContain("Timed out after 20 ms");
  });

  it("routes the request through a CORS proxy when configured", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => xmlResponse(WMS_130_CAPABILITIES));
    await checkEndpoint("https://example.org/wms", {
      fetchImpl,
      proxyUrl: "https://proxy.test/?url="
    });
    expect(fetchImpl.mock.calls[0]?.[0]).toContain("https://proxy.test/?url=https%3A%2F%2F");
  });
});

describe("checkEndpoints", () => {
  it("keeps the input order with bounded concurrency", async () => {
    let inFlight = 0;
    let peak = 0;
    const fetchImpl: FetchLike = async (url) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return url.includes("bad") ? xmlResponse("nope", 404) : xmlResponse(WMS_130_CAPABILITIES);
    };

    const results = await checkEndpoints(
      [
        "https://a.example.org/wms",
        "https://bad.example.org/wms",
        "https://c.example.org/wms",
        "https://d.example.org/wms"
      ],
      { fetchImpl, concurrency: 2 }
    );

    expect(results).toHaveLength(4);
    expect(results.map((result) => result.ok)).toEqual([true, false, true, true]);
    expect(results[1]?.status).toBe(404);
    expect(peak).toBeLessThanOrEqual(2);
  });
});

describe("fetchCapabilities and harvestWms", () => {
  it("returns the raw document and timing", async () => {
    const response = await fetchCapabilities("https://example.org/wms", {
      fetchImpl: async () => xmlResponse(WMS_130_CAPABILITIES)
    });
    expect(response.xml).toContain("WMS_Capabilities");
    expect(response.contentType).toContain("text/xml");
    expect(response.requestUrl).toContain("SERVICE=WMS");
  });

  it("fetches and parses in one step", async () => {
    const capabilities = await harvestWms("https://example.org/wms", {
      fetchImpl: async () => xmlResponse(WMS_130_CAPABILITIES)
    });
    expect(capabilities.layers).toHaveLength(3);
    expect(capabilities.operations.getMap?.url).toBe("https://example.org/wms");
  });
});

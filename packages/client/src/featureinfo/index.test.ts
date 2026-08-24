import { describe, expect, it, vi } from "vitest";
import { EndpointUnavailableError } from "@orthogea/core";
import { cadastreLayer, orthophotoLayer, xyzLayer } from "../__fixtures__/layers.js";
import { getFeatureInfo, getFeatureInfoForLayers, type FetchLike } from "./index.js";

const jsonBody = JSON.stringify({
  type: "FeatureCollection",
  features: [{ type: "Feature", properties: { foglio: "12" }, geometry: null }]
});

const respond = (body: string, contentType: string, status = 200): Response =>
  new Response(body, { status, headers: { "content-type": contentType } });

describe("getFeatureInfo", () => {
  it("queries the endpoint and returns parsed features", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => respond(jsonBody, "application/json"));
    const result = await getFeatureInfo(
      cadastreLayer,
      { lngLat: [11.25, 43.77], zoom: 18 },
      { fetchImpl }
    );

    expect(result.layerId).toBe("it.ade.catasto");
    expect(result.format).toBe("geojson");
    expect(result.features[0]?.properties).toEqual({ foglio: "12" });
    expect(result.url).toContain("REQUEST=GetFeatureInfo");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("surfaces a ServiceException as a warning rather than features", async () => {
    const result = await getFeatureInfo(
      cadastreLayer,
      { lngLat: [11.25, 43.77], zoom: 18 },
      {
        fetchImpl: async () =>
          respond(
            '<ServiceExceptionReport><ServiceException code="LayerNotQueryable">Layer not queryable</ServiceException></ServiceExceptionReport>',
            "text/xml"
          )
      }
    );
    expect(result.features).toHaveLength(0);
    expect(result.warning).toContain("Layer not queryable");
  });

  it("throws on HTTP errors", async () => {
    await expect(
      getFeatureInfo(
        cadastreLayer,
        { lngLat: [11.25, 43.77], zoom: 18 },
        { fetchImpl: async () => respond("nope", "text/plain", 502) }
      )
    ).rejects.toBeInstanceOf(EndpointUnavailableError);
  });

  it("throws when the request times out", async () => {
    const fetchImpl: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    await expect(
      getFeatureInfo(cadastreLayer, { lngLat: [11.25, 43.77], zoom: 18 }, { fetchImpl, timeoutMs: 20 })
    ).rejects.toThrow(/timed out after 20 ms/);
  });
});

describe("getFeatureInfoForLayers", () => {
  it("keeps only the layers that answered with content", async () => {
    const fetchImpl: FetchLike = async (url) =>
      url.includes("rt_ofc")
        ? respond("", "text/plain")
        : respond(jsonBody, "application/json");

    const results = await getFeatureInfoForLayers(
      [cadastreLayer, orthophotoLayer, xyzLayer],
      { lngLat: [11.25, 43.77], zoom: 18 },
      { fetchImpl }
    );

    // The XYZ layer cannot be queried at all and is dropped silently.
    expect(results.map((result) => result.layerId)).toEqual(["it.ade.catasto"]);
  });
});

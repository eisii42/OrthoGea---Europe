import { describe, expect, it } from "vitest";
import { parseFeatureInfoResponse } from "./parse.js";

describe("GeoJSON responses", () => {
  it("keeps properties and geometry", () => {
    const body = JSON.stringify({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "parcel.1",
          properties: { comune: "Firenze", foglio: "12", particella: "345" },
          geometry: { type: "Point", coordinates: [11.25, 43.77] }
        }
      ]
    });
    const result = parseFeatureInfoResponse(body, "application/json");

    expect(result.format).toBe("geojson");
    expect(result.features).toHaveLength(1);
    expect(result.features[0]?.id).toBe("parcel.1");
    expect(result.features[0]?.properties).toMatchObject({ comune: "Firenze", foglio: "12" });
    expect(result.features[0]?.geometry).toEqual({ type: "Point", coordinates: [11.25, 43.77] });
  });

  it("wraps a bare JSON object into a single feature", () => {
    const result = parseFeatureInfoResponse('{"value":42}', "application/json");
    expect(result.format).toBe("json");
    expect(result.features[0]?.properties).toEqual({ value: 42 });
  });
});

describe("GML responses", () => {
  it("reads a GML 2 FeatureCollection", () => {
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs" xmlns:gml="http://www.opengis.net/gml" xmlns:cp="urn:x-inspire:specification:gmlas:CadastralParcels:3.0">
  <gml:featureMember>
    <cp:CadastralParcel gml:id="IT.AGE.PLA.A123">
      <cp:label>345</cp:label>
      <cp:nationalCadastralReference>A123.12.345</cp:nationalCadastralReference>
      <cp:areaValue uom="m2">1250</cp:areaValue>
      <cp:geometry>
        <gml:Point><gml:pos>43.77 11.25</gml:pos></gml:Point>
      </cp:geometry>
    </cp:CadastralParcel>
  </gml:featureMember>
</wfs:FeatureCollection>`;
    const result = parseFeatureInfoResponse(body, "application/vnd.ogc.gml");

    expect(result.format).toBe("gml");
    expect(result.features).toHaveLength(1);
    const feature = result.features[0];
    expect(feature?.layer).toBe("CadastralParcel");
    expect(feature?.properties["label"]).toBe(345);
    expect(feature?.properties["nationalCadastralReference"]).toBe("A123.12.345");
    // Geometry branches are skipped so that properties stay flat.
    expect(feature?.properties["pos"]).toBeUndefined();
  });

  it("reads MapServer msGMLOutput", () => {
    const body = `<?xml version="1.0" encoding="ISO-8859-1"?>
<msGMLOutput xmlns:gml="http://www.opengis.net/gml">
  <ortofoto_layer>
    <gml:name>ortofoto</gml:name>
    <ortofoto_feature>
      <gml:boundedBy><gml:Box><gml:coordinates>1,2 3,4</gml:coordinates></gml:Box></gml:boundedBy>
      <anno>2022</anno>
      <risoluzione>0.2 m</risoluzione>
    </ortofoto_feature>
  </ortofoto_layer>
</msGMLOutput>`;
    const result = parseFeatureInfoResponse(body, "text/xml");

    expect(result.features).toHaveLength(1);
    expect(result.features[0]?.layer).toBe("ortofoto");
    expect(result.features[0]?.properties).toMatchObject({ anno: 2022, risoluzione: "0.2 m" });
  });
});

describe("HTML responses", () => {
  it("reads a header/data table", () => {
    const body = `<html><body><table class="featureInfo">
      <tr><th>Comune</th><th>Foglio</th></tr>
      <tr><td>Firenze</td><td>12</td></tr>
      <tr><td>Sesto</td><td>7</td></tr>
    </table></body></html>`;
    const result = parseFeatureInfoResponse(body, "text/html");

    expect(result.format).toBe("html");
    expect(result.html).toBe(body);
    expect(result.features).toHaveLength(2);
    expect(result.features[0]?.properties).toEqual({ Comune: "Firenze", Foglio: "12" });
    expect(result.features[1]?.properties).toEqual({ Comune: "Sesto", Foglio: "7" });
  });

  it("reads a two-column key/value table and decodes entities", () => {
    const body = `<table>
      <tr><td>Provincia</td><td>Firenze &amp; dintorni</td></tr>
      <tr><td>Superficie</td><td>1.250 m&sup2;</td></tr>
    </table>`;
    const result = parseFeatureInfoResponse(body, "text/html");
    expect(result.features).toHaveLength(1);
    expect(result.features[0]?.properties["Provincia"]).toBe("Firenze & dintorni");
  });

  it("keeps the markup even when no table can be read", () => {
    const result = parseFeatureInfoResponse("<html><body>No features</body></html>", "text/html");
    expect(result.format).toBe("html");
    expect(result.features).toHaveLength(0);
    expect(result.html).toContain("No features");
  });
});

describe("plain text responses", () => {
  it("reads GeoServer key = value blocks", () => {
    const body = `Results for FeatureType 'rt_ofc.10k22':
--------------------------------------------
anno = 2022
risoluzione = 0.2
--------------------------------------------
anno = 2019
risoluzione = 0.2
--------------------------------------------
`;
    const result = parseFeatureInfoResponse(body, "text/plain");
    expect(result.format).toBe("text");
    expect(result.features).toHaveLength(2);
    expect(result.features[0]?.layer).toBe("rt_ofc.10k22");
    expect(result.features[0]?.properties).toEqual({ anno: "2022", risoluzione: "0.2" });
  });
});

describe("edge cases", () => {
  it("reports an empty body", () => {
    const result = parseFeatureInfoResponse("   ", "text/html");
    expect(result.format).toBe("empty");
    expect(result.features).toHaveLength(0);
  });

  it("returns a warning instead of throwing on broken JSON", () => {
    const result = parseFeatureInfoResponse("{not json", "application/json");
    expect(result.format).toBe("unknown");
    expect(result.warning).toContain("Could not parse");
    expect(result.raw).toBe("{not json");
  });
});

describe("real service shapes", () => {
  it("reads the th/td attribute table of the Italian cadastre", () => {
    const body = `<table class="wmstable" border="0"><tbody>
      <tr><th class="wmstable" colspan=7>Strato CP.CadastralParcel 'Particelle'</th></tr>
      <tr><th class="wmstable" scope="col">InspireId localId</th><td>IT.AGE.PLA.D612_016600.153</td></tr>
      <tr><th class="wmstable" scope="col">InspireId_namespace</th><td>IT.AGE.PLA</td></tr>
      <tr><th class="wmstable" scope="col">label</th><td>153</td></tr>
    </tbody></table>`;
    const result = parseFeatureInfoResponse(body, "text/html");

    expect(result.features).toHaveLength(1);
    expect(result.features[0]?.properties).toEqual({
      "InspireId localId": "IT.AGE.PLA.D612_016600.153",
      InspireId_namespace: "IT.AGE.PLA",
      label: "153"
    });
  });

  it("reads the attribute-less GML envelope of the same service", () => {
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<msGMLOutput xmlns:gml="http://www.opengis.net/gml">
  <CP.CadastralParcel_layer>
    <gml:name>Particelle</gml:name>
    <CP.CadastralParcel_feature>
      <gml:boundedBy>
        <gml:Box srsName="EPSG:4258">
          <gml:coordinates>11.255737,43.770892 11.256077,43.771476</gml:coordinates>
        </gml:Box>
      </gml:boundedBy>
    </CP.CadastralParcel_feature>
  </CP.CadastralParcel_layer>
</msGMLOutput>`;
    const result = parseFeatureInfoResponse(body, "application/vnd.ogc.gml");

    expect(result.features).toHaveLength(1);
    expect(result.features[0]?.layer).toBe("CP.CadastralParcel");
    // Only the geometry envelope is published, so there is nothing to show.
    expect(result.features[0]?.properties).toEqual({});
  });
});

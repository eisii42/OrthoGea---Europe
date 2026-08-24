/**
 * WMS 1.1.1 capabilities modelled on an Italian regional orthophoto service:
 * `WMT_MS_Capabilities` root, `SRS` lists, `LatLonBoundingBox`, `ScaleHint`,
 * and a child layer that inherits SRS and bounding boxes from its parent.
 */
export const WMS_111_CAPABILITIES = `<?xml version="1.0" encoding="UTF-8"?>
<WMT_MS_Capabilities version="1.1.1" xmlns:xlink="http://www.w3.org/1999/xlink">
  <Service>
    <Name>OGC:WMS</Name>
    <Title>Regional orthophoto service</Title>
    <Abstract>Aerial imagery published by a regional geoportal.</Abstract>
    <KeywordList>
      <Keyword>orthophoto</Keyword>
      <Keyword>aerial</Keyword>
    </KeywordList>
    <OnlineResource xlink:href="https://geoserver.example.it/geoscopio/wms?"/>
    <Fees>none</Fees>
    <AccessConstraints>CC-BY 4.0</AccessConstraints>
  </Service>
  <Capability>
    <Request>
      <GetCapabilities>
        <Format>application/vnd.ogc.wms_xml</Format>
        <DCPType>
          <HTTP>
            <Get><OnlineResource xlink:href="https://geoserver.example.it/geoscopio/wms?"/></Get>
          </HTTP>
        </DCPType>
      </GetCapabilities>
      <GetMap>
        <Format>image/jpeg</Format>
        <Format>image/png</Format>
        <DCPType>
          <HTTP>
            <Get><OnlineResource xlink:href="https://geoserver.example.it/geoscopio/wms?"/></Get>
          </HTTP>
        </DCPType>
      </GetMap>
      <GetFeatureInfo>
        <Format>text/plain</Format>
        <Format>text/html</Format>
        <DCPType>
          <HTTP>
            <Get><OnlineResource xlink:href="https://geoserver.example.it/geoscopio/wms?"/></Get>
          </HTTP>
        </DCPType>
      </GetFeatureInfo>
    </Request>
    <Exception>
      <Format>application/vnd.ogc.se_xml</Format>
    </Exception>
    <Layer queryable="0">
      <Title>Geoscopio orthophotos</Title>
      <SRS>EPSG:4326 EPSG:3003 EPSG:3857</SRS>
      <SRS>EPSG:25832</SRS>
      <LatLonBoundingBox minx="9.68" miny="42.23" maxx="12.37" maxy="44.47"/>
      <BoundingBox SRS="EPSG:4326" minx="9.68" miny="42.23" maxx="12.37" maxy="44.47"/>
      <BoundingBox SRS="EPSG:3003" minx="1550000" miny="4680000" maxx="1780000" maxy="4940000"/>
      <Attribution>
        <Title>Regione Esempio</Title>
        <OnlineResource xlink:href="https://www.regione.example.it/"/>
      </Attribution>
      <Layer queryable="1">
        <Name>rt_ofc.10k22.32bit</Name>
        <Title>Orthophoto 2022 - 20 cm</Title>
        <Abstract>True colour orthophoto flown in 2022.</Abstract>
        <ScaleHint min="0.28" max="2800"/>
        <Style>
          <Name>default</Name>
          <Title>Default</Title>
        </Style>
      </Layer>
      <Layer>
        <Name>rt_ofc.10k19</Name>
        <Title>Orthophoto 2019 - 20 cm</Title>
        <LatLonBoundingBox minx="10.0" miny="42.5" maxx="12.0" maxy="44.0"/>
      </Layer>
    </Layer>
  </Capability>
</WMT_MS_Capabilities>`;

/** Minimal `ServiceExceptionReport`, as returned by a misconfigured endpoint. */
export const WMS_SERVICE_EXCEPTION = `<?xml version="1.0" encoding="UTF-8"?>
<ServiceExceptionReport version="1.1.1">
  <ServiceException code="InvalidFormat">Unsupported format: image/avif</ServiceException>
</ServiceExceptionReport>`;

/**
 * WMS 1.3.0 capabilities modelled on the Italian INSPIRE cadastre service:
 * namespaced elements, latitude-first BoundingBox for EPSG:6706 and EPSG:4326,
 * longitude-first BoundingBox for EPSG:3857, nested queryable sub-layers.
 */
export const WMS_130_CAPABILITIES = `<?xml version="1.0" encoding="UTF-8"?>
<wms:WMS_Capabilities version="1.3.0" xmlns:wms="http://www.opengis.net/wms" xmlns:xlink="http://www.w3.org/1999/xlink">
  <wms:Service>
    <wms:Name>WMS</wms:Name>
    <wms:Title>Cadastral Parcels - INSPIRE</wms:Title>
    <wms:Abstract>INSPIRE view service for cadastral parcels and buildings.</wms:Abstract>
    <wms:KeywordList>
      <wms:Keyword>cadastre</wms:Keyword>
      <wms:Keyword>INSPIRE</wms:Keyword>
    </wms:KeywordList>
    <wms:OnlineResource xlink:href="https://wms.example.gov.it/inspire/wms/owsproxy.sub?"/>
    <wms:ContactInformation>
      <wms:ContactPersonPrimary>
        <wms:ContactPerson>Geoportal desk</wms:ContactPerson>
        <wms:ContactOrganization>Agenzia Nazionale</wms:ContactOrganization>
      </wms:ContactPersonPrimary>
      <wms:ContactElectronicMailAddress>gis@example.gov.it</wms:ContactElectronicMailAddress>
    </wms:ContactInformation>
    <wms:Fees>none</wms:Fees>
    <wms:AccessConstraints>none</wms:AccessConstraints>
    <wms:MaxWidth>2048</wms:MaxWidth>
    <wms:MaxHeight>2048</wms:MaxHeight>
  </wms:Service>
  <wms:Capability>
    <wms:Request>
      <wms:GetCapabilities>
        <wms:Format>text/xml</wms:Format>
        <wms:DCPType>
          <wms:HTTP>
            <wms:Get>
              <wms:OnlineResource xlink:href="https://internal.example.gov.it/wms?"/>
            </wms:Get>
          </wms:HTTP>
        </wms:DCPType>
      </wms:GetCapabilities>
      <wms:GetMap>
        <wms:Format>image/png</wms:Format>
        <wms:Format>image/jpeg</wms:Format>
        <wms:DCPType>
          <wms:HTTP>
            <wms:Get>
              <wms:OnlineResource xlink:href="https://internal.example.gov.it/wms?"/>
            </wms:Get>
          </wms:HTTP>
        </wms:DCPType>
      </wms:GetMap>
      <wms:GetFeatureInfo>
        <wms:Format>text/html</wms:Format>
        <wms:Format>application/json</wms:Format>
        <wms:DCPType>
          <wms:HTTP>
            <wms:Get>
              <wms:OnlineResource xlink:href="https://internal.example.gov.it/wms?"/>
            </wms:Get>
          </wms:HTTP>
        </wms:DCPType>
      </wms:GetFeatureInfo>
    </wms:Request>
    <wms:Exception>
      <wms:Format>XML</wms:Format>
      <wms:Format>INIMAGE</wms:Format>
    </wms:Exception>
    <wms:Layer queryable="0">
      <wms:Title>Cadastre root</wms:Title>
      <wms:CRS>EPSG:6706</wms:CRS>
      <wms:CRS>EPSG:4326</wms:CRS>
      <wms:CRS>EPSG:3857</wms:CRS>
      <wms:CRS>CRS:84</wms:CRS>
      <wms:EX_GeographicBoundingBox>
        <wms:westBoundLongitude>6.6</wms:westBoundLongitude>
        <wms:eastBoundLongitude>18.6</wms:eastBoundLongitude>
        <wms:southBoundLatitude>35.4</wms:southBoundLatitude>
        <wms:northBoundLatitude>47.2</wms:northBoundLatitude>
      </wms:EX_GeographicBoundingBox>
      <wms:BoundingBox CRS="EPSG:6706" minx="35.4" miny="6.6" maxx="47.2" maxy="18.6"/>
      <wms:BoundingBox CRS="EPSG:3857" minx="734730.0" miny="4226661.0" maxx="2070707.0" maxy="5961261.0"/>
      <wms:Attribution>
        <wms:Title>Agenzia Nazionale - Cadastre</wms:Title>
        <wms:OnlineResource xlink:href="https://www.example.gov.it/"/>
      </wms:Attribution>
      <wms:Layer queryable="1">
        <wms:Name>CP.CadastralParcel</wms:Name>
        <wms:Title>Cadastral parcels</wms:Title>
        <wms:Abstract>Parcel geometries and identifiers.</wms:Abstract>
        <wms:KeywordList>
          <wms:Keyword>parcel</wms:Keyword>
        </wms:KeywordList>
        <wms:Style>
          <wms:Name>CP.CadastralParcel.Default</wms:Name>
          <wms:Title>Default style</wms:Title>
          <wms:LegendURL width="120" height="60">
            <wms:Format>image/png</wms:Format>
            <wms:OnlineResource xlink:href="https://wms.example.gov.it/legend/parcel.png"/>
          </wms:LegendURL>
        </wms:Style>
        <wms:MinScaleDenominator>100</wms:MinScaleDenominator>
        <wms:MaxScaleDenominator>8000</wms:MaxScaleDenominator>
        <wms:MetadataURL type="ISO19115:2003">
          <wms:Format>text/xml</wms:Format>
          <wms:OnlineResource xlink:href="https://metadata.example.gov.it/parcel.xml"/>
        </wms:MetadataURL>
      </wms:Layer>
      <wms:Layer queryable="1">
        <wms:Name>BU.Building</wms:Name>
        <wms:Title>Buildings</wms:Title>
        <wms:CRS>EPSG:3003</wms:CRS>
        <wms:BoundingBox CRS="EPSG:3003" minx="1400000.0" miny="4000000.0" maxx="1800000.0" maxy="5200000.0"/>
        <wms:Dimension name="time" units="ISO8601" default="2024-01-01">2020-01-01/2024-01-01/P1Y</wms:Dimension>
      </wms:Layer>
      <wms:Layer>
        <wms:Name>CP.CadastralZoning</wms:Name>
        <wms:Title>Cadastral zoning</wms:Title>
      </wms:Layer>
    </wms:Layer>
  </wms:Capability>
</wms:WMS_Capabilities>`;

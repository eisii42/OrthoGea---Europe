/**
 * WMTS 1.0.0 capabilities modelled on a Copernicus-style tile service:
 * OWS namespaces, both KVP and REST encodings, a GoogleMapsCompatible matrix
 * set and a temporal dimension.
 */
export const WMTS_100_CAPABILITIES = `<?xml version="1.0" encoding="UTF-8"?>
<Capabilities xmlns="http://www.opengis.net/wmts/1.0" xmlns:ows="http://www.opengis.net/ows/1.1" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.0.0">
  <ows:ServiceIdentification>
    <ows:Title>Sentinel-2 tiles</ows:Title>
    <ows:Abstract>Sentinel-2 L2A imagery served as pre-rendered tiles.</ows:Abstract>
    <ows:Keywords>
      <ows:Keyword>Sentinel-2</ows:Keyword>
      <ows:Keyword>satellite</ows:Keyword>
    </ows:Keywords>
    <ows:ServiceType>OGC WMTS</ows:ServiceType>
    <ows:ServiceTypeVersion>1.0.0</ows:ServiceTypeVersion>
    <ows:Fees>none</ows:Fees>
    <ows:AccessConstraints>Copernicus free, full and open licence</ows:AccessConstraints>
  </ows:ServiceIdentification>
  <ows:ServiceProvider>
    <ows:ProviderName>Copernicus Data Space Ecosystem</ows:ProviderName>
    <ows:ProviderSite xlink:href="https://dataspace.copernicus.eu/"/>
  </ows:ServiceProvider>
  <ows:OperationsMetadata>
    <ows:Operation name="GetCapabilities">
      <ows:DCP>
        <ows:HTTP>
          <ows:Get xlink:href="https://tiles.example.eu/wmts?">
            <ows:Constraint name="GetEncoding">
              <ows:AllowedValues><ows:Value>KVP</ows:Value></ows:AllowedValues>
            </ows:Constraint>
          </ows:Get>
        </ows:HTTP>
      </ows:DCP>
    </ows:Operation>
    <ows:Operation name="GetTile">
      <ows:DCP>
        <ows:HTTP>
          <ows:Get xlink:href="https://tiles.example.eu/wmts?">
            <ows:Constraint name="GetEncoding">
              <ows:AllowedValues>
                <ows:Value>KVP</ows:Value>
                <ows:Value>REST</ows:Value>
              </ows:AllowedValues>
            </ows:Constraint>
          </ows:Get>
        </ows:HTTP>
      </ows:DCP>
    </ows:Operation>
    <ows:Operation name="GetFeatureInfo">
      <ows:DCP>
        <ows:HTTP>
          <ows:Get xlink:href="https://tiles.example.eu/wmts?">
            <ows:Constraint name="GetEncoding">
              <ows:AllowedValues><ows:Value>KVP</ows:Value></ows:AllowedValues>
            </ows:Constraint>
          </ows:Get>
        </ows:HTTP>
      </ows:DCP>
    </ows:Operation>
  </ows:OperationsMetadata>
  <Contents>
    <Layer>
      <ows:Title>Sentinel-2 True Colour</ows:Title>
      <ows:Abstract>True colour composite from bands 4, 3 and 2.</ows:Abstract>
      <ows:Keywords><ows:Keyword>true-color</ows:Keyword></ows:Keywords>
      <ows:WGS84BoundingBox>
        <ows:LowerCorner>-25.0 32.0</ows:LowerCorner>
        <ows:UpperCorner>45.0 72.0</ows:UpperCorner>
      </ows:WGS84BoundingBox>
      <ows:Identifier>TRUE_COLOR</ows:Identifier>
      <Style isDefault="true">
        <ows:Identifier>default</ows:Identifier>
      </Style>
      <Format>image/jpeg</Format>
      <Format>image/png</Format>
      <InfoFormat>application/json</InfoFormat>
      <Dimension>
        <ows:Identifier>TIME</ows:Identifier>
        <ows:UOM>ISO8601</ows:UOM>
        <Default>2024-06-01</Default>
        <Value>2024-06-01</Value>
        <Value>2024-07-01</Value>
      </Dimension>
      <TileMatrixSetLink>
        <TileMatrixSet>GoogleMapsCompatible</TileMatrixSet>
      </TileMatrixSetLink>
      <ResourceURL format="image/jpeg" resourceType="tile" template="https://tiles.example.eu/wmts/TRUE_COLOR/GoogleMapsCompatible/{TileMatrix}/{TileRow}/{TileCol}.jpg"/>
    </Layer>
    <TileMatrixSet>
      <ows:Identifier>GoogleMapsCompatible</ows:Identifier>
      <ows:SupportedCRS>urn:ogc:def:crs:EPSG::3857</ows:SupportedCRS>
      <WellKnownScaleSet>urn:ogc:def:wkss:OGC:1.0:GoogleMapsCompatible</WellKnownScaleSet>
      <TileMatrix>
        <ows:Identifier>0</ows:Identifier>
        <ScaleDenominator>559082264.0287178</ScaleDenominator>
        <TopLeftCorner>-20037508.34278925 20037508.34278925</TopLeftCorner>
        <TileWidth>256</TileWidth>
        <TileHeight>256</TileHeight>
        <MatrixWidth>1</MatrixWidth>
        <MatrixHeight>1</MatrixHeight>
      </TileMatrix>
      <TileMatrix>
        <ows:Identifier>1</ows:Identifier>
        <ScaleDenominator>279541132.0143589</ScaleDenominator>
        <TopLeftCorner>-20037508.34278925 20037508.34278925</TopLeftCorner>
        <TileWidth>256</TileWidth>
        <TileHeight>256</TileHeight>
        <MatrixWidth>2</MatrixWidth>
        <MatrixHeight>2</MatrixHeight>
      </TileMatrix>
    </TileMatrixSet>
    <TileMatrixSet>
      <ows:Identifier>EPSG:4326</ows:Identifier>
      <ows:SupportedCRS>urn:ogc:def:crs:EPSG::4326</ows:SupportedCRS>
      <TileMatrix>
        <ows:Identifier>0</ows:Identifier>
        <ScaleDenominator>279541132.0143589</ScaleDenominator>
        <TopLeftCorner>90.0 -180.0</TopLeftCorner>
        <TileWidth>256</TileWidth>
        <TileHeight>256</TileHeight>
        <MatrixWidth>2</MatrixWidth>
        <MatrixHeight>1</MatrixHeight>
      </TileMatrix>
    </TileMatrixSet>
  </Contents>
</Capabilities>`;

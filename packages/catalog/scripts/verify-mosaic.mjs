/**
 * Live check of the seamless imagery mosaic.
 *
 * Walks a set of places and zoom levels, prints which source the mosaic picks
 * for the tile under the coordinate and fetches it, so the zoom hand-over
 * (Sentinel-2 below, orthophoto above) can be verified against the real
 * services rather than in a unit test.
 *
 * Usage: node scripts/verify-mosaic.mjs [--no-fetch]
 */
import { catalog, DEFAULT_SATELLITE_FALLBACK_ID } from "@orthogea/catalog";
import { lngLatToTile } from "@orthogea/core";
import { createMosaic, DEFAULT_ORTHOPHOTO_FROM_ZOOM } from "@orthogea/client";

const fetchTiles = !process.argv.includes("--no-fetch");

const places = [
  { name: "Firenze", lng: 11.2558, lat: 43.7696, zooms: [6, 10, 11, 12, 14, 18] },
  { name: "Milano", lng: 9.19, lat: 45.4642, zooms: [12, 16] },
  { name: "Napoli", lng: 14.2681, lat: 40.8518, zooms: [12, 16] },
  { name: "Genova", lng: 8.9463, lat: 44.4056, zooms: [12, 16] },
  { name: "Aosta", lng: 7.3167, lat: 45.7372, zooms: [12, 16] },
  { name: "Trento", lng: 11.1211, lat: 46.0679, zooms: [14] },
  { name: "Matera", lng: 16.6043, lat: 40.6664, zooms: [14] },
  { name: "Palermo", lng: 13.3615, lat: 38.1157, zooms: [14] },
  { name: "Paris", lng: 2.3522, lat: 48.8566, zooms: [14] },
  { name: "Madrid", lng: -3.7038, lat: 40.4168, zooms: [14] },
  { name: "Zurich", lng: 8.5417, lat: 47.3769, zooms: [14] },
  { name: "Atlantic", lng: -25, lat: 45, zooms: [14] }
];

const mosaic = createMosaic({ layers: [...catalog], fallback: DEFAULT_SATELLITE_FALLBACK_ID });

console.log(
  `# mosaic: ${mosaic.sources.length} imagery sources, orthophotos from z${DEFAULT_ORTHOPHOTO_FROM_ZOOM}, fallback ${mosaic.fallback?.id}\n`
);

let failures = 0;

for (const place of places) {
  for (const zoom of place.zooms) {
    // The zooms above are what the user sees; a 512 px mosaic is asked for the
    // pyramid level below.
    const tileZoom = mosaic.tileSize === 512 ? zoom - 1 : zoom;
    const [x, y] = lngLatToTile(place.lng, place.lat, tileZoom);
    const chosen = mosaic.bestFor(x, y, tileZoom);
    let detail = "";

    if (fetchTiles) {
      try {
        const tile = await mosaic.fetchTile(x, y, tileZoom);
        detail = `${String(tile.data.byteLength).padStart(7)} B ${tile.contentType}${
          tile.layer.id === chosen?.id ? "" : `  (served by ${tile.layer.id})`
        }`;
      } catch (error) {
        detail = `FAILED: ${error.message.slice(0, 70)}`;
        failures += 1;
      }
    }

    console.log(
      `z${String(zoom).padStart(2)}  ${place.name.padEnd(9)} -> ${(chosen?.id ?? "none").padEnd(34)} ${detail}`
    );
  }
}

console.log(failures === 0 ? "\nEvery tile was served." : `\n${failures} tiles failed.`);
if (failures > 0) process.exitCode = 1;

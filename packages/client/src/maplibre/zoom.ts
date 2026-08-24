import type { DetailZoomOptions, Mosaic } from "../mosaic.js";

/**
 * The slice of the MapLibre map this helper needs.
 *
 * Declared structurally so the package stays free of a `maplibre-gl`
 * dependency; a real `Map` satisfies it, and so does a test double.
 */
export interface ZoomLimitTarget {
  getCenter(): { lng: number; lat: number };
  getZoom(): number;
  setMaxZoom(zoom?: number | null): unknown;
  on(type: string, listener: () => void): unknown;
  off(type: string, listener: () => void): unknown;
}

export interface ZoomLimitOptions extends DetailZoomOptions {
  /**
   * Map event that triggers a recalculation. `moveend` (the default) applies
   * the limit once the reader has stopped, which is what keeps a pan into a
   * coarser country from snapping the view mid-gesture.
   */
  event?: string;
  /** Called whenever the limit changes, for a UI that wants to explain it. */
  onChange?: (maxZoom: number) => void;
}

/**
 * Caps how far a map can zoom at the resolution of the imagery beneath it.
 *
 * Half of Europe has no open orthophoto, and there the map sits on the 2 m
 * European base. Zooming to 20 over Sofia or Hamburg reveals nothing - it just
 * enlarges pixels, and an upscaled satellite image is the one thing that makes
 * an open basemap look cheap next to a commercial one. This stops the map where
 * the data stops, and lifts the ceiling again as soon as the reader moves
 * somewhere better surveyed.
 *
 * ```ts
 * const release = bindDetailZoomLimit(map, mosaic);
 * // ... later
 * release();
 * ```
 *
 * @returns a function that removes the listener and restores the previous limit.
 */
export function bindDetailZoomLimit(
  map: ZoomLimitTarget,
  mosaics: Mosaic | readonly Mosaic[],
  options: ZoomLimitOptions = {}
): () => void {
  const event = options.event ?? "moveend";
  // A map is usually drawn from a base plus an orthophoto layer above it. The
  // deepest of the two is what the reader actually sees, so that is the limit.
  const all = Array.isArray(mosaics) ? (mosaics as readonly Mosaic[]) : [mosaics as Mosaic];
  let applied: number | undefined;

  const update = (): void => {
    const center = map.getCenter();
    const deepest = Math.max(
      ...all.map((mosaic) => mosaic.detailZoomAt(center.lng, center.lat, options))
    );
    const limit = Math.round(deepest * 10) / 10;
    // Re-applying an unchanged limit would make MapLibre re-render for nothing.
    if (applied !== undefined && Math.abs(applied - limit) < 0.05) return;
    applied = limit;
    map.setMaxZoom(limit);
    options.onChange?.(limit);
  };

  map.on(event, update);
  update();

  return () => {
    map.off(event, update);
    // `null` restores MapLibre's own default ceiling.
    map.setMaxZoom(null);
  };
}

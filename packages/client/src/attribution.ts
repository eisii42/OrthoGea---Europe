import type { OrthoGeaLayer } from "@orthogea/core";

export interface AttributionOptions {
  /** Append the licence identifier. Defaults to `true`. */
  includeLicense?: boolean;
  /** Render the licence as an HTML link when a URL is known. Defaults to `true`. */
  html?: boolean;
}

/**
 * Builds the attribution string a map control should display for a layer.
 *
 * European open data licences almost always require visible credit, so this is
 * generated from the catalogue record rather than left to the integrator.
 */
export function formatAttribution(
  layer: OrthoGeaLayer,
  options: AttributionOptions = {}
): string {
  const { includeLicense = true, html = true } = options;
  const provider = layer.provider.url && html
    ? `<a href="${layer.provider.url}" target="_blank" rel="noopener">${layer.attribution}</a>`
    : layer.attribution;

  if (!includeLicense || layer.license.id === "unknown") return provider;

  const label = layer.license.name ?? layer.license.id;
  const licence = layer.license.url && html
    ? `<a href="${layer.license.url}" target="_blank" rel="noopener">${label}</a>`
    : label;

  return `${provider} (${licence})`;
}

/** Deduplicated attribution line for a set of layers shown at the same time. */
export function formatAttributions(
  layers: readonly OrthoGeaLayer[],
  options: AttributionOptions = {}
): string {
  const seen = new Set<string>();
  for (const layer of layers) seen.add(formatAttribution(layer, options));
  return [...seen].join(" | ");
}

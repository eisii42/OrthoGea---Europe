/**
 * Raw catalogue documents, one per NUTS-0 scope.
 *
 * The JSON files are the source of truth: edit them (or add a new one and
 * register it here) to extend the registry. Everything is validated against
 * the Zod schema when {@link ../registry.js} builds the catalogue.
 */
import at from "../data/at.json";
import be from "../data/be.json";
import ch from "../data/ch.json";
import cz from "../data/cz.json";
import de from "../data/de.json";
import dk from "../data/dk.json";
import ee from "../data/ee.json";
import el from "../data/el.json";
import es from "../data/es.json";
import eu from "../data/eu.json";
import fr from "../data/fr.json";
import hr from "../data/hr.json";
import itRegions from "../data/it-regions.json";
import it from "../data/it.json";
import nl from "../data/nl.json";
import pl from "../data/pl.json";
import pt from "../data/pt.json";
import se from "../data/se.json";
import si from "../data/si.json";
import sk from "../data/sk.json";

/** Every bundled collection, keyed by the file it comes from. */
export const RAW_COLLECTIONS: Record<string, unknown> = {
  "eu.json": eu,
  "it.json": it,
  "it-regions.json": itRegions,
  "es.json": es,
  "fr.json": fr,
  "de.json": de,
  "nl.json": nl,
  "be.json": be,
  "pt.json": pt,
  "ch.json": ch,
  "at.json": at,
  "pl.json": pl,
  "cz.json": cz,
  "sk.json": sk,
  "si.json": si,
  "hr.json": hr,
  "el.json": el,
  "ee.json": ee,
  "dk.json": dk,
  "se.json": se
};

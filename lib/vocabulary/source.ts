import type { VocabularySource } from "./types";
import { ankiSource } from "./sources/anki";

// Re-exported so call sites can keep importing the contract from the
// registry module; it is defined in `./types` alongside the neutral types.
export type { VocabularySource } from "./types";

export const DEFAULT_SOURCE_ID = "anki";

const registry: Record<string, VocabularySource> = {
  [ankiSource.id]: ankiSource,
};

export function getVocabularySource(id: string = DEFAULT_SOURCE_ID): VocabularySource {
  // `Object.hasOwn` rather than a truthiness check: a plain-object lookup
  // for e.g. "constructor" would otherwise resolve up the prototype chain.
  if (!Object.hasOwn(registry, id)) {
    throw new Error(`Không tìm thấy nguồn từ vựng: ${id}`);
  }
  return registry[id];
}

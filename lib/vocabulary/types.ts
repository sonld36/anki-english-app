// Neutral vocabulary types — no transport, no source-specific logic.
// Safe to import from both server and client code.

export interface VocabularyItem {
  /** Stable identifier within its source. Only used as a React key. */
  id: string;
  word: string;
  meaning: string;
  /**
   * Anki-specific metadata. Optional by design: consumers must never
   * branch on source-specific fields.
   */
  ankiModelName?: string;
}

export interface VocabularyCollection {
  id: string;
  name: string;
}

/**
 * The swap point for vocabulary providers. Deliberately minimal: two
 * methods, no lifecycle, no config. `setupHint` is data (not JSX) so the
 * UI can render connection help without naming any particular source.
 *
 * Inside a `setupHint` step, `**text**` renders emphasised and `` `text` ``
 * renders as a code chip — see `parseSetupHintStep` in `./setup-hint`.
 *
 * Lives here rather than in `./source` so that the contract and the types
 * it is written in sit in one transport-free module, and so a concrete
 * source can implement it without importing the registry that lists it.
 */
export interface VocabularySource {
  readonly id: string;
  readonly label: string;
  readonly setupHint?: { title: string; steps: string[] };
  listCollections(): Promise<VocabularyCollection[]>;
  fetchItems(collectionId: string): Promise<VocabularyItem[]>;
}

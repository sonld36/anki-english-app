/**
 * Setup-hint steps are plain strings (see `VocabularySource` in `./types`),
 * so a source can describe its own recovery instructions without shipping
 * JSX. This module turns one step into renderable segments.
 *
 * Two inline markers, both optional:
 *   `**text**` -- emphasised, for the names of things to open or install
 *   `` `text` ``  -- a code chip, for values the user has to copy
 *
 * Kept transport- and React-free so it is testable under the node
 * environment; the component only maps segments onto elements.
 */

export interface SetupHintSegment {
  text: string;
  strong?: boolean;
  code?: boolean;
}

const MARKUP = /(\*\*[^*]+\*\*|`[^`]+`)/g;

export function parseSetupHintStep(step: string): SetupHintSegment[] {
  return step
    .split(MARKUP)
    .filter((part) => part !== "")
    .map((part) => {
      if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) {
        return { text: part.slice(2, -2), strong: true };
      }
      if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
        return { text: part.slice(1, -1), code: true };
      }
      return { text: part };
    });
}

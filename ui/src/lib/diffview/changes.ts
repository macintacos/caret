// Change-block stops for compare's ]] / [[ (EXC-965). A stop is a run of changed lines,
// not an @@ hunk: one hunk holds every edit within its context window, so stepping by
// hunk would skip all but its first. parseDiffFromFile keeps every line of both files,
// so a ChangeContent index into deletionLines/additionLines is the 0-based file line.
import {
  type CreatePatchOptionsNonabortable,
  type FileContents,
  parseDiffFromFile,
} from "@pierre/diffs";

import type { DiffLine } from "$lib/diffview/types.ts";

/** The first row of each change block — a run of consecutive removed and/or added
 * lines — in document order. A block that removes lines starts on its first removed
 * line, since unified renders removals above additions; a pure addition starts on its
 * first added line. Parsed as FileDiff parses its own input, so the blocks are the ones
 * the view renders. */
export function changeStarts(
  oldFile: FileContents,
  newFile: FileContents,
  parseOptions?: CreatePatchOptionsNonabortable,
): DiffLine[] {
  return parseDiffFromFile(oldFile, newFile, parseOptions).hunks.flatMap((hunk) =>
    hunk.hunkContent.flatMap((c): DiffLine[] => {
      if (c.type !== "change") return [];
      return c.deletions > 0
        ? [{ line: c.deletionLineIndex + 1, side: "before" }]
        : [{ line: c.additionLineIndex + 1, side: "after" }];
    }),
  );
}

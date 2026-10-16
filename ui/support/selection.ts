/** Makes `start`..`end` the document's one selected range, collapsed by default, and
 * returns it. */
export function selectText(start: [Node, number], end: [Node, number] = start): Range {
  const range = document.createRange();
  range.setStart(...start);
  range.setEnd(...end);
  const selection = document.getSelection() as Selection;
  selection.removeAllRanges();
  selection.addRange(range);
  return range;
}

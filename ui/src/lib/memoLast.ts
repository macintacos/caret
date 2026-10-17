/** Wrap `compute` so a call with the last key returns the last result — the same
 * reference — without recomputing. */
export function memoLast<T>(compute: (key: string) => T): (key: string) => T {
  let last: { key: string; value: T } | undefined;
  return (key) => {
    if (last?.key !== key) last = { key, value: compute(key) };
    return last.value;
  };
}

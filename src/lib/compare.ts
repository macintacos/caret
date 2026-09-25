/** Order two strings by UTF-16 code unit — the same order in every locale, which
 * `localeCompare` doesn't give. */
export function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

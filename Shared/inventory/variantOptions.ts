/**
 * A variant's options — Colour: Black, Storage: 256 GB — and the one question
 * both sides ask of them: can a shopper tell every variant apart by them?
 *
 * Pure, and imported by the editor and the storefront's picker alike, so the
 * editor's "shoppers will pick by name" warning and the product page drawing
 * names rather than swatches are the same answer rather than two guesses.
 */

export type OptionPair = { name: string; value: string };

export const OPTION_NAME_MAX = 60;
export const OPTION_VALUE_MAX = 120;

/**
 * The pairs as typed, as the record that is saved: outer spaces trimmed and a
 * row left wholly blank dropped. A half-filled row is not dropped here — that
 * is `optionPairsProblem`'s to refuse, because guessing which half was meant
 * would save something nobody typed.
 */
export function optionsRecord(pairs: OptionPair[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (const pair of pairs) {
    const name = pair.name.trim();
    const value = pair.value.trim();
    if (name && value) record[name] = value;
  }
  return record;
}

/** The record as rows to edit, in the order it was saved. */
export function optionPairs(record: Record<string, string> | null | undefined): OptionPair[] {
  return Object.entries(record ?? {}).map(([name, value]) => ({ name, value }));
}

export function optionPairsProblem(pairs: OptionPair[]): "admin.optionHalf" | "admin.optionDuplicate" | "admin.optionTooLong" | null {
  const seen = new Set<string>();
  for (const pair of pairs) {
    const name = pair.name.trim();
    const value = pair.value.trim();
    if (!name && !value) continue;
    if (!name || !value) return "admin.optionHalf";
    if (name.length > OPTION_NAME_MAX || value.length > OPTION_VALUE_MAX) return "admin.optionTooLong";
    /* "Colour" and "colour" would be two rows on the product page. */
    const key = name.toLocaleLowerCase();
    if (seen.has(key)) return "admin.optionDuplicate";
    seen.add(key);
  }
  return null;
}

/**
 * The names whose value differs between at least two variants. An option
 * every variant shares ("Material: Steel" on each) is a fact, not a choice.
 */
export function varyingOptionNames(variants: Array<Record<string, string>>): string[] {
  const values = new Map<string, Set<string>>();
  for (const options of variants) {
    for (const [name, value] of Object.entries(options)) {
      if (!values.has(name)) values.set(name, new Set());
      values.get(name)!.add(value);
    }
  }
  return Array.from(values.entries()).filter(([, seen]) => seen.size > 1).map(([name]) => name);
}

/**
 * True when every variant carries a value for every option that varies and no
 * two share a combination — the condition for drawing options as choices. One
 * variant has nothing to tell apart, so it is false.
 */
export function optionsDistinguish(variants: Array<Record<string, string>>): boolean {
  if (variants.length < 2) return false;
  const varying = varyingOptionNames(variants);
  if (varying.length === 0) return false;
  if (!variants.every(options => varying.every(name => name in options))) return false;
  const combos = new Set(variants.map(options => varying.map(name => options[name]).join("\u001f")));
  return combos.size === variants.length;
}

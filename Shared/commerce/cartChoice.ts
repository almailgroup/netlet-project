/**
 * Which lines of the bag are chosen for checkout, on the owner's word ("you
 * should be able to choose what products you want the price for and only
 * checkout for those products"): a circle beside every line and every store,
 * All at the foot, and the totals, the delivery and Checkout counting the
 * chosen lines alone; the rest stay in the bag for another day.
 *
 * **The device keeps what is *not* chosen, and the server is told.** A skip
 * list rather than a chosen list, so a line added later — on this device or
 * another — is chosen without anybody choosing it, which is what a shopper
 * who just pressed Add expects. It is kept with the bag's id on the device
 * (no column, no table) and sent with every read of the bag and with the
 * order, and the server prices, delivers and places only what it leaves;
 * an id the bag no longer has is ignored, so a stale list costs nothing.
 *
 * **A set is chosen whole.** A bundle's lines are priced as a set only while
 * the set is together (3.3.11), so leaving one member behind would quietly
 * charge the others full price; a circle on any of them moves them all.
 *
 * Pure, and the Swift app's `CartChoice` is the same rule on the same cases.
 */

/** As many lines as a bag can sensibly hold; more is a request to refuse, not to read. */
export const MAX_SKIPPED_LINES = 100;

/** A line as the rule needs it: its id, and the set it was added as, when it was. */
export type ChoosableLine = { lineId: string; bundleId?: string | null };

/** The lines a skip list leaves out, a set whole: any member skipped skips the set. */
export function skippedLineIds(lines: readonly ChoosableLine[], skip: readonly string[]): Set<string> {
  const asked = new Set(skip);
  const sets = new Set(lines.filter(line => asked.has(line.lineId) && line.bundleId).map(line => line.bundleId!));
  return new Set(lines.filter(line => asked.has(line.lineId) || (line.bundleId && sets.has(line.bundleId))).map(line => line.lineId));
}

/** Whether this line is chosen. */
export function isChosen(lines: readonly ChoosableLine[], skip: readonly string[], lineId: string): boolean {
  return !skippedLineIds(lines, skip).has(lineId);
}

/** The chosen lines' ids, in the bag's order. */
export function chosenLineIds(lines: readonly ChoosableLine[], skip: readonly string[]): string[] {
  const skipped = skippedLineIds(lines, skip);
  return lines.filter(line => !skipped.has(line.lineId)).map(line => line.lineId);
}

/** The skip list with only ids the bag still has — what is kept after every answer. */
export function pruneSkip(lines: readonly ChoosableLine[], skip: readonly string[]): string[] {
  const skipped = skippedLineIds(lines, skip);
  return lines.filter(line => skipped.has(line.lineId)).map(line => line.lineId);
}

/**
 * Choose these lines, or leave them out: the new skip list. A set moves whole,
 * whichever of its lines was pressed.
 */
export function chooseLines(lines: readonly ChoosableLine[], skip: readonly string[], lineIds: readonly string[], chosen: boolean): string[] {
  const pressed = new Set(lineIds);
  const sets = new Set(lines.filter(line => pressed.has(line.lineId) && line.bundleId).map(line => line.bundleId!));
  const touched = new Set(lines.filter(line => pressed.has(line.lineId) || (line.bundleId && sets.has(line.bundleId))).map(line => line.lineId));
  const before = skippedLineIds(lines, skip);
  return lines
    .filter(line => (touched.has(line.lineId) ? !chosen : before.has(line.lineId)))
    .map(line => line.lineId);
}

/**
 * Only these lines chosen, everything else left out — what Buy now does, so
 * "Buy 3 now" buys those three and not the rest of the bag. A line not in the
 * bag yet (the press that is adding it) is chosen by not being on the list.
 */
export function chooseOnly(lines: readonly ChoosableLine[], lineIds: readonly string[]): string[] {
  /* The lines kept bring their sets with them, before the rest are left out. */
  const sets = new Set(lines.filter(line => lineIds.includes(line.lineId) && line.bundleId).map(line => line.bundleId!));
  const kept = new Set(lines.filter(line => lineIds.includes(line.lineId) || (line.bundleId && sets.has(line.bundleId))).map(line => line.lineId));
  return lines.filter(line => !kept.has(line.lineId)).map(line => line.lineId);
}

/** All, none or some of these lines chosen — the state of a store's circle or of All. */
export function choiceOf(lines: readonly ChoosableLine[], skip: readonly string[], lineIds?: readonly string[]): "all" | "none" | "some" {
  const among = lineIds ? lines.filter(line => lineIds.includes(line.lineId)) : lines;
  if (!among.length) return "none";
  const skipped = skippedLineIds(lines, skip);
  const out = among.filter(line => skipped.has(line.lineId)).length;
  return out === 0 ? "all" : out === among.length ? "none" : "some";
}

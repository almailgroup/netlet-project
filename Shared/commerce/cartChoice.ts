/**
 * Which lines of the bag are chosen for checkout, on the owner's word ("you
 * should be able to choose what products you want the price for and only
 * checkout for those products"): a circle beside every line and every store,
 * All at the foot, and the totals, the delivery and Checkout counting the
 * chosen lines alone. **A line unticked moves to Saved for later**
 * (`untickPlan`, below); the skip list is what Buy now leaves out.
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

/** A line as moving it to Saved for later needs it: its product, and whether it carries extras or a set. */
export type SavableLine = ChoosableLine & {
  productId?: string | null;
  addons?: readonly unknown[] | null;
  bundleName?: string | null;
};

/** What unticking some lines does (`untickPlan`). */
export type UntickPlan = {
  /** The lines that leave the bag for Saved for later, a set whole. */
  move: string[];
  /** Their products, once each, in the bag's order: what Saved gains. */
  productIds: string[];
  /** Lines whose product the bag does not say — left out of this checkout instead, as before. */
  leave: string[];
  /**
   * Whether Undo can put every line moved back as it was. A line with extras
   * or priced as part of a set cannot be added again as the same line, so a
   * press that moved one offers no Undo — the line menu's own rule.
   */
  undoable: boolean;
};

/**
 * **Unticking a line moves it to Saved for later, on the owner's word**
 * ("automatically move products to Save for Later when unchecked in the
 * cart"). A line, a store or All unticked leaves the bag for Saved — the
 * hearts, which the cart lists under Checkout as "Saved for later" with a way
 * back — rather than staying in the bag left out. A set moves whole, since its
 * lines are priced as a set only together. A line whose product the bag does
 * not say (a bag read before it was sent) cannot be saved, so it is left out
 * of this checkout as unticking did before; a set holding one is left out
 * whole, never split. Ticking stays the skip list's: the lines Buy now leaves
 * out are drawn unticked, and ticking one chooses it.
 */
export function untickPlan(lines: readonly SavableLine[], lineIds: readonly string[]): UntickPlan {
  const pressed = new Set(lineIds);
  const sets = new Set(lines.filter(line => pressed.has(line.lineId) && line.bundleId).map(line => line.bundleId!));
  const touched = lines.filter(line => pressed.has(line.lineId) || (line.bundleId && sets.has(line.bundleId)));
  /* A set with a line that cannot be saved stays together in the bag. */
  const stuckSets = new Set(touched.filter(line => !line.productId && line.bundleId).map(line => line.bundleId!));
  const moves = (line: SavableLine) => Boolean(line.productId) && !(line.bundleId && stuckSets.has(line.bundleId));
  const move = touched.filter(moves);
  return {
    move: move.map(line => line.lineId),
    productIds: Array.from(new Set(move.map(line => line.productId!))),
    leave: touched.filter(line => !moves(line)).map(line => line.lineId),
    undoable: move.length > 0 && move.every(line => !line.addons?.length && !line.bundleId && !line.bundleName),
  };
}

/** All, none or some of these lines chosen — the state of a store's circle or of All. */
export function choiceOf(lines: readonly ChoosableLine[], skip: readonly string[], lineIds?: readonly string[]): "all" | "none" | "some" {
  const among = lineIds ? lines.filter(line => lineIds.includes(line.lineId)) : lines;
  if (!among.length) return "none";
  const skipped = skippedLineIds(lines, skip);
  const out = among.filter(line => skipped.has(line.lineId)).length;
  return out === 0 ? "all" : out === among.length ? "none" : "some";
}

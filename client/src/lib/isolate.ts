/**
 * A merchant's words — or a reference, an email — placed inside one of ours,
 * kept in their own direction.
 *
 * A product name goes into "Delete “{title}”?" and into toasts, and a Latin
 * name inside an Arabic sentence otherwise takes the sentence's punctuation
 * with it — the quote marks and a trailing hyphen landed on the wrong sides.
 * First-strong isolate and its pop are what `<bdi>` does, for a string.
 *
 * The opposite of forcing the whole sentence left to right, which is what
 * `<bdi dir="ltr">` around `t(…)` did: the Arabic words of the sentence then
 * ran in the wrong order around the value.
 */
export const isolate = (text: string) => `⁨${text}⁩`;

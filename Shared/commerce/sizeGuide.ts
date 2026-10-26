/**
 * Size guides (3.1.20): a seller's chart, and which size fits.
 *
 * Pure and imported by both sides, for the reason the password floor is: the
 * editor refuses what the API would, and the shopper's answer is computed in
 * their own browser by the same function the tests exercise.
 *
 * ## The chart is the seller's, in centimetres
 *
 * A chart is a range per measurement per size — "M fits a 96–101 cm chest" —
 * because that is what a size *means* and the only thing a recommendation can
 * honestly be made from. One unit, centimetres: Kuwait is metric, and a chart
 * that mixed inches and centimetres across sellers is how a shopper ends up a
 * size out. The measurements are a closed list so each has a translated label
 * and a how-to-measure hint, for the reason `vendorHealth` keeps its keys
 * closed: a free-text column name is an English word in the middle of an
 * Arabic page.
 *
 * ## The answer is a rule, and says why
 *
 * Every size whose ranges hold every measurement the shopper gave is a fit;
 * the first such — charts run small to large — is the answer. When none holds
 * all of them, the size that holds the most wins, then the one nearest on the
 * rest, and a true tie goes to the **larger** size, because a garment a little
 * loose is worn and one a little tight goes back. Each answer carries the comparison behind it, measurement by
 * measurement, so "we suggest L" is something the shopper can check against
 * the chart rather than take on trust. Below the smallest or above the largest
 * size on every measurement is said in those words rather than rounded to the
 * nearest size, which would be the shop recommending something it knows does
 * not fit.
 *
 * ## The measurements never leave the browser
 *
 * The shopper's chest and waist are computed against the chart on the page
 * and kept, if at all, in that browser's own storage. Nothing about anybody's
 * body is sent to NetLet or to a model: the recommendation needs a chart and
 * a number, and nothing else.
 */

export const MEASURES = ["chest", "waist", "hips", "inseam", "footLength", "height"] as const;
export type BodyMeasure = (typeof MEASURES)[number];

/** Generous outer bounds, in centimetres: nothing a body measures falls outside them. */
export const MEASURE_BOUNDS: Record<BodyMeasure, { min: number; max: number }> = {
  chest: { min: 30, max: 200 },
  waist: { min: 30, max: 200 },
  hips: { min: 30, max: 200 },
  inseam: { min: 20, max: 120 },
  footLength: { min: 8, max: 40 },
  height: { min: 40, max: 230 },
};

export const MAX_SIZES = 20;
export const MAX_SIZE_LABEL = 20;

export type SizeRow = { size: string; ranges: Partial<Record<BodyMeasure, [number, number]>> };

export type SizeChart = {
  /** The variant option the sizes are values of, e.g. "Size". */
  axis: string;
  measures: BodyMeasure[];
  /** Smallest first. */
  rows: SizeRow[];
};

export type ChartProblem =
  | "sizeGuide.noMeasures"
  | "sizeGuide.noRows"
  | "sizeGuide.tooManyRows"
  | "sizeGuide.badSize"
  | "sizeGuide.duplicateSize"
  | "sizeGuide.missingRange"
  | "sizeGuide.badRange";

export function isMeasure(value: string): value is BodyMeasure {
  return (MEASURES as readonly string[]).includes(value);
}

/**
 * What is wrong with a chart, or null when it can be saved.
 *
 * Every row must give a range for every measure the chart declares: a gap in
 * the middle of a chart is a size the recommendation cannot place, and it
 * would silently skip it.
 */
export function chartProblem(chart: SizeChart): ChartProblem | null {
  if (chart.measures.length === 0 || new Set(chart.measures).size !== chart.measures.length || !chart.measures.every(isMeasure)) return "sizeGuide.noMeasures";
  if (chart.rows.length === 0) return "sizeGuide.noRows";
  if (chart.rows.length > MAX_SIZES) return "sizeGuide.tooManyRows";
  const seen = new Set<string>();
  for (const row of chart.rows) {
    const size = row.size.trim();
    if (!size || size.length > MAX_SIZE_LABEL) return "sizeGuide.badSize";
    if (seen.has(size.toLowerCase())) return "sizeGuide.duplicateSize";
    seen.add(size.toLowerCase());
    for (const measure of chart.measures) {
      const range = row.ranges[measure];
      if (!range) return "sizeGuide.missingRange";
      const [low, high] = range;
      const bounds = MEASURE_BOUNDS[measure];
      if (!Number.isFinite(low) || !Number.isFinite(high) || low > high || low < bounds.min || high > bounds.max) return "sizeGuide.badRange";
    }
    /* A range for a measure the chart does not declare is dropped by
       `cleanChart`, not refused: it is what is left after unticking a column. */
  }
  return null;
}

/** The chart as stored: sizes trimmed, ranges only for declared measures, numbers to one decimal. */
export function cleanChart(chart: SizeChart): SizeChart {
  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    axis: chart.axis.trim(),
    measures: chart.measures.filter(isMeasure),
    rows: chart.rows.map(row => ({
      size: row.size.trim(),
      ranges: Object.fromEntries(
        chart.measures.filter(measure => row.ranges[measure]).map(measure => {
          const [low, high] = row.ranges[measure]!;
          return [measure, [round(low), round(high)]];
        }),
      ) as SizeRow["ranges"],
    })),
  };
}

export type Comparison = { measure: BodyMeasure; value: number; range: [number, number]; verdict: "within" | "below" | "above" };

export type SizeAnswer =
  /** Every measurement given falls inside this size. */
  | { kind: "fits"; size: string; comparisons: Comparison[] }
  /** No size holds every measurement; this one holds the most, larger on a tie. */
  | { kind: "closest"; size: string; comparisons: Comparison[] }
  /** Smaller, or larger, than every size on the chart on every measurement given. */
  | { kind: "belowChart" }
  | { kind: "aboveChart" }
  /** Nothing to compare: no measurement given that the chart uses. */
  | { kind: "nothingToCompare" };

function compare(row: SizeRow, measure: BodyMeasure, value: number): Comparison | null {
  const range = row.ranges[measure];
  if (!range) return null;
  const verdict = value < range[0] ? "below" : value > range[1] ? "above" : "within";
  return { measure, value, range, verdict };
}

/** Which size fits these measurements, and why. */
export function recommendSize(chart: SizeChart, measurements: Partial<Record<BodyMeasure, number>>): SizeAnswer {
  const given = chart.measures.filter(measure => {
    const value = measurements[measure];
    return typeof value === "number" && Number.isFinite(value) && value > 0;
  });
  if (given.length === 0 || chart.rows.length === 0) return { kind: "nothingToCompare" };

  const scored = chart.rows.map((row, index) => {
    const comparisons = given.map(measure => compare(row, measure, measurements[measure]!)).filter((entry): entry is Comparison => entry !== null);
    /* How far outside its ranges this size is, in centimetres, summed. */
    const distance = comparisons.reduce((sum, entry) => sum + (entry.verdict === "below" ? entry.range[0] - entry.value : entry.verdict === "above" ? entry.value - entry.range[1] : 0), 0);
    return { row, index, comparisons, distance, within: comparisons.filter(entry => entry.verdict === "within").length };
  });

  const fit = scored.find(entry => entry.within === given.length);
  if (fit) return { kind: "fits", size: fit.row.size, comparisons: fit.comparisons };

  /* Smaller than the smallest size, or larger than the largest, on every
     measurement: no size on this chart is the answer. */
  const first = scored[0];
  const last = scored[scored.length - 1];
  if (first.comparisons.every(entry => entry.verdict === "below")) return { kind: "belowChart" };
  if (last.comparisons.every(entry => entry.verdict === "above")) return { kind: "aboveChart" };

  /* Most measurements held, then nearest on the rest, then the larger size —
     a little loose is worn, a little tight goes back. */
  const best = [...scored].sort((a, b) => b.within - a.within || a.distance - b.distance || b.index - a.index)[0];
  return { kind: "closest", size: best.row.size, comparisons: best.comparisons };
}

/*
 * ## Learning from what came back
 *
 * A chart says what the seller measured; returns say what happened on bodies.
 * When enough of a product's size returns say the same thing — "too small",
 * or "too large" — the guide says so and leans the answer that way. Counts
 * only: never who, never their measurements, which never left their browser
 * in the first place.
 *
 * It needs `FIT_MIN_RETURNS` before it says anything, and a clear majority
 * (`FIT_SHARE`), because two returns are an anecdote and a split vote is no
 * tendency at all. It never overrides the chart: it adds advice beside the
 * answer, with the counts that produced it, so the shopper can weigh it.
 */

/** How many size returns a product needs before its tendency is reported. */
export const FIT_MIN_RETURNS = 3;
/** The share of them that must agree. */
export const FIT_SHARE = 0.6;

export type FitFeedback = { tooSmall: number; tooLarge: number };
export type FitTendency = "runsSmall" | "runsLarge";

export function fitTendency(feedback: FitFeedback): FitTendency | null {
  const total = feedback.tooSmall + feedback.tooLarge;
  if (total < FIT_MIN_RETURNS) return null;
  if (feedback.tooSmall / total >= FIT_SHARE) return "runsSmall";
  if (feedback.tooLarge / total >= FIT_SHARE) return "runsLarge";
  return null;
}

/**
 * The size the returns suggest instead, or null to leave the answer alone.
 *
 * A product that runs small moves a shopper up a size when they are already
 * near the top of their size's range on any measurement — or between sizes at
 * all; one that runs large moves them down the same way. Somebody sitting in
 * the middle of a range is left where the chart put them.
 */
export function adviseForFit(chart: SizeChart, answer: SizeAnswer, tendency: FitTendency | null): string | null {
  if (!tendency || (answer.kind !== "fits" && answer.kind !== "closest")) return null;
  const index = chart.rows.findIndex(row => row.size === answer.size);
  const next = chart.rows[index + (tendency === "runsSmall" ? 1 : -1)];
  if (index < 0 || !next) return null;
  const leaning = answer.kind === "closest" || answer.comparisons.some(entry => {
    const middle = (entry.range[0] + entry.range[1]) / 2;
    return tendency === "runsSmall" ? entry.value >= middle : entry.value <= middle;
  });
  return leaning ? next.size : null;
}

/* ------------------------------------------------- from past purchases --- */

/**
 * The size a shopper's own past purchases suggest (3.1.20: "based on their
 * past purchases or measurements").
 *
 * Each past line in the same department votes: one kept votes for its own
 * size, one sent back as too small for the next size up on this chart, one
 * too large for the next size down. A size this chart does not have casts no
 * vote — a past "M" says nothing about a chart in numbers. The size with the
 * most votes wins, a tie going to the most recent; and the answer carries the
 * counts behind it, the rule `fitTendency` follows, so the shopper can weigh
 * two purchases against one.
 *
 * The lines are the shopper's own and come only to them; the arithmetic runs
 * in their browser beside the chart, like `recommendSize`.
 */
export type PastSizeLine = {
  /** The variant's title as frozen on the order line, e.g. "M" or "Navy / M". */
  variantTitle: string | null;
  outcome: "kept" | "tooSmall" | "tooLarge";
  at: string | Date;
};

export type PurchaseSuggestion = { size: string; kept: number; tooSmall: number; tooLarge: number };

/** The chart's size a variant title names, matched whole and without case. */
export function sizeOnChart(chart: SizeChart, variantTitle: string | null): string | null {
  if (!variantTitle) return null;
  const parts = variantTitle.split(/\s*[/,|·-]\s*|\s+/).map(part => part.trim().toLowerCase()).filter(Boolean);
  const whole = variantTitle.trim().toLowerCase();
  const row = chart.rows.find(entry => entry.size.toLowerCase() === whole) ?? chart.rows.find(entry => parts.includes(entry.size.toLowerCase()));
  return row?.size ?? null;
}

export function sizeFromPurchases(chart: SizeChart, past: PastSizeLine[]): PurchaseSuggestion | null {
  const votes = new Map<string, { count: number; latest: number; kept: number; tooSmall: number; tooLarge: number }>();
  for (const line of past) {
    const size = sizeOnChart(chart, line.variantTitle);
    if (!size) continue;
    const index = chart.rows.findIndex(row => row.size === size);
    const target = line.outcome === "kept" ? chart.rows[index] : chart.rows[index + (line.outcome === "tooSmall" ? 1 : -1)];
    if (!target) continue;
    const at = new Date(line.at).getTime() || 0;
    const entry = votes.get(target.size) ?? { count: 0, latest: 0, kept: 0, tooSmall: 0, tooLarge: 0 };
    entry.count += 1;
    entry.latest = Math.max(entry.latest, at);
    entry[line.outcome] += 1;
    votes.set(target.size, entry);
  }
  let best: [string, { count: number; latest: number; kept: number; tooSmall: number; tooLarge: number }] | null = null;
  for (const candidate of votes) {
    if (!best || candidate[1].count > best[1].count || (candidate[1].count === best[1].count && candidate[1].latest > best[1].latest)) best = candidate;
  }
  return best ? { size: best[0], kept: best[1].kept, tooSmall: best[1].tooSmall, tooLarge: best[1].tooLarge } : null;
}

/**
 * What it takes to move the thing.
 *
 * Requirement 3.4.14: a product's size or type decides the vehicle a delivery
 * needs. Pure, because it is what a dispatcher acts on — sending a motorcycle
 * for a sofa is a wasted trip somebody pays for, and sending a truck for a
 * phone case is one nobody should.
 *
 * ## The decisions
 *
 * **Derived from what the seller already records, not asked for separately.**
 * A variant has a weight or a volume the moment it is sold by measure, and a
 * size class is one field. A second "vehicle" dropdown on every product would
 * be a field to keep in step with the first two, and it would drift.
 *
 * **The largest line decides the whole delivery.** A parcel and a sofa in one
 * van is a van. Taking the average, or the first line, would dispatch the
 * wrong vehicle for a basket that contains one heavy thing.
 *
 * **Unknown is its own answer.** A product with nothing recorded gets `null`
 * rather than `parcel`: guessing small is how a sofa is dispatched on a
 * motorcycle, and the honest reading of a gap in our own form is that we do
 * not know. `missingStoreDetails` and the return window err the same way.
 */

/** What is needed to carry it, smallest first. */
export const VEHICLES = ["bike", "car", "van", "truck"] as const;
export type Vehicle = (typeof VEHICLES)[number];

/** The size classes a seller can pick, smallest first. */
export const SIZE_CLASSES = ["small", "medium", "large", "oversize"] as const;
export type SizeClass = (typeof SIZE_CLASSES)[number];

/** The vehicle each size class needs. */
const BY_CLASS: Record<SizeClass, Vehicle> = {
  small: "bike",
  medium: "car",
  large: "van",
  oversize: "truck",
};

/**
 * Weight alone, in grams, when that is all there is.
 *
 * The thresholds are what a person can actually carry: a courier on a bike
 * takes a few kilos, a car boot takes a suitcase, past thirty kilos it is two
 * people and a van. They are deliberately generous at the bottom, because
 * being wrong upward wastes a trip and being wrong downward strands a driver.
 */
const BIKE_MAX_GRAMS = 5_000;
const CAR_MAX_GRAMS = 30_000;
const VAN_MAX_GRAMS = 150_000;

export function isSizeClass(value: unknown): value is SizeClass {
  return typeof value === "string" && (SIZE_CLASSES as readonly string[]).includes(value);
}

export function isVehicle(value: unknown): value is Vehicle {
  return typeof value === "string" && (VEHICLES as readonly string[]).includes(value);
}

function fromWeight(grams: number): Vehicle {
  if (grams <= BIKE_MAX_GRAMS) return "bike";
  if (grams <= CAR_MAX_GRAMS) return "car";
  if (grams <= VAN_MAX_GRAMS) return "van";
  return "truck";
}

/**
 * The vehicle one product needs.
 *
 * The declared size class wins: a seller who says "oversize" knows something
 * about the shape that a weight does not capture — a mattress is light and
 * needs a van. Weight is the fallback, and null is the answer when there is
 * neither.
 */
export function vehicleFor(input: { sizeClass?: string | null; weightGrams?: number | null }): Vehicle | null {
  if (isSizeClass(input.sizeClass)) return BY_CLASS[input.sizeClass];
  const grams = input.weightGrams;
  if (typeof grams === "number" && Number.isFinite(grams) && grams > 0) return fromWeight(grams);
  return null;
}

/**
 * The vehicle a whole delivery needs: the largest any line needs.
 *
 * A basket with a phone case and a sofa is a van. Unknown lines are skipped
 * rather than counted as small — one line nobody measured must not talk the
 * dispatcher down from a van.
 */
export function vehicleForDelivery(lines: { sizeClass?: string | null; weightGrams?: number | null }[]): Vehicle | null {
  let needed: Vehicle | null = null;
  for (const line of lines) {
    const vehicle = vehicleFor(line);
    if (!vehicle) continue;
    if (!needed || VEHICLES.indexOf(vehicle) > VEHICLES.indexOf(needed)) needed = vehicle;
  }
  return needed;
}

/**
 * Whether a quantity changes the answer.
 *
 * Ten of something a bike can carry is not a bike delivery. The weight is
 * multiplied where there is one; a declared size class is not, because "large"
 * describes the shape of one item and ten large items is a question about
 * volume this does not pretend to answer — it takes the class as a floor and
 * lets weight push it up.
 */
export function vehicleForQuantity(
  line: { sizeClass?: string | null; weightGrams?: number | null },
  quantity: number,
): Vehicle | null {
  const count = Math.max(1, Math.trunc(quantity));
  const byClass = isSizeClass(line.sizeClass) ? BY_CLASS[line.sizeClass] : null;
  const grams = line.weightGrams;
  const byWeight = typeof grams === "number" && Number.isFinite(grams) && grams > 0
    ? fromWeight(grams * count)
    : null;

  if (byClass && byWeight) return VEHICLES.indexOf(byWeight) > VEHICLES.indexOf(byClass) ? byWeight : byClass;
  return byClass ?? byWeight;
}

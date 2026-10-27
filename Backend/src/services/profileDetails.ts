/**
 * "Your profile"'s details beyond the sign-in email and the password — the
 * database half of `Shared/commerce/profileDetails.ts`.
 *
 * `customer_profiles` is a table of its own so nothing that reads `users`
 * changes, and so the shop keeps working in the minutes between a deploy and
 * the owner running the bootstrap: until the table exists a read answers
 * "nothing saved" and saving the name still saves the display name, so the
 * only thing missing is the new fields themselves.
 *
 * Outside `db.ts` for the reason `profile.ts` is: functions there call its
 * module-local `getDb`, which a test cannot redirect.
 */
import { eq, sql } from "drizzle-orm";
import { customerProfiles } from "../../database/schema.js";
import { getDb } from "./db.js";
import {
  birthdayProblem,
  isCountryCode,
  NO_DETAILS,
  profilePhone,
  type Gender,
  type ProfileDetails,
} from "../../../Shared/commerce/profileDetails.js";
import { kuwaitDay } from "../../../Shared/kuwaitDay.js";

export class ProfileDetailsError extends Error {
  constructor(readonly key: string) {
    super(key);
  }
}

/** Postgres's "relation does not exist", wherever Drizzle wrapped it. */
function isMissingTable(error: unknown): boolean {
  for (let step: unknown = error, depth = 0; step && depth < 5; depth++) {
    if ((step as { code?: unknown }).code === "42P01") return true;
    step = (step as { cause?: unknown }).cause;
  }
  return false;
}

async function db() {
  const database = await getDb();
  if (!database) throw new Error("profile details: no database configured");
  return database;
}

export async function detailsFor(userId: number): Promise<ProfileDetails> {
  try {
    const [row] = await (await db())
      .select({
        firstName: customerProfiles.firstName,
        lastName: customerProfiles.lastName,
        phone: customerProfiles.phone,
        gender: customerProfiles.gender,
        birthday: customerProfiles.birthday,
        nationality: customerProfiles.nationality,
      })
      .from(customerProfiles)
      .where(eq(customerProfiles.userId, userId));
    return row ?? NO_DETAILS;
  } catch (error) {
    if (isMissingTable(error)) return NO_DETAILS;
    throw error;
  }
}

/**
 * The name in its parts. The caller writes the display name from them; this
 * keeps the parts, and before the table exists it keeps nothing and says so
 * by returning false rather than failing the save of the display name.
 */
export async function saveNameParts(userId: number, firstName: string, lastName: string): Promise<boolean> {
  try {
    await (await db())
      .insert(customerProfiles)
      .values({ userId, firstName, lastName })
      .onConflictDoUpdate({ target: customerProfiles.userId, set: { firstName, lastName, updatedAt: sql`now()` } });
    return true;
  } catch (error) {
    if (isMissingTable(error)) return false;
    throw error;
  }
}

export type DetailsPatch = {
  phone?: string | null;
  gender?: Gender | null;
  birthday?: string | null;
  nationality?: string | null;
};

/**
 * Only what the caller sent is written — each card on the page saves its own
 * field, and a save that wrote the others' defaults would clear them. A null
 * clears a field; every one is optional.
 */
export async function saveDetails(userId: number, patch: DetailsPatch, now = new Date()): Promise<ProfileDetails> {
  const changes: Partial<typeof customerProfiles.$inferInsert> = {};
  if (patch.phone !== undefined) {
    if (patch.phone === null || patch.phone.trim() === "") {
      changes.phone = null;
    } else {
      const answer = profilePhone(patch.phone);
      if ("problem" in answer) throw new ProfileDetailsError(answer.problem);
      changes.phone = answer.phone;
    }
  }
  if (patch.gender !== undefined) changes.gender = patch.gender;
  if (patch.birthday !== undefined) {
    if (patch.birthday !== null) {
      const problem = birthdayProblem(patch.birthday, kuwaitDay(now));
      if (problem) throw new ProfileDetailsError(problem);
    }
    changes.birthday = patch.birthday;
  }
  if (patch.nationality !== undefined) {
    if (patch.nationality !== null && !isCountryCode(patch.nationality)) throw new ProfileDetailsError("profile.nationalityInvalid");
    changes.nationality = patch.nationality;
  }
  if (Object.keys(changes).length === 0) return detailsFor(userId);

  try {
    await (await db())
      .insert(customerProfiles)
      .values({ userId, ...changes })
      .onConflictDoUpdate({ target: customerProfiles.userId, set: { ...changes, updatedAt: sql`now()` } });
  } catch (error) {
    if (isMissingTable(error)) throw new ProfileDetailsError("error.serverProblem");
    throw error;
  }
  return detailsFor(userId);
}

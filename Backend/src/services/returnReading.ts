/**
 * A model reading a return no rule could decide (3.5.2), the call. The rules —
 * what is sent, what is kept — are `Shared/commerce/returnReading.ts`.
 *
 * Asked when a shopper sends an "other" request, with a short deadline so the
 * reply is not held long, and again from the desk by whoever handles it if the
 * first try did not come back. Every failure is the same answer: no reading,
 * and the people decide from the note as they always did.
 */
import { and, eq, isNull } from "drizzle-orm";
import { orderItems, returnRequests } from "../../database/schema.js";
import { READING_SYSTEM, readable, readingFromModel, readingPrompt, type ReturnReading } from "../../../Shared/commerce/returnReading.js";
import { assertCan, type Actor } from "../../../Shared/inventory/permissions.js";
import { askModel, modelAvailable, parseObject } from "./gemini.js";
import { getDb } from "./db.js";

/** Whether the desk can offer a reading: the gateway set up and model calls on. */
export async function readingAvailable(actor: Actor): Promise<boolean> {
  try {
    assertCan(actor, "returns.handle", actor.kind === "vendor" ? actor.vendorId : undefined);
  } catch {
    return false;
  }
  return modelAvailable();
}

/** Reads one request's note and stores what came back, or nothing. */
export async function readReturnNote(requestId: number, deadlineMs = 8_000): Promise<ReturnReading | null> {
  try {
    const db = await getDb();
    if (!db) return null;
    const [row] = await db
      .select({ reason: returnRequests.reason, note: returnRequests.note, kind: returnRequests.kind, productTitle: orderItems.productTitle })
      .from(returnRequests)
      .innerJoin(orderItems, eq(orderItems.id, returnRequests.orderItemId))
      .where(eq(returnRequests.id, requestId))
      .limit(1);
    if (!row || row.reason !== "other" || !readable(row.note)) return null;
    if (!(await modelAvailable())) return null;
    const answer = await askModel("returnRead", {
      system: READING_SYSTEM,
      prompt: readingPrompt({ note: row.note, productTitle: row.productTitle, kind: row.kind === "exchange" ? "exchange" : "refund" }),
      json: true,
      temperature: 0.2,
      maxOutputTokens: 300,
      deadlineMs,
    });
    const reading = readingFromModel(parseObject(answer));
    if (!reading) return null;
    await db
      .update(returnRequests)
      .set({ aiSummary: reading.summary, aiSuggestion: reading.suggestion })
      .where(and(eq(returnRequests.id, requestId), isNull(returnRequests.aiSummary)));
    return reading;
  } catch (error) {
    console.error(`[returns] could not read request ${requestId}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** The desk's "Read the note" press: the store's own request, or any for NetLet. */
export async function readForDesk(actor: Actor, requestId: number): Promise<ReturnReading | null> {
  assertCan(actor, "returns.handle", actor.kind === "vendor" ? actor.vendorId : undefined);
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select({ id: returnRequests.id })
    .from(returnRequests)
    .where(and(eq(returnRequests.id, requestId), actor.kind === "vendor" ? eq(returnRequests.vendorId, actor.vendorId) : undefined))
    .limit(1);
  if (!row) return null;
  return readReturnNote(requestId, 12_000);
}

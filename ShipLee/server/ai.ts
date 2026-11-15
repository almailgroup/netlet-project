/**
 * ShipLee AI's two jobs, as the API answers them.
 *
 *   POST /api/ai/ask                a customer's question, about a parcel or not
 *   POST /api/staff/ai/intake       the staff desk's order message, read into the form
 *
 * Each is counted in the database before the call — a function's memory is
 * per instance — by the caller's address: a customer may ask
 * `MAX_ASKS_PER_HOUR` questions an hour, the desk read `MAX_INTAKES_PER_HOUR`
 * messages. A question refused for what it carries is not counted, since it
 * never reaches the model. Both need the database (or the demo store) for that
 * count, so with neither ShipLee AI is not offered at all.
 */
import type { Store } from "./store.js";
import type { Contact } from "./contact.js";
import type { Seams, ShipLeeAI } from "./gateway.js";
import { askModel } from "./gateway.js";
import type { AssistantAnswer, IntakeResult, ParcelFacts } from "../shared/assistant.js";
import {
  assistantPrompt,
  assistantSystem,
  checkAssistantRequest,
  intakePrompt,
  intakeSystem,
  MAX_ORDER_MESSAGE,
  readAssistantAnswer,
  readIntake,
} from "../shared/assistant.js";
import { publicView } from "../shared/shipment.js";

export const MAX_ASKS_PER_HOUR = 30;
export const MAX_INTAKES_PER_HOUR = 120;
const HOUR_MS = 60 * 60 * 1000;

export type AiOutcome<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

async function underCeiling(store: Store, key: string, ceiling: number, now: Date): Promise<boolean> {
  if ((await store.aiCallsSince(key, new Date(now.getTime() - HOUR_MS))) >= ceiling) return false;
  await store.noteAiCall(key, now);
  return true;
}

/**
 * A customer's question. The parcel, when one is named (or typed into the
 * question), is read the way the tracking page reads it — `publicView`, and
 * nothing about the recipient.
 */
export async function answerQuestion(
  body: Record<string, unknown>,
  { ai, store, contact, address, now, seams }: { ai: ShipLeeAI; store: Store; contact: Contact; address: string; now: Date; seams?: Seams },
): Promise<AiOutcome<AssistantAnswer & { number: string | null }>> {
  const checked = checkAssistantRequest(body);
  if (!checked.ok) return { ok: false, status: 400, error: checked.error };
  const request = checked.value;
  if (!(await underCeiling(store, `ask:${address}`, MAX_ASKS_PER_HOUR, now))) return { ok: false, status: 429, error: "ai.tooMany" };

  let facts: ParcelFacts | null = null;
  if (request.number) {
    const shipment = await store.byNumber(request.number);
    facts = { number: request.number, shipment: shipment ? publicView(shipment) : null };
  }
  const text = await askModel(
    ai,
    {
      task: "assistant",
      system: assistantSystem(request.lang, now),
      prompt: assistantPrompt(request, facts, { phone: Boolean(contact.phone), whatsapp: Boolean(contact.whatsapp), email: Boolean(contact.email) }, now),
      json: true,
      temperature: 0.2,
      maxOutputTokens: 500,
      timeoutMs: 9000,
    },
    seams,
  );
  const answer = text === null ? null : readAssistantAnswer(text);
  if (!answer) return { ok: false, status: 502, error: "ai.failed" };
  return { ok: true, value: { ...answer, number: request.number } };
}

/** The desk's order message, read into the new-shipment form's boxes. */
export async function readOrderMessage(
  body: Record<string, unknown>,
  { ai, store, address, now, seams }: { ai: ShipLeeAI; store: Store; address: string; now: Date; seams?: Seams },
): Promise<AiOutcome<IntakeResult>> {
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return { ok: false, status: 400, error: "intake.empty" };
  if (message.length > MAX_ORDER_MESSAGE) return { ok: false, status: 400, error: "intake.long" };
  if (!(await underCeiling(store, `intake:${address}`, MAX_INTAKES_PER_HOUR, now))) return { ok: false, status: 429, error: "ai.tooMany" };
  const text = await askModel(
    ai,
    { task: "intake", system: intakeSystem(now), prompt: intakePrompt(message), json: true, temperature: 0, maxOutputTokens: 700, timeoutMs: 9000 },
    seams,
  );
  if (text === null) return { ok: false, status: 502, error: "ai.failed" };
  const result = readIntake(text, now);
  return result ? { ok: true, value: result } : { ok: false, status: 422, error: "intake.nothing" };
}

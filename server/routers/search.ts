import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ENV } from "../_core/env.js";
import { featureOn } from "../features.js";
import { publicProcedure, router } from "../_core/trpc.js";

const refinementSchema = z.object({
  query: z.string().trim().min(2).max(120),
  catalogTitles: z.array(z.string().trim().min(1).max(160)).min(1).max(24),
});

type MistralCompletion = {
  choices?: Array<{ message?: { content?: string | unknown } }>;
};

export function parseRefinedSearch(content: unknown, fallback: string) {
  const raw = typeof content === "string" ? content : "";
  try {
    const parsed = JSON.parse(raw) as { query?: unknown; terms?: unknown };
    const query = typeof parsed.query === "string" && parsed.query.trim() ? parsed.query.trim().slice(0, 120) : fallback;
    const terms = Array.isArray(parsed.terms) ? parsed.terms.filter((term): term is string => typeof term === "string").map(term => term.trim()).filter(Boolean).slice(0, 5) : [];
    return { query, terms };
  } catch {
    return { query: fallback, terms: [] };
  }
}

export const searchRouter = router({
  refine: publicProcedure.input(refinementSchema).mutation(async ({ input }) => {
    /* No key and models switched off (2.3) are one answer: the client already
       falls back to the plain search on this refusal. */
    if (!ENV.mistralApiKey || !(await featureOn("ai"))) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "AI search is not configured." });
    }

    const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ENV.mistralApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "mistral-small-latest",
        temperature: 0.1,
        max_tokens: 60,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "You refine shopping searches for a Kuwait marketplace. Return JSON only: {\"query\":\"exact best matching catalog title or concise catalog search\",\"terms\":[\"up to five concrete product keywords\"]}. Choose the closest available catalog item when one fits. Preserve the shopper's intent, do not invent brands, prices, availability, or product facts.",
          },
          { role: "user", content: `Shopper request: ${input.query}\n\nAvailable catalog titles: ${input.catalogTitles.join(" | ")}` },
        ],
      }),
    });

    if (!response.ok) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI search is temporarily unavailable." });
    }

    const completion = (await response.json()) as MistralCompletion;
    const content = completion.choices?.[0]?.message?.content;
    return parseRefinedSearch(content, input.query);
  }),
});

/**
 * "Generate with AI" on the product form: a listing drafted by the AI
 * gateway (`POST /api/ai/catalog-assist`) from a seller's notes and photos.
 *
 * It returns a draft and nothing more — the form fills from it, and the
 * seller reads, changes and saves it, so every listing on the shelf is one a
 * person accepted (the "Draft with AI" rule for the Arabic name). The
 * gateway has already held the draft to NetLet's departments and
 * specification rows and taken out anything carrying contact details
 * (`shared/ai/catalogDraft.ts`).
 *
 * Photos go as they are handed in, so hand in what `preparePhoto` made: a
 * 768px JPEG or WebP is far under the gateway's limit, where a camera's
 * original is not. `vendorId` is the store the product is for; the token is
 * signed only for somebody who may create a product there.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/hooks/useTranslation";
import { TicketHolder, blobToBase64, callGateway } from "@/lib/aiGateway";
import {
  GATEWAY_ROUTES,
  IMAGE_TYPES,
  MAX_IMAGES,
  MAX_IMAGE_BASE64,
  MAX_NOTES,
  type CatalogAssistRequest,
  type CatalogDraft,
  type GatewayErrorCode,
  type GatewayResponse,
  type ImageType,
} from "@shared/ai/gateway";

export type GeneratorStatus = "idle" | "working" | "done" | "error";

export function useProductGenerator(vendorId: number | null) {
  const { locale } = useTranslation();
  const available = trpc.ai.available.useQuery(undefined, { staleTime: 5 * 60_000 });
  const mint = trpc.ai.catalogSession.useMutation();
  const mintRef = useRef(() => mint.mutateAsync({ vendorId }));
  mintRef.current = () => mint.mutateAsync({ vendorId });
  /* A new holder for a new store: a token names the store it was signed for. */
  const holder = useRef<{ vendorId: number | null; holder: TicketHolder } | null>(null);
  if (!holder.current || holder.current.vendorId !== vendorId) {
    holder.current = { vendorId, holder: new TicketHolder(() => mintRef.current()) };
  }

  const [status, setStatus] = useState<GeneratorStatus>("idle");
  const [draft, setDraft] = useState<CatalogDraft | null>(null);
  const [error, setError] = useState<GatewayErrorCode | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const generate = useCallback(async (input: { notes: string; department?: string | null; photos?: Blob[] }): Promise<CatalogDraft | null> => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setStatus("working");
    setError(null);

    const fail = (code: GatewayErrorCode) => {
      setError(code);
      setStatus("error");
      return null;
    };
    const photos = (input.photos ?? []).slice(0, MAX_IMAGES);
    if (input.notes.length > MAX_NOTES) return fail("too_large");
    if (!input.notes.trim() && photos.length === 0) return fail("bad_request");
    const images: CatalogAssistRequest["images"] = [];
    for (const photo of photos) {
      if (!IMAGE_TYPES.includes(photo.type as ImageType)) return fail("bad_request");
      const data = await blobToBase64(photo);
      if (data.length > MAX_IMAGE_BASE64) return fail("too_large");
      images.push({ mimeType: photo.type as ImageType, data });
    }

    try {
      const body: CatalogAssistRequest = { locale, notes: input.notes, department: input.department ?? null, images };
      const call = await callGateway(holder.current!.holder, GATEWAY_ROUTES.catalog, body, abort.signal);
      if (!call.ok) return fail(call.code);
      const answer = (await call.response.json()) as GatewayResponse<CatalogDraft>;
      if (!answer.ok) return fail(answer.error.code);
      setDraft(answer.data);
      setStatus("done");
      return answer.data;
    } catch {
      return abort.signal.aborted ? (setStatus("idle"), null) : fail("model_unavailable");
    } finally {
      if (controller.current === abort) controller.current = null;
    }
  }, [locale]);

  const cancel = useCallback(() => controller.current?.abort(), []);
  const reset = useCallback(() => {
    controller.current?.abort();
    setDraft(null);
    setError(null);
    setStatus("idle");
  }, []);

  return { available: available.data, status, draft, error, generate, cancel, reset };
}

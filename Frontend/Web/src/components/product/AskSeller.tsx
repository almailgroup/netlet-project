/**
 * "Ask the seller a question" (3.8), on the product page.
 *
 * Folded until pressed: most shoppers came for the photograph, and an open
 * text box under the buy buttons competes with them. Signed out, it says why it
 * needs an account rather than opening a box that will refuse — the same
 * honesty the price request has.
 *
 * Once sent, the reply lands in the account's Messages section, and the panel
 * says so with a link; a chat that answered here would need the page left open.
 */
import { useState } from "react";
import { Link } from "wouter";
import { MessageCircleQuestion } from "lucide-react";
import { toast } from "sonner";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";

export function AskSeller({ productId, vendor }: { productId: string; vendor: string }) {
  const { t, tError } = useTranslation();
  const { isAuthenticated } = useAuth();
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const send = trpc.chat.send.useMutation();
  const numericId = Number(productId);
  /* A demo build's fixture ids are not rows; there is nobody to ask. */
  if (!Number.isInteger(numericId) || numericId <= 0) return null;

  return (
    <div className="mt-4 rounded-2xl border border-[#e6e9ef] bg-[#fbfcfe] p-4">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          className="pressable inline-flex items-center gap-2 text-[13px] font-extrabold text-[#0a285a]"
        >
          <MessageCircleQuestion className="size-4" aria-hidden />
          {t("chat.askSeller", { vendor })}
        </button>
      ) : !isAuthenticated ? (
        <p className="text-[13px] leading-6 ink-muted">
          <strong className="font-extrabold text-[#0a285a]">{t("chat.signInFirst")}</strong> {t("chat.signInWhy")}{" "}
          <Link href="/account" className="font-extrabold ink-accent underline">{t("header.signIn")}</Link>
        </p>
      ) : sent ? (
        <p role="status" className="text-[13px] leading-6 text-[#0a285a]">
          {t("chat.sentToSeller", { vendor })}{" "}
          <Link href="/account/messages" className="font-extrabold ink-accent underline">{t("chat.openMessages")}</Link>
        </p>
      ) : (
        <>
          <p className="text-[13px] font-extrabold text-[#0a285a]">{t("chat.askSeller", { vendor })}</p>
          <ChatComposer
            label={t("chat.askSeller", { vendor })}
            placeholder={t("chat.askPlaceholder")}
            pending={send.isPending}
            onSend={async body => {
              try {
                await send.mutateAsync({ productId: numericId, body });
                setSent(true);
                return true;
              } catch (error) {
                toast.error(tError((error as Error).message));
                return false;
              }
            }}
          />
        </>
      )}
    </div>
  );
}

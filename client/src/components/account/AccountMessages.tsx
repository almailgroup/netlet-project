/**
 * The shopper's conversations with sellers (3.8).
 *
 * One thread per shop, newest first, each opened in place — the same pattern
 * as orders, so a shopper reading their account learns one way of looking at
 * things. A conversation is started from a product page or an order, never
 * from here: a message has to be about something for the seller to answer it.
 */
import { useEffect, useState } from "react";
import { ChevronDown, MessagesSquare } from "lucide-react";
import { toast } from "sonner";
import { QueryGate } from "@/components/admin/QueryGate";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { ChatThread } from "@/components/chat/ChatThread";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useFeature } from "@/hooks/useFeature";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";

export function AccountMessages() {
  const { t } = useTranslation();
  const formatDate = useDateFormat();
  const list = trpc.chat.mine.useQuery();
  const [openId, setOpenId] = useState<number | null>(null);

  return (
    <QueryGate queries={[list]}>
      {() => {
        const rows = list.data ?? [];
        if (rows.length === 0) {
          return (
            <div className="rounded-[1.35rem] border border-[#d5dfeb] bg-white p-6">
              <span className="grid size-12 place-items-center rounded-2xl bg-[#e7edf5] text-[#0a285a]">
                <MessagesSquare className="size-6" aria-hidden />
              </span>
              <p className="mt-4 max-w-prose text-sm leading-6 ink-muted">{t("chat.emptyShopper")}</p>
            </div>
          );
        }
        return (
          <ul className="space-y-3">
            {rows.map(row => {
              const open = openId === row.id;
              return (
                <li key={row.id} className="rounded-[1.35rem] border border-[#d5dfeb] bg-white">
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : row.id)}
                    aria-expanded={open}
                    aria-controls={`conversation-${row.id}`}
                    className="pressable flex w-full items-start justify-between gap-4 rounded-[1.35rem] p-5 text-start"
                  >
                    <span className="min-w-0">
                      <span dir="auto" className="type-product block text-base text-[#0a285a]">{row.counterpart}</span>
                      {row.preview ? (
                        <span dir="auto" className="mt-1 block truncate text-xs ink-muted">
                          {row.previewSide === "shopper" ? `${t("chat.you")}: ` : ""}{row.preview}
                        </span>
                      ) : null}
                      <span className="mt-1 block text-[11px] ink-muted">{formatDate(row.lastMessageAt)}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      {/* Drawn only with something to say, like every badge here. */}
                      {row.unread > 0 ? (
                        <span className="rounded-full bg-[#0a285a] px-2.5 py-1 text-[11px] font-extrabold text-white">
                          {t(row.unread === 1 ? "chat.unreadOne" : "chat.unread", { count: row.unread })}
                        </span>
                      ) : null}
                      <ChevronDown className={`size-5 ink-muted transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
                    </span>
                  </button>
                  <div id={`conversation-${row.id}`} hidden={!open} className="border-t border-[#e7edf5] px-5 py-4">
                    {open ? <ShopperThread conversationId={row.id} /> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        );
      }}
    </QueryGate>
  );
}

function ShopperThread({ conversationId }: { conversationId: number }) {
  const { t, tError } = useTranslation();
  const utils = trpc.useUtils();
  const thread = trpc.chat.thread.useQuery({ conversationId });
  const send = trpc.chat.send.useMutation();
  /* Switched off (2.3): the thread stays readable and the seller can still
     answer it; writing a new message is what closes. */
  const on = useFeature("chat");
  /* Opening it marked it read on the server; the badge above was fetched
     before that. */
  const loadedAt = thread.dataUpdatedAt;
  useEffect(() => {
    if (!loadedAt) return;
    void utils.chat.mine.invalidate();
    void utils.chat.unread.invalidate();
  }, [loadedAt, utils]);

  /* Opening it marked it read on the server; the list's badge follows. */
  const refresh = () => {
    void utils.chat.thread.invalidate({ conversationId });
    void utils.chat.mine.invalidate();
    void utils.chat.unread.invalidate();
  };

  return (
    <QueryGate queries={[thread]}>
      {() => {
        const data = thread.data;
        if (!data) return null;
        return (
          <>
            <ChatThread messages={data.messages} mySide="shopper" theirName={data.vendorName} />
            {!on ? <p className="mt-3 text-[12px] leading-5 ink-muted">{t("chat.switchedOff")}</p> : <ChatComposer
              label={t("chat.replyTo", { name: data.vendorName })}
              pending={send.isPending}
              onSend={async body => {
                try {
                  await send.mutateAsync({ conversationId, body });
                  refresh();
                  return true;
                } catch (error) {
                  toast.error(tError((error as Error).message));
                  return false;
                }
              }}
            />}
          </>
        );
      }}
    </QueryGate>
  );
}

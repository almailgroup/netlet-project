/**
 * The store's inbox (3.8).
 *
 * One page for a seller's staff and for NetLet: a seller reads and answers
 * their own store's conversations, an administrator reads every store's and
 * answers none — a moderator looking is not the shop having replied, and
 * answering as a store you do not belong to would put words in its mouth. The
 * server scopes both; this page draws a composer only where one would be
 * accepted.
 *
 * The shopper is named by first name and initial. A seller needs somebody to
 * address; they do not need a way to reach them anywhere else.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AdminShell } from "@/components/admin/AdminShell";
import { QueryGate } from "@/components/admin/QueryGate";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { ChatThread } from "@/components/chat/ChatThread";
import { useDateFormat } from "@/hooks/useDateFormat";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import type { Actor } from "@shared/inventory/permissions";
import { privatePageMeta } from "@shared/seo";

export default function AdminMessages() {
  usePageMeta(privatePageMeta("Messages"));
  return <AdminShell need="chat.answer">{actor => <Messages actor={actor} />}</AdminShell>;
}

function Messages({ actor }: { actor: Actor }) {
  const { t } = useTranslation();
  const formatDate = useDateFormat();
  const list = trpc.chat.seller.list.useQuery();
  const [openId, setOpenId] = useState<number | null>(null);

  return (
    <>
      <h1 className="text-xl font-extrabold">{t("admin.messages")}</h1>
      <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[#536b8c]">
        {actor.kind === "admin" ? t("admin.messagesNoteAdmin") : t("admin.messagesNote")}
      </p>

      <QueryGate queries={[list]}>
        {() => {
          const rows = list.data ?? [];
          if (rows.length === 0) {
            return <p className="mt-5 rounded-2xl border border-[#e6e9ef] bg-white px-5 py-6 text-sm text-[#536b8c]">{t("admin.messagesNone")}</p>;
          }
          return (
            <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
              <ul className="space-y-2" aria-label={t("admin.messages")}>
                {rows.map(row => (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => setOpenId(row.id)}
                      aria-current={openId === row.id ? "true" : undefined}
                      className={`w-full rounded-2xl border px-4 py-3 text-start transition ${
                        openId === row.id ? "border-[#0a285a] bg-white shadow-sm" : "border-[#e6e9ef] bg-white hover:border-[#c3ccda]"
                      }`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span dir="auto" className="truncate text-[13px] font-extrabold">{row.counterpart || t("chat.aShopper")}</span>
                        {row.unread > 0 ? (
                          <span className="shrink-0 rounded-full bg-[#0a285a] px-2 py-0.5 text-[10px] font-extrabold text-white">
                            {t(row.unread === 1 ? "chat.unreadOne" : "chat.unread", { count: row.unread })}
                          </span>
                        ) : null}
                      </span>
                      {actor.kind === "admin" ? <span dir="auto" className="block text-[11px] font-bold text-[#536b8c]">{row.vendorName}</span> : null}
                      {row.preview ? <span dir="auto" className="mt-0.5 block truncate text-[12px] text-[#536b8c]">{row.preview}</span> : null}
                      <span className="mt-0.5 block text-[10px] text-[#536b8c]">{formatDate(row.lastMessageAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <div>
                {openId === null ? (
                  <p className="rounded-2xl border border-dashed border-[#d5dfeb] px-5 py-10 text-center text-sm text-[#536b8c]">{t("admin.messagesPick")}</p>
                ) : (
                  <SellerThread key={openId} conversationId={openId} canReply={actor.kind === "vendor"} />
                )}
              </div>
            </div>
          );
        }}
      </QueryGate>
    </>
  );
}

function SellerThread({ conversationId, canReply }: { conversationId: number; canReply: boolean }) {
  const { t, tError } = useTranslation();
  const utils = trpc.useUtils();
  const thread = trpc.chat.seller.thread.useQuery({ conversationId });
  const reply = trpc.chat.seller.reply.useMutation();
  /* Reading the thread marked it read on the server; the badge in the list
     beside it was fetched before that, so it is asked again. */
  const loadedAt = thread.dataUpdatedAt;
  useEffect(() => {
    if (!loadedAt) return;
    void utils.chat.seller.list.invalidate();
    void utils.chat.seller.unread.invalidate();
  }, [loadedAt, utils]);

  return (
    <QueryGate queries={[thread]}>
      {() => {
        const data = thread.data;
        if (!data) return null;
        const name = data.shopperName || t("chat.aShopper");
        return (
          <section aria-label={t("chat.threadWith", { name })} className="rounded-2xl border border-[#e6e9ef] bg-white p-4">
            <h2 dir="auto" className="mb-3 text-sm font-extrabold">{name}</h2>
            <ChatThread messages={data.messages} mySide="seller" theirName={name} />
            {canReply ? (
              <ChatComposer
                label={t("chat.replyTo", { name })}
                pending={reply.isPending}
                onSend={async body => {
                  try {
                    await reply.mutateAsync({ conversationId, body });
                    void utils.chat.seller.thread.invalidate({ conversationId });
                    void utils.chat.seller.list.invalidate();
                    void utils.chat.seller.unread.invalidate();
                    return true;
                  } catch (error) {
                    toast.error(tError((error as Error).message));
                    return false;
                  }
                }}
              />
            ) : (
              <p className="mt-3 text-[12px] text-[#536b8c]">{t("admin.messagesReadOnly")}</p>
            )}
          </section>
        );
      }}
    </QueryGate>
  );
}

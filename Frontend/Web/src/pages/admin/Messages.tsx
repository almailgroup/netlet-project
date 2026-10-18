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
import { ArrowLeft, MessagesSquare } from "lucide-react";
import { toast } from "sonner";
import { AdminShell } from "@/components/admin/AdminShell";
import { QueryGate } from "@/components/admin/QueryGate";
import { EmptyState, Notice, PageHeader, SkeletonRows } from "@/components/admin/ui";
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

/*
 * A list and the open conversation. Side by side on a wide screen; on a phone
 * the open one replaces the list, with a way back — stacked, the thread opened
 * below a list of twenty and somebody pressing a name saw nothing happen.
 */
function Messages({ actor }: { actor: Actor }) {
  const { t } = useTranslation();
  const formatDate = useDateFormat();
  const list = trpc.chat.seller.list.useQuery();
  const [openId, setOpenId] = useState<number | null>(null);

  return (
    <>
      <PageHeader title={t("admin.messages")} description={actor.kind === "admin" ? t("admin.messagesNoteAdmin") : t("admin.messagesNote")} />

      {list.isLoading ? (
        <SkeletonRows rows={4} label={t("admin.loading")} />
      ) : (
        <QueryGate queries={[list]}>
          {() => {
            const rows = list.data ?? [];
            if (rows.length === 0) return <EmptyState title={t("admin.messagesNone")} />;
            return (
              <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
                <ul
                  aria-label={t("admin.messages")}
                  className={`divide-y divide-[#eef1f5] self-start overflow-hidden rounded-2xl border border-[#e1e7ef] bg-white ${openId !== null ? "hidden lg:block" : ""}`}
                >
                  {rows.map(row => {
                    const current = openId === row.id;
                    return (
                      <li key={row.id}>
                        <button
                          type="button"
                          onClick={() => setOpenId(row.id)}
                          aria-current={current ? "true" : undefined}
                          className={`w-full border-s-[3px] px-4 py-3 text-start transition ${current ? "border-s-[#0a285a] bg-[#f4f7fb]" : "border-s-transparent hover:bg-[#0a285a]/[.06]"}`}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span dir="auto" className={`truncate text-[14px] text-[#0a285a] ${row.unread > 0 ? "font-bold" : "font-semibold"}`}>{row.counterpart || t("chat.aShopper")}</span>
                            <span className="shrink-0 text-[12px] ink-muted">{formatDate(row.lastMessageAt)}</span>
                          </span>
                          {actor.kind === "admin" ? <span dir="auto" className="block text-[12px] font-semibold text-[#536b8c]">{row.vendorName}</span> : null}
                          <span className="mt-0.5 flex items-center justify-between gap-2">
                            <span dir="auto" className="min-w-0 truncate text-[13px] text-[#536b8c]">{row.preview ?? ""}</span>
                            {row.unread > 0 ? (
                              <span className="shrink-0 rounded-full bg-[#0a285a] px-2 py-0.5 text-[11px] font-bold text-white">
                                {t(row.unread === 1 ? "chat.unreadOne" : "chat.unread", { count: row.unread })}
                              </span>
                            ) : null}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <div className={openId === null ? "hidden lg:block" : ""}>
                  {openId === null ? (
                    <div className="grid h-full min-h-60 place-items-center rounded-2xl border border-dashed border-[#cfd9e6] bg-white px-5 py-10 text-center">
                      <div>
                        <MessagesSquare className="mx-auto size-8 text-[#8a9bb3]" aria-hidden />
                        <p className="mt-3 text-[14px] text-[#536b8c]">{t("admin.messagesPick")}</p>
                      </div>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => setOpenId(null)}
                        className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#536b8c] hover:text-[#0a285a] lg:hidden"
                      >
                        <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />{t("admin.messagesBack")}
                      </button>
                      <SellerThread key={openId} conversationId={openId} canReply={actor.kind === "vendor"} />
                    </>
                  )}
                </div>
              </div>
            );
          }}
        </QueryGate>
      )}
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
          <section aria-label={t("chat.threadWith", { name })} className="rounded-2xl border border-[#e1e7ef] bg-white p-4 sm:p-5">
            <h2 dir="auto" className="mb-3 border-b border-[#eef1f5] pb-3 text-[16px] font-bold text-[#0a285a]">{name}</h2>
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
              <Notice className="mt-4">{t("admin.messagesReadOnly")}</Notice>
            )}
          </section>
        );
      }}
    </QueryGate>
  );
}

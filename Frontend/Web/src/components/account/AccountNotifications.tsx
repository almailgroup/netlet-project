/**
 * The inbox: everything NetLet has told this account, newest first
 * (`Shared/commerce/notices.ts`).
 *
 * A notice is stored as a message key and its values, so it is drawn here in
 * whichever language the page is in today, with merchant names in the
 * language they were typed in and amounts formatted the way the order page
 * formats them. Opening the inbox marks what it shows read — the count on the
 * account button is "what you have not seen", and these have been seen — but
 * the "New" tag stays for this visit, so somebody can still tell which ones
 * arrived since they last looked.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  Bell,
  CheckCircle2,
  LifeBuoy,
  Package,
  RotateCcw,
  ShoppingBag,
  Sparkles,
  Store,
  Tag,
  Truck,
  Wallet,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { QueryGate } from "@/components/admin/QueryGate";
import { useAuth } from "@/hooks/useAuth";
import { useDateTimeFormat } from "@/hooks/useDateFormat";
import { useTranslation } from "@/hooks/useTranslation";
import { formatMoney } from "@/lib/format";
import { isolate } from "@/lib/isolate";
import { trpc } from "@/lib/trpc";
import { noticeValues, type NoticeKind } from "@shared/commerce/notices";
import { isMessageKey } from "@shared/i18n/dictionary";

const ICONS: Partial<Record<NoticeKind, LucideIcon>> = {
  order_placed: Package,
  order_on_the_way: Truck,
  order_delivered: CheckCircle2,
  line_cancelled: XCircle,
  return_approved: RotateCcw,
  return_declined: RotateCcw,
  exchange_sent: Truck,
  refund_done: Wallet,
  back_in_stock: Bell,
  price_drop: Tag,
  offer_answered: Tag,
  support_answered: LifeBuoy,
  bag_reminder: ShoppingBag,
  new_arrival: Sparkles,
  seller_new_order: Store,
  seller_return: RotateCcw,
};

export function AccountNotifications() {
  const { t, isArabic, locale } = useTranslation();
  const { user } = useAuth();
  const formatWhen = useDateTimeFormat();
  const utils = trpc.useUtils();
  const [page, setPage] = useState(1);
  const list = trpc.notifications.list.useQuery({ page }, { placeholderData: previous => previous });
  const channels = trpc.notifications.channels.useQuery(undefined, { staleTime: 300_000 });
  const email = trpc.notifications.email.useQuery(undefined, { enabled: channels.data?.email === true });
  const markRead = trpc.notifications.markRead.useMutation({
    onSuccess: () => {
      void utils.notifications.unread.invalidate();
    },
  });
  const setEmail = trpc.notifications.setEmail.useMutation({
    onSuccess: allows => utils.notifications.email.setData(undefined, allows),
  });

  /* What this visit saw as new, kept after the server has been told they are read. */
  const fresh = useRef(new Set<number>());
  const entries = list.data?.entries ?? [];
  useEffect(() => {
    const unseen = entries.filter(entry => !entry.read && !fresh.current.has(entry.id)).map(entry => entry.id);
    if (!unseen.length) return;
    for (const id of unseen) fresh.current.add(id);
    markRead.mutate({ ids: unseen });
    /* Each page once, as it arrives; the mutation is not a reason to run again. */
  }, [entries]);

  const money = (amount: string) => formatMoney(amount, { locale });

  return (
    <div className="space-y-4">
      <QueryGate audience="shopper" queries={[list]}>
        {() => {
          const data = list.data!;
          if (data.total === 0) {
            return (
              <div className="rounded-[1.35rem] border border-[#d5dfeb] bg-white p-6">
                <span className="grid size-12 place-items-center rounded-2xl bg-[#e7edf5] text-[#0a285a]">
                  <Bell className="size-6" aria-hidden />
                </span>
                <p className="mt-4 max-w-prose text-sm leading-6 ink-muted">{t("notices.empty")}</p>
              </div>
            );
          }
          const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
          return (
            <section aria-labelledby="notices-list" className="rounded-[1.35rem] border border-[#d5dfeb] bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e7edf5] px-5 py-4">
                <h3 id="notices-list" className="text-sm font-extrabold text-[#0a285a]">{t("notices.title")}</h3>
                {data.unread > 0 ? (
                  <button
                    type="button"
                    onClick={() => markRead.mutate({ all: true }, { onSuccess: () => void utils.notifications.list.invalidate() })}
                    className="min-h-11 rounded-full px-3 text-[13px] font-bold text-[#0a285a] underline underline-offset-4"
                  >
                    {t("notices.markAll")}
                  </button>
                ) : null}
              </div>
              <ul className="divide-y divide-[#e7edf5]">
                {data.entries.map(entry => {
                  const Icon = ICONS[entry.kind as NoticeKind] ?? Bell;
                  const sentence = isMessageKey(entry.messageKey)
                    ? t(entry.messageKey, noticeValues(entry.params, isArabic, money))
                    : "";
                  const isNew = !entry.read || fresh.current.has(entry.id);
                  const body = (
                    <span className="flex items-start gap-3">
                      <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-[#e7edf5] text-[#0a285a]">
                        <Icon className="size-[18px]" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        {/* Merchant names inside it may be in either language. */}
                        <span dir="auto" className={`block text-sm leading-6 ${isNew ? "font-bold text-[#0a285a]" : "text-[#404553]"}`}>{sentence}</span>
                        <span className="mt-0.5 block text-[12px] ink-muted">{formatWhen(entry.createdAt)}</span>
                      </span>
                      {isNew ? (
                        <span className="mt-1 shrink-0 rounded-full bg-[#0a285a] px-2 py-0.5 text-[11px] font-extrabold text-white">{t("notices.new")}</span>
                      ) : null}
                    </span>
                  );
                  return (
                    <li key={entry.id}>
                      {entry.link ? (
                        <Link href={entry.link} className="block px-5 py-4 hover:bg-[#f0f2f5]">{body}</Link>
                      ) : (
                        <div className="px-5 py-4">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
              {pages > 1 ? (
                <nav aria-label={t("admin.pagination")} className="flex items-center justify-between gap-3 border-t border-[#e7edf5] px-5 py-3">
                  <button
                    type="button"
                    disabled={data.page <= 1}
                    onClick={() => setPage(data.page - 1)}
                    className="min-h-11 rounded-full px-3 text-[13px] font-bold text-[#0a285a] disabled:opacity-40"
                  >
                    {t("admin.previousPage")}
                  </button>
                  <span className="text-[12px] ink-muted">{t("admin.showingRange", { first: String((data.page - 1) * data.pageSize + 1), last: String(Math.min(data.total, data.page * data.pageSize)), total: String(data.total) })}</span>
                  <button
                    type="button"
                    disabled={data.page >= pages}
                    onClick={() => setPage(data.page + 1)}
                    className="min-h-11 rounded-full px-3 text-[13px] font-bold text-[#0a285a] disabled:opacity-40"
                  >
                    {t("admin.nextPage")}
                  </button>
                </nav>
              ) : null}
            </section>
          );
        }}
      </QueryGate>

      {/* Only while NetLet sends email: a switch for mail that never goes is a
          control that changes nothing. */}
      {channels.data?.email ? (
      <label className="tint-on-hover flex cursor-pointer items-start justify-between gap-4 rounded-[1.35rem] border border-[#d5dfeb] bg-white p-5">
        <span className="min-w-0">
          <span className="block text-sm font-bold text-[#0a285a]">{t("notices.email")}</span>
          <span className="mt-1 block text-[13px] leading-5 ink-muted">
            {t("notices.emailNote", { email: isolate(user?.email ?? "") })}
          </span>
        </span>
        <input
          type="checkbox"
          checked={email.data ?? true}
          disabled={email.isLoading || setEmail.isPending}
          onChange={event => setEmail.mutate({ allows: event.target.checked })}
          className="mt-1 size-4 shrink-0 accent-[#0a285a]"
        />
      </label>
      ) : null}
    </div>
  );
}

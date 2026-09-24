/**
 * Making a set.
 *
 * Requirement 3.3.11. Two rules decide everything on this page, and both are
 * about money rather than layout.
 *
 * **A seller may bundle their own goods; a set spanning two shops is NetLet's
 * own.** A seller who could put another shop's product into a discounted set
 * would be spending money that is not theirs, so the server refuses it and
 * this page only offers the choice to somebody who may make it.
 *
 * **A bundle price is an advertised saving**, so the Ministry permit rule that
 * governs a struck-through price governs this too. It is checked on the read,
 * which means a seller whose permit has lapsed sees their bundle vanish from
 * the shop without anybody editing it — said here so that is not a mystery.
 */
import { AdminShell } from "@/components/admin/AdminShell";
import { QueryGate } from "@/components/admin/QueryGate";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { can, type Actor } from "@shared/inventory/permissions";
import { privatePageMeta } from "@shared/seo";
import { LoaderCircle, PackagePlus, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const field =
  "type-body h-10 w-full rounded-xl border border-[#d5dfeb] bg-white px-3 text-[13px] text-[#0a285a] outline-none focus:border-[#f2683a]";

export default function AdminBundles() {
  usePageMeta(privatePageMeta("Bundles"));
  return <AdminShell need="product.view">{actor => <Bundles actor={actor} />}</AdminShell>;
}

function Bundles({ actor }: { actor: Actor }) {
  const { t, tError } = useTranslation();
  const money = useMoney();
  const list = trpc.inventory.bundles.list.useQuery();
  const utils = trpc.useUtils();

  const mayCrossVendor = can(actor, "platform.viewAll");
  const [draft, setDraft] = useState({
    name: "",
    bundlePrice: "",
    members: [{ variantId: "", quantity: "1" }, { variantId: "", quantity: "1" }],
  });

  const refresh = () => void utils.inventory.bundles.list.invalidate();
  const save = trpc.inventory.bundles.save.useMutation({
    onSuccess: () => {
      toast.success(t("admin.bundleSaved"));
      setDraft({ name: "", bundlePrice: "", members: [{ variantId: "", quantity: "1" }, { variantId: "", quantity: "1" }] });
      refresh();
    },
    onError: error => toast.error(tError(error.message)),
  });
  const setActive = trpc.inventory.bundles.setActive.useMutation({
    onSuccess: refresh,
    onError: error => toast.error(tError(error.message)),
  });

  const amount = (value: string) => money({ amount: value, currencyCode: "KWD" });

  return (
    <>
      <h1 className="text-xl font-extrabold">{t("admin.bundles")}</h1>
      <p className="mt-1 max-w-2xl text-[13px] leading-6 text-[#536b8c]">{t("admin.bundlesNote")}</p>

      <section className="mt-6 rounded-2xl border border-[#e6e9ef] bg-white p-5">
        <h2 className="flex items-center gap-2 text-sm font-extrabold">
          <PackagePlus className="size-4 ink-accent" aria-hidden /> {t("admin.bundleNew")}
        </h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-[11px] font-extrabold ink-muted">
            {t("admin.bundleName")}
            <input dir="auto" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} className={`${field} mt-1`} />
          </label>
          <label className="text-[11px] font-extrabold ink-muted">
            {t("admin.bundlePrice")}
            <input dir="ltr" inputMode="decimal" value={draft.bundlePrice} onChange={e => setDraft({ ...draft, bundlePrice: e.target.value })} className={`${field} mt-1`} />
          </label>
        </div>

        <h3 className="mt-5 text-[11px] font-extrabold ink-muted uppercase">{t("admin.bundleMembers")}</h3>
        <div className="mt-2 space-y-2">
          {draft.members.map((member, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                dir="ltr"
                inputMode="numeric"
                value={member.variantId}
                aria-label={t("admin.bundleMemberSku")}
                placeholder={t("admin.bundleMemberSku")}
                onChange={e => setDraft({
                  ...draft,
                  members: draft.members.map((entry, i) => i === index ? { ...entry, variantId: e.target.value } : entry),
                })}
                className={field}
              />
              <input
                dir="ltr"
                inputMode="numeric"
                value={member.quantity}
                aria-label={t("product.quantity")}
                onChange={e => setDraft({
                  ...draft,
                  members: draft.members.map((entry, i) => i === index ? { ...entry, quantity: e.target.value } : entry),
                })}
                className={`${field} w-20 shrink-0`}
              />
              {draft.members.length > 2 ? (
                <button
                  type="button"
                  onClick={() => setDraft({ ...draft, members: draft.members.filter((_, i) => i !== index) })}
                  aria-label={t("admin.bundleAddMember")}
                  className="tap-target ink-muted hover:text-[#a44a2b]"
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              ) : null}
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setDraft({ ...draft, members: [...draft.members, { variantId: "", quantity: "1" }] })}
            className="glass pressable inline-flex items-center gap-2 rounded-full border border-[#0a285a]/15 px-4 py-2 text-xs font-extrabold"
          >
            <Plus className="size-4" aria-hidden /> {t("admin.bundleAddMember")}
          </button>
          <button
            type="button"
            disabled={save.isPending || !draft.name.trim() || !draft.bundlePrice.trim()}
            onClick={() => save.mutate({
              name: draft.name.trim(),
              /* A seller's own bundle carries their vendor; an admin's carries
                 null, which is what lets it span two shops. */
              vendorId: mayCrossVendor ? null : actor.kind === "vendor" ? actor.vendorId : null,
              bundlePrice: draft.bundlePrice.trim(),
              members: draft.members
                .filter(member => member.variantId.trim())
                .map(member => ({ variantId: Number(member.variantId), quantity: Number(member.quantity) || 1 })),
            })}
            className="glass glass-navy pressable inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-xs font-extrabold disabled:opacity-60"
          >
            {save.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
            {t("admin.bundleSave")}
          </button>
        </div>
      </section>

      <QueryGate queries={[list]}>
        {() => {
          const rows = list.data ?? [];
          if (rows.length === 0) {
            return <p className="mt-6 text-[13px] text-[#536b8c]">{t("admin.bundlesEmpty")}</p>;
          }
          return (
            <ul className="mt-6 space-y-2">
              {rows.map(bundle => (
                <li key={bundle.id} className="rounded-2xl border border-[#e6e9ef] bg-white p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <p dir="auto" className="font-bold text-[#0a285a]">{bundle.name}</p>
                    <p className="text-[13px]">
                      <bdi dir="ltr" className="font-extrabold text-[#0a285a]">{amount(bundle.bundlePrice)}</bdi>
                      <span className="ink-muted"> · {t("admin.bundleSeparately", { amount: amount(bundle.separately) })}</span>
                    </p>
                  </div>
                  <p className="mt-1 text-[12px] ink-muted">
                    {bundle.members.map(member => member.productTitle).join(" + ")}
                    {bundle.crossVendor
                      ? ` · ${t("admin.bundleCrossVendor", { count: new Set(bundle.members.map(m => m.vendorId)).size })}`
                      : ""}
                  </p>
                  <button
                    type="button"
                    onClick={() => setActive.mutate({ id: bundle.id, active: !bundle.active })}
                    className="glass type-control pressable mt-2 rounded-full px-3 py-1.5"
                  >
                    {t(bundle.active ? "admin.bundleActive" : "admin.bundleInactive")}
                  </button>
                </li>
              ))}
            </ul>
          );
        }}
      </QueryGate>
    </>
  );
}

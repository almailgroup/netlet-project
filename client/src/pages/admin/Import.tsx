/**
 * Loading a shelf from a spreadsheet.
 *
 * Requirements 3.3.3 and 3.3.5. The reading, the refusing and the department
 * guessing are all in `shared/inventory/bulkUpload.ts` and all pure — this
 * page picks the file, shows what the importer made of it, and asks.
 *
 * **The preview is the feature.** An importer that writes on upload is one a
 * seller has to undo a row at a time, and the undo is the part nobody builds.
 * So the file is read in the browser, every problem is listed against its own
 * line number, and nothing is written until somebody presses the button on a
 * plan they can see.
 *
 * It is CSV rather than `.xlsx` because Excel writes CSV from Save As and
 * parsing the other needs a zip reader, an XML parser and a dependency
 * carrying both — to arrive at the same rows. The page says so rather than
 * leaving somebody to discover it from an error.
 */
import { AdminShell } from "@/components/admin/AdminShell";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/hooks/useTranslation";
import { isMessageKey } from "@shared/i18n/dictionary";
import { trpc } from "@/lib/trpc";
import { BULK_UPLOAD_LIMIT, planUpload, templateCsv, type UploadPlan } from "@shared/inventory/bulkUpload";
import { DEPARTMENTS } from "@shared/commerce/departments";
import { can, type Actor } from "@shared/inventory/permissions";
import { privatePageMeta } from "@shared/seo";
import { Download, LoaderCircle, Sparkles, Upload } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

export default function AdminImport() {
  usePageMeta(privatePageMeta("Import"));
  return <AdminShell need="product.create">{actor => <Import actor={actor} />}</AdminShell>;
}

function Import({ actor }: { actor: Actor }) {
  const { t } = useTranslation();

  /*
   * A department NetLet knows is shown in the reader's own language; anything
   * else is the seller's own word for it and is shown as typed. The *value*
   * written is always the catalog name, because that is what `categories.name`
   * is matched against — this is a label, not a second spelling.
   *
   * It matters here more than it looks: the preview is where somebody checks a
   * guess, and "Home & Kitchen" in the middle of an Arabic page is harder to
   * check than "المنزل والمطبخ".
   */
  const categoryLabel = (name: string | null) => {
    if (!name) return t("admin.importNoCategory");
    const known = DEPARTMENTS.find(department => department.name === name);
    return known ? t(known.label) : name;
  };
  const [, navigate] = useLocation();
  const [plan, setPlan] = useState<UploadPlan | null>(null);
  const [fileName, setFileName] = useState("");
  const [chosenVendor, setChosenVendor] = useState("");

  const vendors = trpc.inventory.vendors.list.useQuery(
    {},
    { enabled: actor.kind === "admin" },
  );
  const utils = trpc.useUtils();

  const upload = trpc.inventory.products.bulkCreate.useMutation({
    onSuccess: reply => {
      toast.success(t("admin.importDone", { count: reply.created }));
      void utils.inventory.products.list.invalidate();
      navigate("/admin/products");
    },
    /* A message key is translated; anything else is not shown. The server's
       own sentence used to go straight into the toast, so a refusal from the
       database arrived as "duplicate key value violates unique constraint" —
       untranslated on an Arabic page, and naming an index to somebody holding
       a spreadsheet. */
    onError: error => toast.error(
      error.message === "product.create" ? t("admin.forbidden")
        : isMessageKey(error.message) ? t(error.message)
        : t("admin.saveFailed"),
    ),
  });

  const vendorId =
    actor.kind === "vendor"
      ? actor.vendorId
      : Number(chosenVendor) || vendors.data?.rows?.[0]?.id || null;
  const mayCreate = can(actor, "product.create", actor.kind === "vendor" ? actor.vendorId : undefined);

  const read = async (file: File) => {
    setFileName(file.name);
    /* Read as text in the browser, by the same function the server would have
       used: `planUpload` has no database in it, so this is one round trip
       instead of an upload endpoint and a second call to confirm. */
    setPlan(planUpload(await file.text()));
  };

  const download = () => {
    /* A BOM, because Excel opens a plain UTF-8 CSV as Latin-1 and an Arabic
       column comes out as mojibake — the same byte this importer strips on
       the way back in. */
    const blob = new Blob([`﻿${templateCsv()}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "netlet-products.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const tooMany = (plan?.products.length ?? 0) > BULK_UPLOAD_LIMIT;

  return (
    <>
      <h1 className="text-[22px] leading-8 font-extrabold sm:text-[24px]">{t("admin.import")}</h1>
      <p className="mt-1 max-w-2xl text-[13px] leading-6 text-[#536b8c]">{t("admin.importNote")}</p>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <label className="glass glass-navy pressable inline-flex cursor-pointer items-center gap-2 rounded-full px-4 py-2.5 text-xs font-extrabold">
          <Upload className="size-4" aria-hidden />
          {t("admin.importChoose")}
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={event => {
              const file = event.target.files?.[0];
              if (file) void read(file);
            }}
          />
        </label>

        <button type="button" onClick={download} className="glass type-control pressable inline-flex items-center gap-2 rounded-full px-4 py-2.5">
          <Download className="size-4" aria-hidden /> {t("admin.importTemplate")}
        </button>

        {/* Only a real choice for an admin with more than one store. */}
        {actor.kind === "admin" && (vendors.data?.rows ?? []).length > 1 ? (
          <label className="text-[11px] font-extrabold text-[#536b8c]">
            {t("admin.productVendor")}
            {/* Named itself, because a <label> wrapping a select pulls every
                option's text into the accessible name. */}
            <select
              aria-label={t("admin.productVendor")}
              value={chosenVendor || String(vendors.data?.rows?.[0]?.id ?? "")}
              onChange={event => setChosenVendor(event.target.value)}
              className="type-body ms-2 h-10 rounded-xl border border-[#d5dfeb] bg-white px-2.5 text-[12px] text-[#0a285a] outline-none focus:border-[#0a285a]"
            >
              {(vendors.data?.rows ?? []).map(vendor => (
                <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
              ))}
            </select>
          </label>
        ) : null}

        {fileName ? <p className="text-[12px] text-[#536b8c]"><bdi dir="ltr">{fileName}</bdi></p> : null}
      </div>

      {plan ? (
        <div className="mt-6 space-y-5">
          <p className="text-[13px] font-extrabold text-[#0a285a]">
            {t("admin.importSummary", { rows: plan.products.length, problems: plan.problems.length })}
          </p>

          {/* The guesses are named rather than counted quietly: a seller who
              disagrees with one can fix the column and upload again, and one
              who is never told cannot. */}
          {plan.guessed > 0 ? (
            <p className="flex items-start gap-2 rounded-xl border border-[#d5dfeb] bg-white/70 px-4 py-3 text-[12px] leading-5 text-[#536b8c]">
              <Sparkles className="mt-0.5 size-4 shrink-0 ink-accent" aria-hidden />
              {t("admin.importGuessed", { count: plan.guessed })}
            </p>
          ) : null}

          {plan.problems.length > 0 ? (
            <div>
              <h2 id="import-problems" className="text-sm font-extrabold text-[#8c2f22]">{t("admin.importProblems")}</h2>
              <ul className="mt-2 space-y-1">
                {plan.problems.map(problem => (
                  <li key={`${problem.line}-${problem.reason}`} className="rounded-xl border border-[#f2b69e] bg-[#fdeceb] px-4 py-2 text-[12px] text-[#8c2f22]">
                    {t("admin.importLine", { line: problem.line })} · {t(problem.reason)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {plan.products.length > 0 ? (
            <div
              role="region"
              aria-labelledby="import-preview"
              tabIndex={0}
              className="overflow-x-auto rounded-xl border border-[#d5dfeb] bg-white/70"
            >
              <h2 id="import-preview" className="sr-only">{t("admin.importPreview")}</h2>
              <table className="w-full min-w-[560px] border-collapse">
                <thead>
                  <tr className="border-b border-[#d5dfeb]">
                    <th scope="col" className="px-4 py-2 text-start text-[11px] font-extrabold ink-muted uppercase">{t("admin.importLineShort")}</th>
                    <th scope="col" className="px-4 py-2 text-start text-[11px] font-extrabold ink-muted uppercase">{t("admin.productTitle")}</th>
                    <th scope="col" className="px-4 py-2 text-end text-[11px] font-extrabold ink-muted uppercase">{t("admin.price")}</th>
                    <th scope="col" className="px-4 py-2 text-end text-[11px] font-extrabold ink-muted uppercase">{t("admin.stock")}</th>
                    <th scope="col" className="px-4 py-2 text-start text-[11px] font-extrabold ink-muted uppercase">{t("admin.category")}</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.products.slice(0, 50).map(product => (
                    <tr key={product.line} className="border-b border-[#eef1f6] last:border-0">
                      <th scope="row" className="px-4 py-2 text-start text-[12px] font-normal ink-muted"><bdi dir="ltr">{product.line}</bdi></th>
                      <td className="px-4 py-2 text-[13px] font-bold text-[#0a285a]"><span dir="auto">{product.title}</span></td>
                      <td className="px-4 py-2 text-end text-[13px]"><bdi dir="ltr">{product.price}</bdi></td>
                      <td className="px-4 py-2 text-end text-[13px]"><bdi dir="ltr">{product.stock}</bdi></td>
                      <td className="px-4 py-2 text-[13px]">
                        <span dir="auto">{categoryLabel(product.category)}</span>
                        {product.categoryGuessed ? <span className="ms-1 ink-accent">·&nbsp;{t("admin.importGuessTag")}</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {/* Only ever a count of what is *not* shown, never a silent cut. */}
          {plan.products.length > 50 ? (
            <p className="text-[12px] ink-muted">{t("admin.importMore", { count: plan.products.length - 50 })}</p>
          ) : null}

          {tooMany ? (
            <p className="rounded-xl border border-[#f2b69e] bg-[#fdeceb] px-4 py-3 text-[13px] font-semibold text-[#8c2f22]">
              {t("admin.importTooMany", { limit: BULK_UPLOAD_LIMIT })}
            </p>
          ) : null}

          {mayCreate && vendorId !== null ? (
            <button
              type="button"
              disabled={upload.isPending || plan.products.length === 0 || tooMany}
              onClick={() => upload.mutate({
                vendorId,
                rows: plan.products.map(({ line: _line, categoryGuessed: _guessed, ...row }) => row),
              })}
              className="glass glass-navy pressable inline-flex items-center gap-2 rounded-full px-5 py-3 text-xs font-extrabold disabled:opacity-60"
            >
              {upload.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
              {t("admin.importCreate", { count: plan.products.length })}
            </button>
          ) : (
            <p className="text-[12px] font-semibold text-[#8c2f22]">{t("admin.needVendorFirst")}</p>
          )}

          {/* Said before the press, not after: everything lands as a draft,
              because publishing has its own rules and an importer that could
              put four hundred rows in the shop can put four hundred mistakes
              there. */}
          <p className="max-w-2xl text-[12px] leading-5 ink-muted">{t("admin.importDrafts")}</p>
        </div>
      ) : null}
    </>
  );
}

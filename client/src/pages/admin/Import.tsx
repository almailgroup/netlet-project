/**
 * Loading a shelf from a spreadsheet.
 *
 * Requirements 3.3.3 and 3.3.5. The reading, the refusing and the department
 * guessing are all in `Shared/inventory/bulkUpload.ts` and all pure — this
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
import { buttonClass, Card, Field, fieldClass, Notice, PageHeader, tableClass } from "@/components/admin/ui";
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
import { Select } from "@/components/ui/Select";

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
    { pageSize: 200 },
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

  /* An administrator names the store, every time. It used to fall back to
     whichever store came first in the list, so a file uploaded without
     touching the picker landed four hundred products on somebody else's
     shelf — and the picker was only drawn at all once there were two. */
  const vendorId = actor.kind === "vendor" ? actor.vendorId : Number(chosenVendor) || null;
  const storeRows = vendors.data?.rows ?? [];
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
      <PageHeader
        title={t("admin.import")}
        description={t("admin.importNote")}
        actions={
          <button type="button" onClick={download} className={buttonClass.secondary}>
            <Download className="size-4" aria-hidden /> {t("admin.importTemplate")}
          </button>
        }
      />

      <div className="max-w-4xl space-y-5">
        {actor.kind === "admin" ? (
          <Card title={t("admin.importStoreTitle")} step={1}>
            {vendors.isSuccess && storeRows.length === 0 ? (
              <Notice tone="warning">{t("admin.needVendorFirst")}</Notice>
            ) : (
              <Field label={t("admin.newStore")} hint={t("admin.newStoreHint")}>
                <Select value={chosenVendor} onChange={event => setChosenVendor(event.target.value)} className={`${fieldClass} sm:max-w-md`}>
                  <option value="" disabled>{t("admin.chooseStore")}</option>
                  {storeRows.map(vendor => (
                    <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
                  ))}
                </Select>
              </Field>
            )}
          </Card>
        ) : null}

        <Card title={t("admin.importFileTitle")} step={actor.kind === "admin" ? 2 : 1} description={t("admin.importFileHint")}>
          <div className="flex flex-wrap items-center gap-3">
            <label className={`${buttonClass.primary} cursor-pointer focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#0a285a]`}>
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
            {fileName ? <p className="text-[13px] font-semibold text-[#3d5376]"><bdi dir="ltr">{fileName}</bdi></p> : null}
          </div>
        </Card>

        {plan ? (
          <Card
            title={t("admin.importCheckTitle")}
            step={actor.kind === "admin" ? 3 : 2}
            description={t("admin.importSummary", { rows: plan.products.length, problems: plan.problems.length })}
            footer={
              mayCreate ? (
                <button
                  type="button"
                  disabled={upload.isPending || plan.products.length === 0 || tooMany || vendorId === null}
                  onClick={() => vendorId !== null && upload.mutate({
                    vendorId,
                    rows: plan.products.map(({ line: _line, categoryGuessed: _guessed, ...row }) => row),
                  })}
                  className={buttonClass.primary}
                >
                  {upload.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
                  {t("admin.importCreate", { count: plan.products.length })}
                </button>
              ) : null
            }
          >
            <div className="space-y-4">
              {/* The guesses are named rather than counted quietly: a seller who
                  disagrees with one can fix the column and upload again, and one
                  who is never told cannot. */}
              {plan.guessed > 0 ? (
                <Notice tone="info">
                  <span className="inline-flex items-start gap-2"><Sparkles className="mt-1 size-4 shrink-0 ink-accent" aria-hidden />{t("admin.importGuessed", { count: plan.guessed })}</span>
                </Notice>
              ) : null}

              {plan.problems.length > 0 ? (
                <div>
                  <h3 id="import-problems" className="text-[14px] font-bold text-[#8c2f22]">{t("admin.importProblems")}</h3>
                  <ul className="mt-2 space-y-1.5">
                    {plan.problems.map(problem => (
                      <li key={`${problem.line}-${problem.reason}`} className="rounded-lg border border-[#f2b69e] bg-[#fdeceb] px-3.5 py-2 text-[13px] text-[#8c2f22]">
                        <span className="font-semibold">{t("admin.importLine", { line: problem.line })}</span> · {t(problem.reason)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {plan.products.length > 0 ? (
                <div role="region" aria-labelledby="import-preview" tabIndex={0} className={tableClass.wrap}>
                  <h3 id="import-preview" className="sr-only">{t("admin.importPreview")}</h3>
                  <table className={`${tableClass.table} min-w-[560px]`}>
                    <thead className={tableClass.head}>
                      <tr>
                        <th scope="col" className={tableClass.th}>{t("admin.importLineShort")}</th>
                        <th scope="col" className={tableClass.th}>{t("admin.productTitle")}</th>
                        <th scope="col" className={tableClass.thEnd}>{t("admin.price")}</th>
                        <th scope="col" className={tableClass.thEnd}>{t("admin.stock")}</th>
                        <th scope="col" className={tableClass.th}>{t("admin.category")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.products.slice(0, 50).map(product => (
                        <tr key={product.line} className={tableClass.row}>
                          <th scope="row" className={`${tableClass.td} text-start font-normal text-[#536b8c]`}><bdi dir="ltr">{product.line}</bdi></th>
                          <td className={`${tableClass.td} font-semibold text-[#0a285a]`}><span dir="auto">{product.title}</span></td>
                          <td className={`${tableClass.td} text-end tabular-nums`}><bdi dir="ltr">{product.price}</bdi></td>
                          <td className={`${tableClass.td} text-end tabular-nums`}><bdi dir="ltr">{product.stock}</bdi></td>
                          <td className={tableClass.td}>
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
                <p className="text-[13px] ink-muted">{t("admin.importMore", { count: plan.products.length - 50 })}</p>
              ) : null}

              {tooMany ? <Notice tone="danger">{t("admin.importTooMany", { limit: BULK_UPLOAD_LIMIT })}</Notice> : null}
              {actor.kind === "admin" && vendorId === null && plan.products.length > 0 ? <Notice tone="warning">{t("admin.importStoreNeeded")}</Notice> : null}

              {/* Said before the press, not after: everything lands as a draft,
                  because publishing has its own rules and an importer that could
                  put four hundred rows in the shop can put four hundred mistakes
                  there. */}
              <p className="max-w-2xl text-[13px] leading-5 ink-muted">{t("admin.importDrafts")}</p>
            </div>
          </Card>
        ) : null}
      </div>
    </>
  );
}

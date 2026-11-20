/**
 * A product's tax (0087), in its editor: whether it is taxed by today's rules,
 * whether NetLet marked it or it follows the shop's setting, and — for NetLet,
 * whose decision it is on the owner's word — the three choices to change it.
 * A store reads it and cannot change it, and is told so.
 *
 * The server answers `taxed` by the rules now, on or off, so the card can say
 * "would be" while tax is off for the shop without doing the rule itself.
 */
import { LoaderCircle, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, Notice, buttonClass } from "@/components/admin/ui";
import { QueryGate } from "@/components/ui/QueryGate";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { rateLabel } from "@shared/commerce/tax";
import { BULK_TAX_CHOICES, type BulkTaxChoice } from "@shared/inventory/productBulk";
import type { MessageKey } from "@shared/i18n/dictionary";

const CHOICE_LABEL: Record<BulkTaxChoice, MessageKey> = {
  taxed: "tax.choiceTaxed",
  exempt: "tax.choiceExempt",
  follow: "tax.choiceFollow",
};

export function ProductTaxCard({ productId }: { productId: number }) {
  const { t, tError } = useTranslation();
  const utils = trpc.useUtils();
  const status = trpc.inventory.products.tax.useQuery({ id: productId });
  const stored: BulkTaxChoice = status.data?.choice ?? "follow";
  const [choice, setChoice] = useState<BulkTaxChoice>(stored);
  useEffect(() => setChoice(stored), [stored]);

  const save = trpc.inventory.products.setTax.useMutation({
    onSuccess: () => {
      toast.success(t("tax.saved"));
      void utils.inventory.products.tax.invalidate({ id: productId });
    },
    onError: error => toast.error(tError(error.message)),
  });

  const data = status.data;
  const mayChange = Boolean(data?.mayChange && data.ready);
  return (
    <Card
      id="tax"
      title={t("tax.editorTitle")}
      footer={mayChange ? (
        <button type="button" onClick={() => save.mutate({ id: productId, choice })} disabled={save.isPending || choice === stored} className={buttonClass.primary}>
          {save.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
          {t(save.isPending ? "admin.saving" : "admin.save")}
        </button>
      ) : null}
    >
      <QueryGate queries={[status]}>
        {() => data ? (
          <div className="space-y-3">
            <p className="text-[14px] font-semibold leading-6 text-[#0a285a]">
              {data.on
                ? data.taxed ? t("tax.editorTaxed", { rate: rateLabel(data.ratePercent) }) : t("tax.editorNotTaxed")
                : data.taxed ? t("tax.editorOffTaxed", { rate: rateLabel(data.ratePercent) }) : t("tax.editorOffNotTaxed")}
              {" "}
              <span className="font-normal text-[#536b8c]">{t(data.choice ? "tax.editorMarked" : "tax.editorFollows")}</span>
            </p>
            {!data.ready ? <Notice tone="warning">{t("tax.unavailable")}</Notice> : null}
            {data.mayChange && data.ready ? (
              <fieldset>
                <legend className="text-[13px] font-semibold text-[#0a285a]">{t("tax.choiceLabel")}</legend>
                <div className="mt-1.5 space-y-1">
                  {BULK_TAX_CHOICES.map(option => (
                    <label key={option} className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-2 text-[14px] font-semibold text-[#0a285a]">
                      <input type="radio" name={`product-tax-${productId}`} value={option} checked={choice === option} onChange={() => setChoice(option)} className="size-4 accent-[#0a285a]" />
                      {t(CHOICE_LABEL[option])}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : data.ready ? (
              <p className="text-[13px] leading-5 text-[#536b8c]">{t("tax.editorNetLetOnly")}</p>
            ) : null}
          </div>
        ) : null}
      </QueryGate>
    </Card>
  );
}

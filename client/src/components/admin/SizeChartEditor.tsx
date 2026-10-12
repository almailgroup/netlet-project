/**
 * The seller's size chart (3.1.20), on the product editor.
 *
 * Its own section with its own Save, for the reason every panel on the editor
 * has one: a chart is edited as a whole and a Save shared with the title would
 * write a half-typed range somebody had not finished.
 *
 * The rows start from the product's own sizes — the values of the option the
 * chart is about — so "S, M, L, XL" is typed once, in the variants, and the
 * chart and the picker cannot name different sizes. `chartProblem` is the same
 * rule the server refuses with, asked as the seller types, so Save is disabled
 * on exactly what the API would bounce and the reason is said in words.
 */
import { buttonClass } from "./ui";
import { useEffect, useMemo, useState } from "react";
import { LoaderCircle, Plus, Ruler, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { chartProblem, MAX_SIZES, MEASURES, type BodyMeasure, type SizeChart } from "@shared/commerce/sizeGuide";
import { MEASURE_LABEL } from "@/lib/sizeGuideLabels";
import { Select } from "@/components/ui/Select";


/** Ranges are edited as text so a half-typed "9" is not coerced on every key. */
type DraftRow = { size: string; ranges: Partial<Record<BodyMeasure, [string, string]>> };
type Draft = { axis: string; measures: BodyMeasure[]; rows: DraftRow[] };

function toDraft(chart: SizeChart): Draft {
  return {
    axis: chart.axis,
    measures: chart.measures,
    rows: chart.rows.map(row => ({
      size: row.size,
      ranges: Object.fromEntries(Object.entries(row.ranges).map(([measure, range]) => [measure, [String(range![0]), String(range![1])]])),
    })),
  };
}

function toChart(draft: Draft): SizeChart {
  return {
    axis: draft.axis,
    measures: draft.measures,
    rows: draft.rows.map(row => ({
      size: row.size,
      ranges: Object.fromEntries(
        draft.measures.map(measure => {
          const [low, high] = row.ranges[measure] ?? ["", ""];
          return [measure, [low.trim() === "" ? Number.NaN : Number(low), high.trim() === "" ? Number.NaN : Number(high)]];
        }),
      ),
    })),
  };
}

export function SizeChartEditor({ productId, chart, variantOptions, mayEdit }: {
  productId: number;
  chart: SizeChart | null;
  /** Each variant's options, e.g. `{ Size: "M" }`. */
  variantOptions: Record<string, string>[];
  mayEdit: boolean;
}) {
  const { t, tError } = useTranslation();
  const utils = trpc.useUtils();
  const axes = useMemo(() => [...new Set(variantOptions.flatMap(options => Object.keys(options)))], [variantOptions]);
  const valuesFor = (axis: string) => [...new Set(variantOptions.map(options => options[axis]).filter((value): value is string => Boolean(value)))];
  const defaultAxis = axes.find(axis => /size|مقاس/i.test(axis)) ?? axes[0] ?? "Size";

  const [draft, setDraft] = useState<Draft | null>(chart ? toDraft(chart) : null);
  useEffect(() => { setDraft(chart ? toDraft(chart) : null); }, [chart]);

  const save = trpc.inventory.products.setSizeChart.useMutation({
    onSuccess: (_reply, input) => {
      toast.success(t(input.chart ? "sizeGuide.saved" : "sizeGuide.removed"));
      void utils.inventory.products.get.invalidate({ id: productId });
    },
    onError: error => toast.error(tError(error.message)),
  });

  const start = () => {
    const sizes = valuesFor(defaultAxis);
    setDraft({ axis: defaultAxis, measures: ["chest"], rows: (sizes.length ? sizes : [""]).slice(0, MAX_SIZES).map(size => ({ size, ranges: {} })) });
  };

  const problem = draft ? chartProblem(toChart(draft)) : null;
  const setRange = (index: number, measure: BodyMeasure, end: 0 | 1, value: string) => setDraft(current => current && ({
    ...current,
    rows: current.rows.map((row, i) => {
      if (i !== index) return row;
      const range: [string, string] = [...(row.ranges[measure] ?? ["", ""])] as [string, string];
      range[end] = value;
      return { ...row, ranges: { ...row.ranges, [measure]: range } };
    }),
  }));

  return (
    <section className="min-w-0 rounded-2xl border border-[#e1e7ef] bg-white p-5 sm:p-6" aria-labelledby="size-guide-heading">
      <h2 id="size-guide-heading" className="flex items-center gap-2 text-[16px] leading-6 font-bold text-[#0a285a]"><Ruler className="size-4" aria-hidden />{t("sizeGuide.editorHeading")}</h2>
      <p className="mt-1 max-w-2xl text-[13px] leading-5 ink-muted">{t("sizeGuide.editorHint")}</p>

      {!draft ? (
        mayEdit ? (
          <button type="button" onClick={start} className={`${buttonClass.secondary} mt-4`}>
            <Plus className="size-4" aria-hidden />{t("sizeGuide.add")}
          </button>
        ) : <p className="mt-4 text-[13px] text-[#536b8c]">{t("sizeGuide.none")}</p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-end gap-4">
            {axes.length > 1 ? (
              <label className="block">
                <span className="block text-[13px] font-semibold text-[#0a285a]">{t("sizeGuide.axis")}</span>
                <Select
                  value={draft.axis}
                  disabled={!mayEdit}
                  onChange={event => setDraft({ ...draft, axis: event.target.value })}
                  className="type-body mt-1 h-10 rounded-xl border border-[#d5dfeb] bg-white px-3 text-[13px] text-[#0a285a]"
                >
                  {axes.map(axis => <option key={axis} value={axis}>{axis}</option>)}
                </Select>
              </label>
            ) : null}
            <fieldset>
              <legend className="text-[13px] font-semibold text-[#0a285a]">{t("sizeGuide.measures")}</legend>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                {MEASURES.map(measure => (
                  <label key={measure} className="flex items-center gap-1.5 text-[12px] font-bold text-[#0a285a]">
                    <input
                      type="checkbox"
                      disabled={!mayEdit}
                      checked={draft.measures.includes(measure)}
                      onChange={event => setDraft({
                        ...draft,
                        measures: event.target.checked ? MEASURES.filter(m => m === measure || draft.measures.includes(m)) : draft.measures.filter(m => m !== measure),
                      })}
                      className="size-4 accent-[#0a285a]"
                    />
                    {t(MEASURE_LABEL[measure])}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          <div role="region" tabIndex={0} aria-label={t("sizeGuide.tableCaption")} className="relative mt-4 overflow-x-auto">
            <table className="min-w-full text-[12px]">
              <caption className="sr-only">{t("sizeGuide.tableCaption")}</caption>
              <thead>
                <tr className="text-start">
                  <th scope="col" className="pb-2 pe-3 text-start font-extrabold">{draft.axis || t("sizeGuide.size")}</th>
                  {draft.measures.map(measure => (
                    <th key={measure} scope="col" className="pb-2 pe-3 text-start font-extrabold">{t("sizeGuide.rangeCm", { measure: t(MEASURE_LABEL[measure]) })}</th>
                  ))}
                  <th scope="col"><span className="sr-only">{t("sizeGuide.removeRow")}</span></th>
                </tr>
              </thead>
              <tbody>
                {draft.rows.map((row, index) => (
                  <tr key={index} className="align-top">
                    <td className="py-1 pe-3">
                      <input
                        value={row.size}
                        disabled={!mayEdit}
                        maxLength={20}
                        aria-label={t("sizeGuide.size")}
                        onChange={event => setDraft({ ...draft, rows: draft.rows.map((entry, i) => (i === index ? { ...entry, size: event.target.value } : entry)) })}
                        className="h-9 w-20 rounded-lg border border-[#d5dfeb] px-2 font-bold"
                      />
                    </td>
                    {draft.measures.map(measure => (
                      <td key={measure} className="py-1 pe-3">
                        <div className="flex items-center gap-1">
                          {([0, 1] as const).map(end => (
                            <input
                              key={end}
                              inputMode="decimal"
                              dir="ltr"
                              disabled={!mayEdit}
                              value={row.ranges[measure]?.[end] ?? ""}
                              aria-label={t(end === 0 ? "sizeGuide.from" : "sizeGuide.to", { measure: t(MEASURE_LABEL[measure]), size: row.size || "—" })}
                              onChange={event => setRange(index, measure, end, event.target.value.replace(/[^\d.]/g, ""))}
                              className="h-9 w-16 rounded-lg border border-[#d5dfeb] px-2 text-center"
                            />
                          ))}
                        </div>
                      </td>
                    ))}
                    <td className="py-1">
                      {mayEdit ? (
                        <button
                          type="button"
                          onClick={() => setDraft({ ...draft, rows: draft.rows.filter((_, i) => i !== index) })}
                          aria-label={t("sizeGuide.removeSize", { size: row.size || "—" })}
                          className="pressable tap-target grid size-8 place-items-center rounded-full text-[#8c2f22]"
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {problem ? <p className="mt-3 text-[12px] font-bold text-[#8c2f22]" role="status">{t(problem)}</p> : null}

          {mayEdit ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {draft.rows.length < MAX_SIZES ? (
                <button type="button" onClick={() => setDraft({ ...draft, rows: [...draft.rows, { size: "", ranges: {} }] })} className={buttonClass.secondary}>
                  <Plus className="size-4" aria-hidden />{t("sizeGuide.addSize")}
                </button>
              ) : null}
              <button
                type="button"
                disabled={problem !== null || save.isPending}
                onClick={() => save.mutate({ productId, chart: toChart(draft) })}
                className={buttonClass.primary}
              >
                {save.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
                {t("admin.save")}
              </button>
              <button
                type="button"
                disabled={save.isPending}
                onClick={() => (chart ? save.mutate({ productId, chart: null }) : setDraft(null))}
                className="pressable inline-flex items-center gap-2 rounded-full px-4 py-2 text-[12px] font-extrabold text-[#8c2f22]"
              >
                {t("sizeGuide.remove")}
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

/**
 * The size guide on a product page (3.1.20): the seller's chart, and which
 * size fits the shopper.
 *
 * The fit is worked out here, in the browser, by `recommendSize` — nothing
 * about anybody's body is sent to NetLet or to anybody else, and the panel
 * says so, because a form asking for a waist measurement is the kind somebody
 * hesitates over. Remembering the numbers is a choice, off by default, and
 * kept only in this browser's own storage.
 *
 * The answer is a rule's and shows its working — each measurement against the
 * range it was compared to — so "we suggest L" can be checked against the
 * chart above it. Choosing the size picks it in the variant picker, so the
 * guide ends where the decision does.
 *
 * A modal, and owes what every modal here does through `useOverlay`. Focus is
 * moved in by an effect declared after the hook, for the reason the image
 * lightbox does it that way: `autoFocus` runs before the hook records the
 * opener, and closing would drop the keyboard on `<body>`.
 */
import { useEffect, useId, useRef, useState } from "react";
import { Ruler, X } from "lucide-react";
import { MEASURE_LABEL } from "@/lib/sizeGuideLabels";
import { useOverlay } from "@/hooks/useOverlay";
import { useTranslation } from "@/hooks/useTranslation";
import { readStored, writeStored } from "@/lib/browserStore";
import { adviseForFit, fitTendency, recommendSize, type BodyMeasure, type FitTendency, type SizeAnswer, type SizeChart } from "@shared/commerce/sizeGuide";
import { trpc } from "@/lib/trpc";

const STORE_KEY = "netlet:measurements";

const VERDICT = {
  within: "sizeGuide.verdictWithin",
  below: "sizeGuide.verdictBelow",
  above: "sizeGuide.verdictAbove",
} as const;

function remembered(): Partial<Record<BodyMeasure, string>> {
  try {
    const parsed = JSON.parse(readStored(STORE_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function SizeGuide({ productId, chart, availableSizes, onChooseSize }: {
  /** Whose size returns to learn from. */
  productId: string;
  chart: SizeChart;
  /** Sizes the variant picker can actually select. */
  availableSizes: string[];
  onChooseSize: (size: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="pressable mt-2 inline-flex items-center gap-1.5 text-[12px] font-extrabold text-[#0a285a] underline underline-offset-2"
      >
        <Ruler className="size-3.5" aria-hidden />{t("sizeGuide.open")}
      </button>
      {open ? <Dialog productId={productId} chart={chart} availableSizes={availableSizes} onChooseSize={onChooseSize} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function Dialog({ productId, chart, availableSizes, onChooseSize, onClose }: {
  productId: string;
  chart: SizeChart;
  availableSizes: string[];
  onChooseSize: (size: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const firstField = useRef<HTMLInputElement>(null);
  useOverlay(true, onClose);
  useEffect(() => { firstField.current?.focus(); }, []);

  const [values, setValues] = useState<Partial<Record<BodyMeasure, string>>>(remembered);
  const [remember, setRemember] = useState(() => Object.keys(remembered()).length > 0);
  const [answer, setAnswer] = useState<SizeAnswer | null>(null);
  /* What this product's size returns have said (3.1.20): counts, not people. */
  const fit = trpc.returns.fit.useQuery({ productId }, { staleTime: 300_000 });
  const tendency = fit.data ? fitTendency(fit.data) : null;

  const find = () => {
    const numbers = Object.fromEntries(chart.measures.map(measure => [measure, Number(values[measure] ?? "")]).filter(([, value]) => Number.isFinite(value) && (value as number) > 0));
    setAnswer(recommendSize(chart, numbers));
    /* Kept only when asked, and forgotten when the box is cleared. */
    writeStored(STORE_KEY, remember ? JSON.stringify(values) : "{}");
  };

  const canChoose = answer && (answer.kind === "fits" || answer.kind === "closest") && availableSizes.some(size => size.toLowerCase() === answer.size.toLowerCase());

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-[#061b3b]/50 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={event => event.stopPropagation()}
        className="max-h-[90dvh] w-full max-w-[520px] overflow-y-auto rounded-3xl bg-[#fffdf9] p-6 shadow-[0_24px_60px_rgba(10,40,90,.28)]"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-lg font-extrabold text-[#0a285a]">{t("sizeGuide.title")}</h2>
          <button type="button" onClick={onClose} aria-label={t("sizeGuide.close")} className="glass pressable grid size-9 shrink-0 place-items-center rounded-full">
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <div role="region" tabIndex={0} aria-label={t("sizeGuide.chartLabel")} className="mt-4 overflow-x-auto">
          <table className="w-full text-[12px] text-[#0a285a]">
            <caption className="pb-2 text-start text-[11px] font-semibold ink-muted">{t("sizeGuide.chartCaption")}</caption>
            <thead>
              <tr className="border-b border-[#e6e9ef]">
                <th scope="col" className="py-2 pe-3 text-start font-extrabold"><bdi>{chart.axis}</bdi></th>
                {chart.measures.map(measure => <th key={measure} scope="col" className="py-2 pe-3 text-start font-extrabold">{t(MEASURE_LABEL[measure])}</th>)}
              </tr>
            </thead>
            <tbody>
              {chart.rows.map(row => {
                const chosen = answer && (answer.kind === "fits" || answer.kind === "closest") && answer.size === row.size;
                return (
                  <tr key={row.size} className={`border-b border-[#f0f2f6] ${chosen ? "bg-[#eaf1fb] font-extrabold" : ""}`}>
                    <th scope="row" className="py-2 pe-3 text-start font-extrabold"><bdi>{row.size}</bdi></th>
                    {chart.measures.map(measure => {
                      const range = row.ranges[measure];
                      return <td key={measure} className="py-2 pe-3"><bdi dir="ltr">{range ? `${range[0]}–${range[1]}` : "—"}</bdi></td>;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {tendency && fit.data ? (
          <p className="mt-3 rounded-xl bg-[#fbf3ef] px-3 py-2 text-[12px] leading-5 text-[#0a285a]">
            {t(tendency === "runsSmall" ? "sizeGuide.runsSmall" : "sizeGuide.runsLarge", {
              count: String(tendency === "runsSmall" ? fit.data.tooSmall : fit.data.tooLarge),
              total: String(fit.data.tooSmall + fit.data.tooLarge),
            })}
          </p>
        ) : null}

        <form
          className="mt-5 rounded-2xl border border-[#d5dfeb] bg-white p-4"
          onSubmit={event => { event.preventDefault(); find(); }}
        >
          <h3 className="text-sm font-extrabold text-[#0a285a]">{t("sizeGuide.findMine")}</h3>
          <p className="mt-1 text-[11px] leading-5 ink-muted">{t("sizeGuide.private")}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {chart.measures.map((measure, index) => (
              <label key={measure} className="block">
                <span className="block text-[11px] font-extrabold ink-muted">{t("sizeGuide.yourMeasure", { measure: t(MEASURE_LABEL[measure]) })}</span>
                <input
                  ref={index === 0 ? firstField : undefined}
                  inputMode="decimal"
                  dir="ltr"
                  value={values[measure] ?? ""}
                  onChange={event => setValues(current => ({ ...current, [measure]: event.target.value.replace(/[^\d.]/g, "") }))}
                  className="glass-field mt-1 h-10 w-full rounded-full px-4 text-sm"
                />
              </label>
            ))}
          </div>
          <label className="mt-3 flex items-center gap-2 text-[12px] font-bold text-[#0a285a]">
            <input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} className="size-4 accent-[#0a285a]" />
            {t("sizeGuide.remember")}
          </label>
          <button type="submit" className="glass-navy type-control pressable mt-3 rounded-full px-5 py-2">{t("sizeGuide.find")}</button>
        </form>

        {answer ? <Answer answer={answer} advice={adviseForFit(chart, answer, tendency)} tendency={tendency} availableSizes={availableSizes} canChoose={Boolean(canChoose)} onChoose={size => { onChooseSize(size); onClose(); }} /> : null}
      </div>
    </div>
  );
}

function Answer({ answer, advice, tendency, availableSizes, canChoose, onChoose }: {
  answer: SizeAnswer;
  /** The size the returns lean toward instead, if they lean. */
  advice: string | null;
  tendency: FitTendency | null;
  availableSizes: string[];
  canChoose: boolean;
  onChoose: (size: string) => void;
}) {
  const { t } = useTranslation();
  if (answer.kind === "nothingToCompare") return <p role="status" className="mt-4 text-[13px] ink-muted">{t("sizeGuide.nothing")}</p>;
  if (answer.kind === "belowChart" || answer.kind === "aboveChart") {
    return <p role="status" className="mt-4 text-[13px] font-bold text-[#8c2f22]">{t(answer.kind === "belowChart" ? "sizeGuide.below" : "sizeGuide.above")}</p>;
  }
  return (
    <div role="status" className="mt-4 rounded-2xl bg-[#eaf1fb] p-4 text-[#0a285a]">
      <p className="text-sm font-extrabold">
        {t(answer.kind === "fits" ? "sizeGuide.fits" : "sizeGuide.closest", { size: answer.size })}
      </p>
      <ul className="mt-2 space-y-1 text-[12px]">
        {answer.comparisons.map(entry => (
          <li key={entry.measure}>
            {t(VERDICT[entry.verdict], {
              measure: t(MEASURE_LABEL[entry.measure]),
              value: String(entry.value),
              low: String(entry.range[0]),
              high: String(entry.range[1]),
            })}
          </li>
        ))}
      </ul>
      {/* Beside the chart's answer, never instead of it: the shopper sees both
          and which one the returns favour. */}
      {advice ? (
        <p className="mt-3 text-[12px] font-bold leading-5">
          {t(tendency === "runsSmall" ? "sizeGuide.adviseUp" : "sizeGuide.adviseDown", { size: advice })}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {canChoose ? (
          <button type="button" onClick={() => onChoose(answer.size)} className="glass-navy type-control pressable rounded-full px-4 py-2">
            {t("sizeGuide.choose", { size: answer.size })}
          </button>
        ) : null}
        {advice && availableSizes.some(size => size.toLowerCase() === advice.toLowerCase()) ? (
          <button type="button" onClick={() => onChoose(advice)} className="glass type-control pressable rounded-full px-4 py-2">
            {t("sizeGuide.choose", { size: advice })}
          </button>
        ) : null}
      </div>
    </div>
  );
}

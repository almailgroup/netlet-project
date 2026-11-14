/**
 * Warranty and installation (3.1.2), on the owner's word: an installation fee
 * of its own, extended warranty plans each with a length and a price, and any
 * other extra — every one named in English and Arabic, or named for the
 * seller. One editor, drawn by the product editor and the new-product form,
 * so the two cannot ask different things.
 *
 * The rules are `addonProblems`, the server's own: each problem is said under
 * the box that is wrong, once Save or Create has been pressed, and goes with
 * the fix. A row the seller added and left blank is an abandoned edit, not an
 * extra, and is not sent.
 */
import { Plus, Trash2 } from "lucide-react";
import { useRef } from "react";
import {
  ADDON_NAME_MAX,
  MAX_ADDONS,
  WARRANTY_MONTHS,
  addonProblems,
  defaultAddonName,
  draftOf,
  warrantyLengthWords,
  type AddonDraft,
  type AddonKind,
  type AddonProblem,
} from "@shared/commerce/addons";
import type { MessageKey } from "@shared/i18n/dictionary";
import { Field, buttonClass, fieldClass } from "@/components/admin/ui";
import { Select } from "@/components/ui/Select";
import { useConfirmRemoval } from "@/components/ui/ConfirmRemoval";
import { useTranslation } from "@/hooks/useTranslation";

/** One extra as the editor holds it: the row it came from, a key for React, and the draft. */
export type EditorAddon = AddonDraft & { id: number | null; key: string };

let made = 0;
const keyOf = () => `addon-${++made}`;

/** The product's stored extras as the editor shows them (a default name blank again). */
export function editorAddons(stored: readonly { id: number; kind: string; label: string; labelAr?: string | null; price: string; warrantyMonths?: number | null }[]): EditorAddon[] {
  return stored.map(addon => ({ ...draftOf(addon), id: addon.id, key: keyOf() }));
}

const blank = (addon: AddonDraft) =>
  !addon.price.trim() && !addon.label.trim() && !addon.labelAr.trim() && (addon.kind !== "warranty" || addon.warrantyMonths === null);

/** What is sent: the rows that are not blank, with the ids they came from. */
export function addonsToSend(rows: readonly EditorAddon[]) {
  return rows.filter(row => !blank(row)).map(row => ({
    id: row.id,
    kind: row.kind,
    label: row.label.trim(),
    labelAr: row.labelAr.trim() || null,
    price: row.price.trim(),
    warrantyMonths: row.kind === "warranty" ? row.warrantyMonths : null,
  }));
}

/** Each sent row's problems, keyed by the row's key; blank rows have none. */
export function problemsOf(rows: readonly EditorAddon[]): Map<string, AddonProblem[]> {
  const sent = rows.filter(row => !blank(row));
  const found = addonProblems(sent);
  return new Map(sent.map((row, index) => [row.key, found[index]!]));
}

const GROUPS: readonly AddonKind[] = ["installation", "warranty", "other"];

const fieldId = (prefix: string, key: string, part: "price" | "length" | "en" | "ar") => `${prefix}-${key}-${part}`;

/** The box a problem is said under. */
function partFor(problem: AddonProblem, row: EditorAddon): "price" | "length" | "en" | "ar" {
  if (problem === "price") return "price";
  if (problem === "warrantyLength" || problem === "warrantyTwice") return "length";
  if (problem === "nameLong") return row.label.trim().length > ADDON_NAME_MAX ? "en" : "ar";
  return "en";
}

const MESSAGE: Record<AddonProblem, MessageKey> = {
  price: "admin.addonPriceProblem",
  name: "admin.addonNameProblem",
  warrantyLength: "admin.warrantyLengthProblem",
  warrantyTwice: "admin.warrantyTwiceProblem",
  nameLong: "admin.addonNameLongProblem",
};

/** The id of the first box with something wrong, in the order the rows are drawn, or null. */
export function firstAddonProblem(rows: readonly EditorAddon[], prefix: string): string | null {
  const problems = problemsOf(rows);
  for (const kind of GROUPS) {
    for (const row of rows.filter(entry => entry.kind === kind)) {
      const [first] = problems.get(row.key) ?? [];
      if (first) return fieldId(prefix, row.key, partFor(first, row));
    }
  }
  return null;
}

const GROUP_WORDS: Record<AddonKind, { title: MessageKey; note: MessageKey; add: MessageKey }> = {
  installation: { title: "admin.installTitle", note: "admin.installNote", add: "admin.installAdd" },
  warranty: { title: "admin.warrantyTitle", note: "admin.warrantyNote", add: "admin.warrantyAdd" },
  other: { title: "admin.otherTitle", note: "admin.otherNote", add: "admin.otherAdd" },
};

export function AddonsEditor({ rows, onChange, disabled = false, attempted, idPrefix }: {
  rows: EditorAddon[];
  onChange: (rows: EditorAddon[]) => void;
  disabled?: boolean;
  /** Save or Create has been pressed: problems are said from now on. */
  attempted: boolean;
  idPrefix: string;
}) {
  const { t, locale } = useTranslation();
  const ask = useConfirmRemoval();
  const problems = attempted ? problemsOf(rows) : new Map<string, AddonProblem[]>();
  const focusNext = useRef<string | null>(null);
  const full = rows.length >= MAX_ADDONS;

  const change = (key: string, patch: Partial<AddonDraft>) => onChange(rows.map(row => (row.key === key ? { ...row, ...patch } : row)));
  const add = (kind: AddonKind) => {
    const key = keyOf();
    focusNext.current = fieldId(idPrefix, key, kind === "warranty" ? "length" : kind === "other" ? "en" : "price");
    onChange([...rows, { id: null, key, kind, label: "", labelAr: "", price: "", warrantyMonths: null }]);
    requestAnimationFrame(() => {
      const id = focusNext.current;
      focusNext.current = null;
      if (id) document.getElementById(id)?.focus();
    });
  };
  const remove = (key: string) =>
    void ask({ title: t("remove.formTitle"), body: t("remove.formBody") }).then(sure => {
      if (sure) onChange(rows.filter(row => row.key !== key));
    });

  const said = (row: EditorAddon, part: "price" | "length" | "en" | "ar") => {
    const problem = (problems.get(row.key) ?? []).find(found => partFor(found, row) === part);
    return problem ? t(MESSAGE[problem]) : undefined;
  };

  const names = (row: EditorAddon) => {
    const fallback = defaultAddonName(row.kind, row.warrantyMonths, locale);
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("admin.addonNameEn")} optional={row.kind !== "other"} error={said(row, "en")}>
          <input
            id={fieldId(idPrefix, row.key, "en")}
            dir="auto"
            value={row.label}
            disabled={disabled}
            maxLength={ADDON_NAME_MAX}
            placeholder={row.kind === "other" ? undefined : defaultAddonName(row.kind, row.warrantyMonths, "en") ?? undefined}
            onChange={event => change(row.key, { label: event.target.value })}
            autoComplete="off"
            className={fieldClass}
          />
        </Field>
        <Field label={t("admin.addonNameAr")} optional error={said(row, "ar")}>
          <input
            id={fieldId(idPrefix, row.key, "ar")}
            dir="auto"
            lang="ar"
            value={row.labelAr}
            disabled={disabled}
            maxLength={ADDON_NAME_MAX}
            placeholder={row.kind === "other" ? undefined : defaultAddonName(row.kind, row.warrantyMonths, "ar") ?? undefined}
            onChange={event => change(row.key, { labelAr: event.target.value })}
            autoComplete="off"
            className={fieldClass}
          />
        </Field>
        {fallback && !row.label.trim() && !row.labelAr.trim() ? (
          <p className="text-[12px] leading-5 ink-muted sm:col-span-2">{t("admin.addonNamedForYou", { name: fallback })}</p>
        ) : null}
      </div>
    );
  };

  const price = (row: EditorAddon) => (
    <Field label={t("admin.addonPrice")} error={said(row, "price")}>
      <input
        id={fieldId(idPrefix, row.key, "price")}
        dir="ltr"
        inputMode="decimal"
        value={row.price}
        disabled={disabled}
        placeholder="5.000"
        onChange={event => change(row.key, { price: event.target.value })}
        autoComplete="off"
        className={fieldClass}
      />
    </Field>
  );

  const bin = (row: EditorAddon) => disabled ? null : (
    <button
      type="button"
      onClick={() => remove(row.key)}
      aria-label={t("admin.addonRemove")}
      title={t("admin.addonRemove")}
      className="mt-[26px] grid size-11 shrink-0 place-items-center rounded-lg text-[#536b8c] hover:bg-[#fdeceb] hover:text-[#8c2f22]"
    >
      <Trash2 className="size-4" aria-hidden />
    </button>
  );

  return (
    <div className="space-y-6">
      {GROUPS.map(kind => {
        const own = rows.filter(row => row.kind === kind);
        const words = GROUP_WORDS[kind];
        /* One installation fee: a second would be the same visit twice. A
           product saved with more before this editor keeps every one. */
        const mayAdd = !disabled && !full && (kind !== "installation" || own.length === 0);
        return (
          <section key={kind} aria-labelledby={`${idPrefix}-${kind}`} className="space-y-3">
            <div>
              <h3 id={`${idPrefix}-${kind}`} className="text-[15px] leading-6 font-semibold text-[#0a285a]">{t(words.title)}</h3>
              <p className="text-[13px] leading-5 ink-muted">{t(words.note)}</p>
            </div>
            {own.length ? (
              <ul className="space-y-3">
                {own.map(row => (
                  <li key={row.key} className="space-y-3 rounded-xl border border-[#e1e7ef] p-3">
                    <div className="flex items-start gap-3">
                      <div className={`grid min-w-0 flex-1 gap-3 ${kind === "warranty" ? "sm:grid-cols-2" : ""}`}>
                        {kind === "warranty" ? (
                          <Field label={t("admin.warrantyLength")} error={said(row, "length")}>
                            <Select
                              id={fieldId(idPrefix, row.key, "length")}
                              value={row.warrantyMonths === null ? "" : String(row.warrantyMonths)}
                              disabled={disabled}
                              onChange={event => change(row.key, { warrantyMonths: event.target.value ? Number(event.target.value) : null })}
                              className={fieldClass}
                            >
                              <option value="" disabled>{t("admin.warrantyLengthChoose")}</option>
                              {WARRANTY_MONTHS.map(months => (
                                <option key={months} value={String(months)}>{warrantyLengthWords(months, locale)}</option>
                              ))}
                            </Select>
                          </Field>
                        ) : null}
                        {price(row)}
                      </div>
                      {bin(row)}
                    </div>
                    {names(row)}
                  </li>
                ))}
              </ul>
            ) : null}
            {mayAdd ? (
              <button type="button" onClick={() => add(kind)} className={buttonClass.secondary}>
                <Plus className="size-4" aria-hidden />{t(words.add)}
              </button>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

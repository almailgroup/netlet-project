import { useId, useState } from "react";
import type { FormEvent } from "react";
import { CircleAlert } from "lucide-react";
import { useLanguage } from "../i18n.js";
import { useDesk } from "./Staff.js";
import { AiMark } from "../components/ShipLeeAI.js";
import type { Key } from "../../shared/i18n.js";
import type { IntakeResult } from "../../shared/assistant.js";
import { MAX_ORDER_MESSAGE } from "../../shared/assistant.js";

/**
 * "Fill from a message": the order a shop sent on WhatsApp or by email,
 * pasted, and read by ShipLee AI into the form below. Nothing is created from
 * it — the boxes fill, marked as from the message, for staff to check before
 * Create — and the message is not kept.
 */
export function FromMessage({ onRead }: { onRead: (result: IntakeResult) => void }) {
  const { t } = useLanguage();
  const { call } = useDesk();
  const id = useId();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Key | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!message.trim()) {
      setProblem("intake.empty");
      document.getElementById(`${id}-message`)?.focus();
      return;
    }
    setBusy(true);
    setProblem(null);
    const answer = await call<IntakeResult>("POST", "/api/staff/ai/intake", { message });
    setBusy(false);
    if (answer.ok) return onRead(answer.body);
    const known: Key[] = ["intake.empty", "intake.long", "intake.nothing", "ai.tooMany", "ai.off"];
    setProblem((known as string[]).includes(answer.error) ? (answer.error as Key) : "ai.failed");
  };

  return (
    <form className="card intake" onSubmit={submit} noValidate aria-labelledby={`${id}-title`}>
      <div className="ai-head">
        <span className="ai-badge"><AiMark size={22} /></span>
        <div>
          <h2 id={`${id}-title`} className="ai-title">{t("intake.title")}</h2>
          <p className="ai-sub">{t("intake.lead")}</p>
        </div>
      </div>
      <div className="field">
        <label htmlFor={`${id}-message`} className="field-label">{t("intake.label")}</label>
        <textarea
          id={`${id}-message`}
          className="input"
          rows={4}
          dir="auto"
          value={message}
          maxLength={MAX_ORDER_MESSAGE}
          onChange={event => {
            setMessage(event.target.value);
            if (problem === "intake.empty") setProblem(null);
          }}
          aria-invalid={problem ? true : undefined}
          aria-describedby={`${id}-privacy${problem ? ` ${id}-problem` : ""}`}
        />
        {problem ? (
          <p id={`${id}-problem`} className="field-error" role="alert">
            <CircleAlert size={15} aria-hidden="true" />
            {t(problem)}
          </p>
        ) : null}
        <p id={`${id}-privacy`} className="field-hint">{t("intake.privacy")}</p>
      </div>
      <div className="form-actions compact">
        <button type="submit" className="button button-secondary" disabled={busy}>
          <AiMark size={18} />
          {busy ? t("intake.reading") : t("intake.button")}
        </button>
      </div>
    </form>
  );
}

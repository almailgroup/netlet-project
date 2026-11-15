import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { ArrowUp, CircleAlert, RotateCcw } from "lucide-react";
import { useLanguage } from "../i18n.js";
import { api } from "../api.js";
import type { Config } from "../api.js";
import { ContactActions } from "./ContactActions.js";
import type { Key } from "../../shared/i18n.js";
import type { Status } from "../../shared/status.js";
import { MAX_HISTORY, MAX_QUESTION, questionProblem } from "../../shared/assistant.js";
import type { AssistantTurn } from "../../shared/assistant.js";

/** ShipLee AI's mark: a speech bubble with ShipLee's parcel inside it. */
export function AiMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
      <path d="M5 3.5h14A2.5 2.5 0 0 1 21.5 6v8.5A2.5 2.5 0 0 1 19 17h-6.5L8 20.5V17H5a2.5 2.5 0 0 1-2.5-2.5V6A2.5 2.5 0 0 1 5 3.5Z" />
      <path d="m12 6.6 3.4 1.8v3.8L12 14l-3.4-1.8V8.4Z" />
      <path d="M8.7 8.5 12 10.2l3.3-1.7M12 10.2v3.7" />
    </svg>
  );
}

type Turn = AssistantTurn & { contact?: boolean };
type Reply = { answer: string; contact: boolean; suggestions: string[] };

/** The questions offered before anything is asked, fitted to where the parcel is. */
function firstQuestions(status: Status | undefined, cod: boolean): Key[] {
  if (!status) return ["ai.q.where", "faq.attempted.q", "faq.cod.q"];
  switch (status) {
    case "delivered":
      return ["ai.q.notReceived", "ai.q.status"];
    case "returned":
      return ["ai.q.returned", "faq.change.q"];
    case "cancelled":
      return ["ai.q.status"];
    case "attempted":
      return ["ai.q.missed", "ai.q.change", ...(cod ? (["ai.q.pay"] as Key[]) : [])];
    case "on_hold":
      return ["ai.q.hold", "ai.q.when"];
    default:
      return ["ai.q.when", cod ? "ai.q.pay" : "ai.q.status", "ai.q.change"];
  }
}

const BOX_PROBLEMS = new Set(["ai.empty", "ai.long", "ai.contact"]);

/**
 * ShipLee AI, the customer's assistant: questions about a parcel, answered
 * from its own updates, or about delivery in general on the Help page. The
 * answer is a model's, and says so under the box; when it needs a person, the
 * page draws the ways to reach ShipLee itself — the model never writes a
 * number. A question carrying contact details is said back under the box and
 * never sent.
 */
export function ShipLeeAI({ number, status, cod = false, contact, headingLevel = 2 }: {
  number?: string;
  status?: Status;
  cod?: boolean;
  contact: Config["contact"];
  headingLevel?: 2 | 3;
}) {
  const { t, lang } = useLanguage();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Key | null>(null);
  const [failed, setFailed] = useState<{ key: Key; question: string } | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const id = number ? `ai-${number}` : "ai-help";

  /* A new parcel, or the language changed under it: the conversation starts again. */
  useEffect(() => {
    setTurns([]);
    setSuggestions([]);
    setFailed(null);
    setProblem(null);
  }, [number, lang]);

  /* A follow-up the customer has already asked is not offered again. */
  const asked = new Set(turns.filter(turn => turn.role === "customer").map(turn => turn.text.trim().toLowerCase()));
  const offered = (turns.length ? suggestions : firstQuestions(status, cod).map(key => t(key))).filter(question => !asked.has(question.trim().toLowerCase()));

  const ask = async (question: string, history: Turn[]) => {
    setBusy(true);
    setFailed(null);
    setSuggestions([]);
    const answer = await api<Reply>("POST", "/api/ai/ask", {
      question,
      number: number ?? null,
      lang,
      history: history.slice(-MAX_HISTORY).map(({ role, text: said }) => ({ role, text: said })),
    });
    setBusy(false);
    if (answer.ok) {
      setTurns(current => [...current, { role: "shiplee", text: answer.body.answer, contact: answer.body.contact }]);
      setSuggestions(answer.body.suggestions);
      return;
    }
    if (BOX_PROBLEMS.has(answer.error)) {
      /* Said under the box, with the question back in it to fix. */
      setTurns(current => current.slice(0, -1));
      setText(question);
      setProblem(answer.error as Key);
      box.current?.focus();
      return;
    }
    setFailed({ key: answer.error === "ai.tooMany" || answer.error === "ai.off" ? answer.error : "ai.failed", question });
  };

  const send = (question: string) => {
    const said = question.trim();
    const wrong = questionProblem(said);
    if (wrong) {
      setProblem(wrong);
      box.current?.focus();
      return;
    }
    if (busy) return;
    setProblem(null);
    setText("");
    const history = turns;
    setTurns([...history, { role: "customer", text: said }]);
    void ask(said, history);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    send(text);
  };
  const keys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    /* Enter sends; Shift+Enter is a new line; a composing keyboard (Arabic, Japanese) keeps its Enter. */
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send(text);
    }
  };

  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <section className="card ai-card" aria-labelledby={`${id}-title`}>
      <div className="ai-head">
        <span className="ai-badge"><AiMark size={22} /></span>
        <div>
          <Heading id={`${id}-title`} className="ai-title">{t("ai.title")}</Heading>
          <p className="ai-sub">{t(number ? "ai.subParcel" : "ai.subHelp")}</p>
        </div>
      </div>

      {turns.length ? (
        <ol className="ai-log" aria-live="polite" aria-label={t("ai.title")}>
          {turns.map((turn, index) => (
            <li key={index} className={`ai-turn ${turn.role === "customer" ? "from-customer" : "from-shiplee"}`}>
              <span className="ai-who">
                {turn.role === "shiplee" ? <AiMark size={14} /> : null}
                {turn.role === "customer" ? t("ai.you") : t("ai.name")}
              </span>
              <p className="ai-text" dir="auto">{turn.text}</p>
              {turn.role === "shiplee" && turn.contact ? (
                <div className="ai-contact">
                  <p>{t("ai.contactLead")}</p>
                  <ContactActions contact={contact} number={number} compact />
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}

      {busy ? (
        <p className="ai-writing" role="status">
          <span className="ai-dots" aria-hidden="true"><span /><span /><span /></span>
          {t("ai.writing")}
        </p>
      ) : null}

      {failed ? (
        <div className="notice notice-stopped ai-failed" role="alert">
          <CircleAlert size={18} aria-hidden="true" />
          <span>{t(failed.key)}</span>
          {failed.key === "ai.failed" ? (
            <button type="button" className="button button-quiet button-small" onClick={() => void ask(failed.question, turns.slice(0, -1))}>{t("ai.tryAgain")}</button>
          ) : null}
        </div>
      ) : null}

      {!busy && offered.length ? (
        <div className="ai-chips" role="group" aria-label={t("ai.suggestions")}>
          {offered.map(question => (
            <button key={question} type="button" className="chip" onClick={() => send(question)} dir="auto">{question}</button>
          ))}
        </div>
      ) : null}

      <form className="ai-form" onSubmit={submit} noValidate>
        <label htmlFor={`${id}-box`} className="sr-only">{t("ai.label")}</label>
        <div className={`ai-box${problem ? " invalid" : ""}`}>
          <textarea
            ref={box}
            id={`${id}-box`}
            className="ai-input"
            rows={1}
            dir="auto"
            value={text}
            maxLength={MAX_QUESTION}
            placeholder={t("ai.placeholder")}
            onChange={event => {
              setText(event.target.value);
              if (problem && !questionProblem(event.target.value)) setProblem(null);
            }}
            onKeyDown={keys}
            aria-invalid={problem ? true : undefined}
            aria-describedby={`${id}-note${problem ? ` ${id}-problem` : ""}`}
          />
          <button type="submit" className="ai-send" disabled={busy} aria-label={t("ai.send")}>
            <ArrowUp size={18} aria-hidden="true" />
          </button>
        </div>
        {problem ? (
          <p id={`${id}-problem`} className="field-error">
            <CircleAlert size={15} aria-hidden="true" />
            {t(problem)}
          </p>
        ) : null}
      </form>
      <div className="ai-foot">
        <p id={`${id}-note`} className="ai-note">{t("ai.note")}</p>
        {turns.length && !busy ? (
          <button type="button" className="button button-quiet button-small" onClick={() => { setTurns([]); setSuggestions([]); setFailed(null); box.current?.focus(); }}>
            <RotateCcw size={14} aria-hidden="true" />
            {t("ai.clear")}
          </button>
        ) : null}
      </div>
    </section>
  );
}

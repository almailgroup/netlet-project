/**
 * The questions a conversation offers to ask next, as one row of presses
 * directly above its box — the product assistant's and the shop chat's alike.
 * What goes in it is `nextQuestions`: the starters fitted to the page before
 * anything is asked, then each answer's own follow-ups, or the starters not yet
 * asked when it offered none.
 *
 * **It sits outside the scrolling log, never at its foot.** The follow-ups
 * were drawn under the latest answer inside the log, and appeared only once
 * the answer was whole — after the log had already scrolled to the words — so
 * they landed below what the log showed, cut off at its edge or wholly out of
 * sight. A row of its own between the log and the box is always whole on
 * screen, wraps rather than scrolling sideways, and is where the thumb already
 * is.
 */
export function ChatSuggestions({ questions, label, onAsk, rise = false, className = "" }: {
  questions: readonly string[];
  /** What the row is, for a screen reader: suggestions, or questions to ask next. */
  label: string;
  onAsk: (question: string) => void;
  /** Rises into place, as an arriving message does; never on the page's first draw. */
  rise?: boolean;
  className?: string;
}) {
  if (!questions.length) return null;
  return (
    <ul aria-label={label} className={`flex flex-wrap gap-2 ${className}`}>
      {questions.map(question => (
        <li key={question} className="min-w-0 max-w-full">
          <button
            type="button"
            onClick={() => onAsk(question)}
            className={`inline-flex min-h-11 max-w-full items-center rounded-full bg-white px-3.5 py-1.5 text-start text-[13px] leading-5 font-semibold text-[#0a285a] shadow-[0_1px_2px_rgba(10,40,90,.06)] ring-1 ring-[#0a285a]/15 hover:bg-[#f0f2f5] pointer-fine:min-h-9 ${rise ? "chat-rise" : ""}`}
          >
            <bdi dir="auto" className="min-w-0">{question}</bdi>
          </button>
        </li>
      ))}
    </ul>
  );
}

import { useLanguage } from "../i18n.js";
import type { TrackingEvent } from "../../shared/shipment.js";
import { dayBefore, dayOf, formatDate, formatTime } from "../../shared/format.js";
import { kuwaitDay } from "../../shared/kuwait.js";
import { toneOf } from "../../shared/status.js";

/**
 * A parcel's updates, newest first, under a heading for each Kuwaiti day —
 * "Today", "Yesterday", then the date — and each with its time, what
 * happened, where, and the note staff wrote for the customer.
 */
export function Timeline({ events, headingLevel = 2 }: { events: TrackingEvent[]; headingLevel?: 2 | 3 }) {
  const { t, lang } = useLanguage();
  const today = kuwaitDay();
  const days: { day: string; events: TrackingEvent[] }[] = [];
  for (const event of events) {
    const day = dayOf(event.happenedAt);
    const last = days.at(-1);
    if (last && last.day === day) last.events.push(event);
    else days.push({ day, events: [event] });
  }
  const dayName = (day: string, sample: string) =>
    day === today ? t("result.today") : day === dayBefore(today) ? t("result.yesterday") : formatDate(sample, lang);
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const DayHeading = headingLevel === 2 ? "h3" : "h4";
  return (
    <section className="updates" aria-labelledby="updates-title">
      <Heading id="updates-title">{t("result.updates")}</Heading>
      {days.map(({ day, events: dayEvents }, dayIndex) => (
        <div className="day" key={day}>
          <DayHeading>{dayName(day, dayEvents[0]!.happenedAt)}</DayHeading>
          <ol className="events">
            {dayEvents.map((event, index) => (
              <li key={`${event.happenedAt}-${index}`} className={`event${dayIndex === 0 && index === 0 ? ` latest tone-${toneOf(event.status)}` : ""}`}>
                <time dateTime={event.happenedAt}>{formatTime(event.happenedAt, lang)}</time>
                <span className="rail" aria-hidden="true" />
                <div>
                  <p className="event-status">{t(`status.${event.status}`)}</p>
                  {event.location ? <p className="event-where" dir="auto">{event.location}</p> : null}
                  {event.note ? <p className="event-note" dir="auto">{event.note}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </section>
  );
}

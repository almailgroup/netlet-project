import type { ReactNode } from "react";

/** Nothing to show yet, said as what to do next: an icon, a heading, a line and the way on. */
export function EmptyState({ icon, title, body, actions, headingLevel = 2 }: { icon: ReactNode; title: string; body?: string; actions?: ReactNode; headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className="empty">
      <span className="icon-tile" aria-hidden="true">{icon}</span>
      <Heading>{title}</Heading>
      {body ? <p>{body}</p> : null}
      {actions ? <div className="button-row">{actions}</div> : null}
    </div>
  );
}

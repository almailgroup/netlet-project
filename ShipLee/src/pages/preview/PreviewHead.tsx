import type { ReactNode } from "react";
import { PreviewTag } from "../../preview.js";
import { useNoIndex } from "../../hooks.js";

/**
 * The head of a preview page: its name, the Preview mark beside it, and a lead
 * that says what is a sample. A preview page is never indexed, since it is
 * not what ShipLee offers yet.
 */
export function PreviewHead({ title, lead, children }: { title: string; lead: string; children?: ReactNode }) {
  useNoIndex();
  return (
    <div className="page-head narrow-head">
      <div className="preview-head">
        <h1 className="page-title">{title}</h1>
        <PreviewTag />
      </div>
      <p className="page-lead">{lead}</p>
      {children}
    </div>
  );
}

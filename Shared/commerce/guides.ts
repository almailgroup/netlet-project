/**
 * Illustrated guides (3.5.3): how to do one thing on NetLet, in a few steps,
 * each with a picture, in both languages.
 *
 * The requirement asks for AI-generated tutorial *videos*; a video model
 * costs dollars a clip, so the owner chose guides — a model drafts the steps
 * and draws a picture for each, and a person at NetLet reads, edits and
 * publishes. Nothing a model writes reaches a shopper until somebody presses
 * Publish, which is the rule every other model output here follows.
 *
 * Pure, so the editor's Publish button and the server refuse the same guide.
 */
import { contactFindings } from "./contactFilter.js";

export const GUIDE_AUDIENCES = ["shopper", "seller"] as const;
export type GuideAudience = (typeof GUIDE_AUDIENCES)[number];

export const GUIDE_STATUSES = ["draft", "published"] as const;
export type GuideStatus = (typeof GUIDE_STATUSES)[number];

export type GuideStep = {
  title: string;
  titleAr: string;
  body: string;
  bodyAr: string;
  /** An uploaded `/media/…` photo, or null while the step has none. */
  imageUrl: string | null;
};

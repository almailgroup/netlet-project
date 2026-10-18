/**
 * NetLet's own email — what lands in a shopper's or a seller's inbox, sent
 * through Resend (resend.com), the provider the owner chose.
 *
 * Supabase Auth still sends the account mail (the sign-up code, the reset
 * link); this is everything else. Unset, nothing is sent and nothing is
 * queued: the notices are still written to the inbox on the site, and the
 * day `RESEND_API_KEY` and `NOTIFY_EMAIL_FROM` are both set, new notices go
 * out by email too — the rule every value in `.env.example` follows.
 *
 * One call, `sendEmail`, with a deadline, never throwing: an email that did
 * not go is a delivery row left pending for the next sweep, never a failed
 * order. `transport` is the seam the tests replace.
 */
import { ENV } from "./env.js";

export type Email = { to: string; subject: string; html: string; text: string };
export type Sent = { ok: true } | { ok: false; error: string };

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const EMAIL_DEADLINE_MS = 4000;

/** Whether NetLet can send email at all. */
export function emailConfigured(): boolean {
  return Boolean(ENV.resendApiKey.trim() && ENV.notifyEmailFrom.trim());
}

type Transport = (url: string, init: RequestInit) => Promise<Response>;
let transport: Transport = (url, init) => fetch(url, init);

/** For tests only: answer every send from a stand-in. */
export function setEmailTransport(next: Transport | null): void {
  transport = next ?? ((url, init) => fetch(url, init));
}

export async function sendEmail(email: Email): Promise<Sent> {
  if (!emailConfigured()) return { ok: false, error: "email not configured" };
  try {
    const response = await transport(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${ENV.resendApiKey.trim()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: ENV.notifyEmailFrom.trim(), to: [email.to], subject: email.subject, html: email.html, text: email.text }),
      signal: AbortSignal.timeout(EMAIL_DEADLINE_MS),
    });
    if (response.ok) return { ok: true };
    /* The status and the provider's own short reason, kept on the row for
       whoever reads why it failed — never shown to a shopper. */
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    return { ok: false, error: `${response.status} ${detail}`.trim() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message.slice(0, 300) : "send failed" };
  }
}

/** The site's own address, for the links in an email; empty when nothing says what it is. */
export function siteOrigin(): string {
  const configured = ENV.siteUrl.trim().replace(/\/+$/, "");
  if (/^https?:\/\//.test(configured)) return configured;
  const vercel = (process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "").trim();
  return vercel ? `https://${vercel.replace(/^https?:\/\//, "").replace(/\/+$/, "")}` : "";
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/**
 * One notice as an email: the sentence, a button to where it points, and a
 * line saying how to stop them.
 *
 * Plain on purpose — a table of one column, the shop's navy, no images — so
 * it reads in every mail client and on a phone, and the Arabic one is laid
 * out right to left. The words are the inbox's own, so an email and the
 * notice it came from never say different things.
 */
export function noticeEmail(input: {
  to: string;
  arabic: boolean;
  subject: string;
  sentence: string;
  action: string;
  link: string | null;
  footer: string;
  preferencesLink: string | null;
}): Email {
  const dir = input.arabic ? "rtl" : "ltr";
  const align = input.arabic ? "right" : "left";
  const button = input.link
    ? `<p style="margin:24px 0 0"><a href="${escapeHtml(input.link)}" style="display:inline-block;background:#0a285a;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px">${escapeHtml(input.action)}</a></p>`
    : "";
  const footer = input.preferencesLink
    ? `${escapeHtml(input.footer)} <a href="${escapeHtml(input.preferencesLink)}" style="color:#536b8c">${escapeHtml(input.preferencesLink)}</a>`
    : escapeHtml(input.footer);
  const html = `<!doctype html><html lang="${input.arabic ? "ar" : "en"}" dir="${dir}"><body style="margin:0;background:#f3f2ed;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f2ed"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;text-align:${align}" dir="${dir}">
<tr><td style="padding:28px 28px 8px;color:#0a285a;font-size:20px;font-weight:800">NetLet</td></tr>
<tr><td style="padding:8px 28px 28px;color:#1f2a44;font-size:16px;line-height:1.6">${escapeHtml(input.sentence)}${button}</td></tr>
<tr><td style="padding:16px 28px 24px;border-top:1px solid #e6e9ef;color:#536b8c;font-size:12px;line-height:1.6">${footer}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [input.sentence, input.link ? `${input.action}: ${input.link}` : "", "", input.preferencesLink ? `${input.footer} ${input.preferencesLink}` : input.footer]
    .filter((line, index) => line || index > 1)
    .join("\n");
  return { to: input.to, subject: input.subject, html, text };
}

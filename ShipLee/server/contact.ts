/**
 * ShipLee's public contact details, from the deployment's environment, so a
 * number can be added or changed in Vercel without a code change. Each is
 * checked; one that is not what it claims draws nothing rather than a link
 * that rings nobody.
 */
export type Contact = { phone: string | null; whatsapp: string | null; email: string | null };

export function contactFromEnv(env: Record<string, string | undefined>): Contact {
  const phone = (env.SHIPLEE_PHONE ?? "").replace(/[\s\-()]/g, "");
  const whatsapp = (env.SHIPLEE_WHATSAPP ?? "").replace(/[\s\-()+]/g, "");
  const email = (env.SHIPLEE_EMAIL ?? "").trim();
  return {
    phone: /^\+?\d{8,15}$/.test(phone) ? phone : null,
    /* WhatsApp's links take the number with its country code and nothing else. */
    whatsapp: /^\d{10,15}$/.test(whatsapp) ? whatsapp : null,
    email: /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(email) ? email : null,
  };
}

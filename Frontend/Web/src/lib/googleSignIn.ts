/**
 * Sign in with Google on the website, through a popup onto Google's own page.
 *
 * Google is asked for an identity token straight back (`response_type=id_token`)
 * at `/google-return.html`, which hands it to this page on a BroadcastChannel
 * and closes (`public/google-return.js`). The token goes to NetLet's
 * `auth.googleSignIn`, which has Supabase check it; nothing is kept here.
 * Nothing of Google's runs in this page — no script, no frame — so the button
 * is the shop's own, drawn to Google's branding rules.
 *
 * **A nonce makes the token this sign-in's alone**, as Apple's does: made
 * here, handed to Google hashed and to the server raw. A `state` ties the
 * answer to this press.
 *
 * **The popup opens inside the press**, since a browser lets a page open a
 * window only then, so the nonce and its hash are made before the button can
 * be pressed (`prepareGoogle`).
 */

export type GoogleProof = { idToken: string; nonce: string };

export type GooglePrepared = { nonce: string; hashed: string; state: string };

const CHANNEL = "netlet-google";
/** How long a popup may stay open before the press is given up. */
const GIVE_UP_MS = 10 * 60_000;

function randomText(bytes = 24): string {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(values, value => value.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
}

export async function prepareGoogle(): Promise<GooglePrepared> {
  const nonce = randomText();
  return { nonce, hashed: await sha256Hex(nonce), state: randomText(12) };
}

/** Google's consent page for this press, in the page's language. */
export function googleAddress(clientId: string, prepared: GooglePrepared, returnTo: string, locale: "en" | "ar"): string {
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: returnTo,
    response_type: "id_token",
    scope: "openid email profile",
    nonce: prepared.hashed,
    state: prepared.state,
    prompt: "select_account",
    hl: locale,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${query.toString()}`;
}

/**
 * Opens Google's page and answers what it handed back, or null when the
 * person closed it. Call inside the press: the window is opened before
 * anything is awaited. Throws when the browser would not open it.
 */
export function askGoogle(address: string, prepared: GooglePrepared): Promise<GoogleProof | null> {
  const width = 480;
  const height = 640;
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));
  const popup = window.open(address, "netlet-google", `popup,width=${width},height=${height},left=${left},top=${top}`);
  if (!popup) return Promise.reject(new Error("blocked"));

  return new Promise<GoogleProof | null>((resolve, reject) => {
    let channel: BroadcastChannel | null = null;
    let settled = false;
    let closedSince = 0;

    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      window.clearInterval(watch);
      window.clearTimeout(giveUp);
      window.removeEventListener("message", onWindowMessage);
      channel?.close();
      outcome();
    };

    const take = (data: unknown) => {
      const answer = data as { type?: string; idToken?: string | null; state?: string | null; error?: string | null } | null;
      if (!answer || answer.type !== "netlet-google" || answer.state !== prepared.state) return;
      if (answer.idToken) finish(() => resolve({ idToken: answer.idToken!, nonce: prepared.nonce }));
      else if (answer.error === "access_denied" || answer.error === "user_cancelled") finish(() => resolve(null));
      else finish(() => reject(new Error(answer.error ?? "no token")));
    };

    const onWindowMessage = (event: MessageEvent) => {
      if (event.origin === window.location.origin) take(event.data);
    };
    window.addEventListener("message", onWindowMessage);
    try {
      channel = new BroadcastChannel(CHANNEL);
      channel.onmessage = event => take(event.data);
    } catch {
      channel = null;
    }

    /* Closed with no answer is the person changing their mind. A moment's
       grace, because the answer is posted just before the popup closes. */
    const watch = window.setInterval(() => {
      let closed = false;
      try {
        closed = popup.closed;
      } catch {
        closed = false;
      }
      if (!closed) {
        closedSince = 0;
        return;
      }
      if (!closedSince) closedSince = Date.now();
      else if (Date.now() - closedSince > 900) finish(() => resolve(null));
    }, 300);
    const giveUp = window.setTimeout(() => finish(() => resolve(null)), GIVE_UP_MS);
  });
}

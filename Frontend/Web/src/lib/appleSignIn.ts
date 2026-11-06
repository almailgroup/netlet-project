/**
 * Sign in with Apple on the website, through Apple's own script.
 *
 * Apple's window does the asking; what comes back is an identity token, the
 * one-time code and — the first time an Apple ID meets NetLet, and never again
 * — the person's name, which the server writes onto the new account. The
 * token is sent to NetLet's `auth.appleSignIn`, which has Supabase check it; no
 * token is kept here.
 *
 * **A nonce makes the token this sign-in's alone**: a random string made here,
 * handed to Apple hashed and to the server raw, so a token lifted from some
 * other sign-in carries a hash nothing here made.
 *
 * **Apple's window opens only inside the press**, since a browser lets a page
 * open a window only then, so the script, the nonce and its hash are all
 * ready before the button can be pressed (`prepareApple`), and the press does
 * nothing but `init` and `signIn`.
 */

export type AppleProof = {
  idToken: string;
  nonce: string;
  code?: string;
  firstName?: string;
  lastName?: string;
};

type AppleAnswer = {
  authorization?: { id_token?: string; code?: string; state?: string };
  user?: { name?: { firstName?: string; lastName?: string }; email?: string };
};

type AppleAuth = {
  init(config: {
    clientId: string;
    scope: string;
    redirectURI: string;
    state?: string;
    nonce?: string;
    usePopup?: boolean;
  }): void;
  signIn(): Promise<AppleAnswer>;
};

declare global {
  interface Window {
    AppleID?: { auth: AppleAuth };
  }
}

/** Apple's script in the page's language: its window is drawn in it. */
function scriptFor(locale: "en" | "ar"): string {
  return `https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/${locale === "ar" ? "ar_SA" : "en_US"}/appleid.auth.js`;
}

let loading: Promise<AppleAuth> | null = null;

/** Loads Apple's script once per page; a failed load can be tried again. */
function loadApple(locale: "en" | "ar"): Promise<AppleAuth> {
  if (window.AppleID?.auth) return Promise.resolve(window.AppleID.auth);
  if (loading) return loading;
  loading = new Promise<AppleAuth>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = scriptFor(locale);
    script.async = true;
    script.onload = () => (window.AppleID?.auth ? resolve(window.AppleID.auth) : reject(new Error("Apple's script did not load")));
    script.onerror = () => reject(new Error("Apple's script did not load"));
    document.head.appendChild(script);
  }).catch(error => {
    loading = null;
    throw error;
  });
  return loading;
}

function randomText(bytes = 24): string {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(values, value => value.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
}

/** Everything a press needs, made before it. */
export type ApplePrepared = { auth: AppleAuth; nonce: string; hashed: string; state: string };

export async function prepareApple(locale: "en" | "ar"): Promise<ApplePrepared> {
  const auth = await loadApple(locale);
  const nonce = randomText();
  return { auth, nonce, hashed: await sha256Hex(nonce), state: randomText(12) };
}

/**
 * Opens Apple's window and answers what it handed back, or null when the
 * person closed it. Call inside the press, with what `prepareApple` made.
 */
export async function askApple(clientId: string, prepared: ApplePrepared, returnTo: string): Promise<AppleProof | null> {
  prepared.auth.init({
    clientId,
    scope: "name email",
    redirectURI: returnTo,
    state: prepared.state,
    nonce: prepared.hashed,
    usePopup: true,
  });
  let answer: AppleAnswer;
  try {
    answer = await prepared.auth.signIn();
  } catch (error) {
    const reason = (error as { error?: string } | null)?.error ?? "";
    if (/popup_closed_by_user|user_cancelled_authorize|user_trigger_new_signin_flow/.test(reason)) return null;
    throw error;
  }
  const idToken = answer.authorization?.id_token;
  if (!idToken || answer.authorization?.state !== prepared.state) throw new Error("Apple's answer was not this sign-in's");
  const name = answer.user?.name;
  return {
    idToken,
    nonce: prepared.nonce,
    code: answer.authorization?.code,
    firstName: name?.firstName?.trim() || undefined,
    lastName: name?.lastName?.trim() || undefined,
  };
}

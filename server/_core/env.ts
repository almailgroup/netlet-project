/**
 * Runtime configuration. Every value is optional at boot — the server starts on
 * an empty environment — so each unset entry disables a feature rather than
 * preventing startup. See .env.example for what each one switches off.
 */
export const ENV = {
  /** Signs session cookies. Required before any sign-in can succeed. */
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  /** Address granted the admin role when it registers. */
  ownerEmail: process.env.OWNER_EMAIL ?? "",
  isProduction: process.env.NODE_ENV === "production",
  /**
   * Where product imagery is served from, for the image CSP.
   *
   * Set it to the Cloudflare R2 / CDN host once uploads exist and the policy
   * narrows to that origin. Unset, any https image is allowed, because
   * vendors paste image URLs by hand and a policy that blocks them shows up
   * as products with no pictures and nothing in the log.
   */
  mediaHost: process.env.MEDIA_HOST ?? "",
  mistralApiKey: process.env.MISTRAL_API_KEY ?? "",
  /* What the scheduler presents to run standing orders (3.1.19). Vercel Cron
     sends it as a bearer token. Unset, the endpoint answers 404 and no
     standing order runs on its own — an administrator can still run them
     from /admin/subscriptions. */
  cronSecret: process.env.CRON_SECRET ?? "",
  /* Supabase Auth, where registered accounts live.
     All three must be set before it is used at all. The anon key is a public
     identifier and is only here rather than under a VITE_ name because the
     password check runs on the server; the service-role key is a full-power
     secret that bypasses row-level security and must never reach the client.
     They are kept as two values rather than one because they go to different
     endpoints — see server/_core/supabaseAuth.ts. */
  supabaseUrl: process.env.SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  /* Who issues NetLet's invoices (3.6.6). Unset, invoices are still issued and
     say plainly that the registration is not recorded — an invoice with a
     blank is better than none. Read when an invoice is issued and frozen into
     it, so changing these later does not rewrite what was already issued. */
  invoiceIssuerName: process.env.INVOICE_ISSUER_NAME ?? "",
  invoiceIssuerNameAr: process.env.INVOICE_ISSUER_NAME_AR ?? "",
  invoiceIssuerLicence: process.env.INVOICE_ISSUER_LICENCE ?? "",
  invoiceIssuerAddress: process.env.INVOICE_ISSUER_ADDRESS ?? "",
  /* NetLet's own WhatsApp and phone for support (3.5.1). Public numbers, and
     unset is no channel: the Help section draws only what is configured. */
  supportWhatsapp: process.env.SUPPORT_WHATSAPP ?? "",
  supportPhone: process.env.SUPPORT_PHONE ?? "",
  /* NetLet's own account, the one payouts leave (3.3.21). Only the ISO 20022
     bank file needs it — the CSV names only the people being paid — so unset
     is that one format unavailable, said on the page. The name falls back to
     the invoice issuer's, which is the same company. */
  payoutFromName: process.env.PAYOUT_FROM_NAME || process.env.INVOICE_ISSUER_NAME || "",
  payoutFromIban: process.env.PAYOUT_FROM_IBAN ?? "",
  payoutFromBic: process.env.PAYOUT_FROM_BIC ?? "",
  /* Google reCAPTCHA v2, the "I'm not a robot" box on Create account. Both
     from google.com/recaptcha/admin. The site key is public — the browser
     needs it to draw the box; the secret is how the server asks Google whether
     the box was really ticked. Unset, the box is not drawn and registration
     does not ask for it — see server/_core/captcha.ts. */
  recaptchaSiteKey: process.env.RECAPTCHA_SITE_KEY ?? "",
  recaptchaSecretKey: process.env.RECAPTCHA_SECRET_KEY ?? "",
  /* The map behind "Drop a pin" (3.2.7). Google's is a browser key — public by
     design, and locked to NetLet's own addresses in the Google Cloud console.
     Apple's is either a ready-made MapKit JS token from the Apple Developer
     site, or the three values the server signs short-lived tokens with; the
     private key never reaches a browser. With neither set the picker falls
     back to OpenStreetMap — see server/_core/maps.ts. */
  googleMapsKey: process.env.GOOGLE_MAPS_API_KEY ?? "",
  appleMapkitToken: process.env.APPLE_MAPKIT_TOKEN ?? "",
  appleMapkitTeamId: process.env.APPLE_MAPKIT_TEAM_ID ?? "",
  appleMapkitKeyId: process.env.APPLE_MAPKIT_KEY_ID ?? "",
  appleMapkitPrivateKey: (process.env.APPLE_MAPKIT_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
};

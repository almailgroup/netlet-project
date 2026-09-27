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
  /* Firebase Authentication — legacy, for accounts made before the move to
     Supabase Auth. Still read so those accounts can still sign in: a Firebase
     password hash cannot be carried across, so the rows stay where they are
     until their owner resets a password. The first three come from a
     service-account key and are secret; the API key is the project's public
     Web key. All four must be set before Firebase is used at all. */
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID ?? "",
  firebaseClientEmail: process.env.FIREBASE_CLIENT_EMAIL ?? "",
  firebasePrivateKey: process.env.FIREBASE_PRIVATE_KEY ?? "",
  firebaseApiKey: process.env.FIREBASE_API_KEY ?? "",
};

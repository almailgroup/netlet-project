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
  /* Firebase Authentication. The first three come from a service-account key
     and are secret; the API key is the project's public Web key, and is only
     here because the password check runs on the server rather than in the
     browser. All four must be set before Firebase is used at all. */
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID ?? "",
  firebaseClientEmail: process.env.FIREBASE_CLIENT_EMAIL ?? "",
  firebasePrivateKey: process.env.FIREBASE_PRIVATE_KEY ?? "",
  firebaseApiKey: process.env.FIREBASE_API_KEY ?? "",
};

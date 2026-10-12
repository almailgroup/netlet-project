/**
 * Proves the Vercel function actually boots, the only way that means anything.
 *
 * CLAUDE.md has demanded this check for a while and it has only ever been run
 * by hand: build, then serve `api/app.generated.js` from a directory with **no
 * `node_modules`**, and hit `/healthz` and a tRPC route. Everything short of
 * that — `pnpm check`, `pnpm test`, `pnpm build` — agrees with itself rather
 * than with Vercel, because vitest, tsx, Vite and esbuild each resolve things
 * plain Node does not.
 *
 * The temp directory is deliberately outside the repository. Node resolves
 * `node_modules` by walking *up* the tree, so a scratch folder inside the
 * project would quietly find the repo's own dependencies and the test would
 * pass on a bundle that is missing half of itself.
 *
 * Three failures this catches, all of which shipped green once:
 *   - a tsconfig path alias (`@shared/x`) left unresolved in the output;
 *   - an extensionless relative import, which is not a valid ESM specifier;
 *   - a CommonJS package reaching for `require` inside an ESM file, which
 *     fails on the first *request* rather than at load — so "it boots" is not
 *     evidence on its own, and this asks for a real response.
 *
 * Run: `node scripts/smoke-function.mjs` (after `pnpm vercel-build`).
 */
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundle = path.join(root, "api", "app.generated.js");
const PORT = 41_887;
const BASE = `http://127.0.0.1:${PORT}`;

if (!existsSync(bundle)) {
  console.error("smoke: api/app.generated.js is missing — run `pnpm vercel-build` first.");
  process.exit(1);
}

// Outside the repo, so Node cannot walk up into its node_modules.
const dir = mkdtempSync(path.join(tmpdir(), "netlet-smoke-"));
copyFileSync(bundle, path.join(dir, "app.generated.js"));

/*
 * The bundle exports an Express app, not a listener — Vercel does the
 * listening. This is the smallest possible stand-in, and uses nothing but the
 * bundle itself, so anything it needs has to already be inside.
 */
writeFileSync(
  path.join(dir, "serve.mjs"),
  [
    `import app from "./app.generated.js";`,
    `app.listen(${PORT}, "127.0.0.1", () => console.log("listening"));`,
  ].join("\n"),
);

const server = spawn(process.execPath, ["serve.mjs"], {
  cwd: dir,
  // A blank environment on purpose: nothing may throw at boot for want of a
  // configured value, which is the contract .env.example documents.
  env: { PATH: process.env.PATH ?? "", NODE_ENV: "production" },
  stdio: ["ignore", "pipe", "pipe"],
});

let log = "";
server.stdout.on("data", chunk => { log += chunk; });
server.stderr.on("data", chunk => { log += chunk; });

function stop(code) {
  server.kill("SIGKILL");
  rmSync(dir, { recursive: true, force: true });
  process.exit(code);
}

server.on("exit", code => {
  if (code !== null && code !== 0) {
    console.error(`smoke: the function exited before serving anything (code ${code}).`);
    console.error(log.trim() || "(no output)");
    stop(1);
  }
});

/** Poll until it answers, rather than sleeping a guessed interval. */
async function waitForBoot(deadlineMs = 20_000) {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    try {
      const response = await fetch(`${BASE}/healthz`);
      if (response.ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`never answered /healthz within ${deadlineMs}ms`);
}

const checks = [];
function record(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
}

try {
  await waitForBoot();

  const health = await fetch(`${BASE}/healthz`).then(r => r.json());
  record("/healthz answers", health?.status === "ok", JSON.stringify(health));

  /*
   * A tRPC route is the check that matters. `/healthz` is answered before the
   * router is ever touched, so a bundle whose router cannot load still passes
   * it — which is exactly how "it boots" turned out not to be evidence.
   */
  const catalog = await fetch(`${BASE}/api/trpc/commerce.products.list`);
  const body = await catalog.json();
  record(
    "a tRPC route resolves",
    catalog.ok && Array.isArray(body?.result?.data?.json),
    `HTTP ${catalog.status}`,
  );

  /* The path normalisation Vercel's rewrite depends on. */
  const rewritten = await fetch(`${BASE}/trpc/commerce.products.list`);
  record("a /trpc path is normalised to /api/trpc", rewritten.ok, `HTTP ${rewritten.status}`);

  /*
   * A product page the way vercel.json rewrites it onto the function. With no
   * database there is no product to describe, so the answer is the shop's own
   * shell — but it must be the shell, as HTML, rather than a 404 or an error.
   */
  const page = await fetch(`${BASE}/api?__page=/products/anything`);
  const pageBody = await page.text();
  record(
    "a product page is served the page shell",
    page.ok && /text\/html/.test(page.headers.get("content-type") ?? "") && pageBody.includes("<!-- netlet:head -->"),
    `HTTP ${page.status}`,
  );

  // With no DATABASE_URL the verdict is "not configured", never a crash.
  const ready = await fetch(`${BASE}/readyz`);
  const readyBody = await ready.json();
  record(
    "/readyz reports a verdict without a database",
    ready.status === 503 && typeof readyBody?.database === "string",
    JSON.stringify(readyBody),
  );
} catch (error) {
  record("the function served a request", false, String(error instanceof Error ? error.message : error));
  if (log.trim()) console.error(`\nfunction output:\n${log.trim()}`);
}

const failed = checks.filter(check => !check.ok);
console.log(
  failed.length === 0
    ? `\nsmoke: the bundle serves with no node_modules — ${checks.length} checks passed.`
    : `\nsmoke: ${failed.length} of ${checks.length} checks failed.`,
);
stop(failed.length === 0 ? 0 : 1);

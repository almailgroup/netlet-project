import { loadAnalytics } from "@/lib/analytics";
import { DEMO_MODE } from "@/lib/demoMode";
import { demoLink } from "@/lib/demoLink";
import { trpc } from "@/lib/trpc";
import { COOKIE_NAME, UNAUTHED_ERR_MSG } from "@shared/const";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, httpBatchStreamLink, splitLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import "./index.css";

/**
 * How queries fail.
 *
 * React Query's default is three retries with a growing pause, which is right
 * for a flaky network and wrong for a refusal: a 403, a 404 or "this column
 * does not exist" is the same answer the fourth time, and a page asking four
 * times reads as a page stuck on "Loading…" for the best part of a minute.
 * A client error is final; anything else is asked once more.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        const status = error instanceof TRPCClientError ? (error.data as { httpStatus?: number } | undefined)?.httpStatus : undefined;
        if (typeof status === "number" && status >= 400 && status < 500) return false;
        return failureCount < 1;
      },
      retryDelay: 1_500,
    },
  },
});

/**
 * No request waits forever. A function that never answers — a cold start
 * behind a slow database, a platform timeout that drops the connection rather
 * than closing it — used to leave every section that asked spinning; after
 * this long it is an error the section can say and offer to retry.
 */
const REQUEST_TIMEOUT_MS = 25_000;

function withDeadline(signal: AbortSignal | null | undefined): AbortSignal {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new DOMException("The request took too long", "TimeoutError")), REQUEST_TIMEOUT_MS);
  const stop = () => clearTimeout(timer);
  if (signal) {
    if (signal.aborted) deadline.abort(signal.reason);
    else signal.addEventListener("abort", () => { stop(); deadline.abort(signal.reason); }, { once: true });
  }
  deadline.signal.addEventListener("abort", stop, { once: true });
  return deadline.signal;
}

const fetchWithCredentials: typeof globalThis.fetch = (input, init) =>
  globalThis.fetch(input, {
    ...(init ?? {}),
    credentials: "include",
    signal: withDeadline(init?.signal),
  });

/**
 * An expired or missing session surfaces as UNAUTHED_ERR_MSG. There is no portal
 * to bounce to now that sign-in is in-app, so the cached user is simply cleared
 * and the UI falls back to its signed-out state.
 */
const clearSessionIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (error.message !== UNAUTHED_ERR_MSG) return;
  queryClient.setQueryData([["auth", "me"], { type: "query" }], null);
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    clearSessionIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    clearSessionIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

const trpcClient = trpc.createClient({
  links: [
    // The static demo build has no `/api/trpc` to talk to, so a local link
    // resolves every procedure from fixtures instead. See lib/demoLink.ts.
    //
    // Queries stream: a page's queries still go as one request, but each answer
    // arrives as soon as its procedure finishes. The account page asks nineteen
    // things at once, and as one ordinary batch the response waited for the
    // slowest — one slow or failing procedure held Orders, Messages, Reviews
    // and the rest on "Loading…" together. Mutations stay on the ordinary batch,
    // because signing in sets a cookie, and a header cannot be set once a
    // stream has started.
    DEMO_MODE
      ? demoLink
      : splitLink({
          condition: op => op.type === "query",
          true: httpBatchStreamLink({ url: "/api/trpc", transformer: superjson, fetch: fetchWithCredentials, maxItems: 20 }),
          false: httpBatchLink({ url: "/api/trpc", transformer: superjson, fetch: fetchWithCredentials }),
        }),
  ],
});

loadAnalytics();

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);

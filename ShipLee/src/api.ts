/** The API, from the page. Every answer is a status and a body; nothing throws for a refusal. */
export type Answer<T> = { ok: true; status: number; body: T } | { ok: false; status: number; error: string; problems?: Record<string, string> };

export async function api<T>(method: string, path: string, body?: unknown): Promise<Answer<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined && method === "GET" ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    });
  } catch {
    return { ok: false, status: 0, error: "network" };
  }
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (response.ok) return { ok: true, status: response.status, body: parsed as T };
  const refusal = (parsed ?? {}) as { error?: string; problems?: Record<string, string> };
  return { ok: false, status: response.status, error: refusal.error ?? "server", problems: refusal.problems };
}

export type Config = {
  tracking: boolean;
  demo: boolean;
  samples: string[];
  contact: { phone: string | null; whatsapp: string | null; email: string | null };
};

let config: Promise<Config> | null = null;

/** What the pages need from the server, asked once per visit. */
export function loadConfig(): Promise<Config> {
  return (config ??= api<Config>("GET", "/api/config").then(answer => {
    if (answer.ok) return answer.body;
    config = null;
    return { tracking: false, demo: false, samples: [], contact: { phone: null, whatsapp: null, email: null } };
  }));
}

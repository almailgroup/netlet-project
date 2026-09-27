import { z } from "zod";
import { appRouter } from "../../../../home/user/NetLet-web-app/server/routers.js";

const procs = (appRouter as any)._def.procedures as Record<string, any>;
const out: Record<string, { type: string; input: unknown }> = {};

for (const [path, proc] of Object.entries(procs)) {
  const def = proc._def;
  const type = def.type ?? (def.query ? "query" : def.mutation ? "mutation" : "unknown");
  const inputs = def.inputs ?? [];
  let schema: unknown = null;
  if (inputs.length === 1) {
    try {
      schema = z.toJSONSchema(inputs[0] as any, { io: "input", unrepresentable: "any" });
    } catch (e) {
      schema = { "x-error": String(e).slice(0, 120) };
    }
  } else if (inputs.length > 1) {
    schema = { "x-multi": inputs.length };
  }
  out[path] = { type, input: schema };
}
console.log(JSON.stringify(out, null, 1));

/**
 * Every exported data-layer function that is handed an identity, and whether
 * its body actually mentions that identity. A function that takes `actor` or
 * `userId` and never references it again is either unscoped or guarded
 * somewhere a second caller could skip.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const dir = "server";
const files = readdirSync(dir).filter(f => f.endsWith(".ts") && !f.includes(".test."));
const suspicious = [];
let checked = 0;

for (const file of files) {
  const src = readFileSync(path.join(dir, file), "utf-8");
  const re = /export\s+(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/gs;
  let m;
  while ((m = re.exec(src))) {
    const [, name, params] = m;
    const takesActor = /\bactor\s*:/.test(params);
    const takesUser = /\buserId\s*[:?]/.test(params);
    if (!takesActor && !takesUser) continue;
    checked += 1;
    // The body: from the opening brace to the matching close, by depth.
    let i = src.indexOf("{", m.index + m[0].length - 1), depth = 0, end = i;
    for (; end < src.length; end += 1) {
      if (src[end] === "{") depth += 1;
      else if (src[end] === "}") { depth -= 1; if (depth === 0) break; }
    }
    const body = src.slice(i, end);
    const usesActor = /\bactor\b/.test(body);
    const usesUser = /\buserId\b/.test(body);
    const guards = /assertCan\(|readableVendors\(|readableCouriers\(/.test(body);
    if ((takesActor && !usesActor) || (takesUser && !usesUser)) {
      suspicious.push(`${file}:${name} — takes ${takesActor ? "actor" : ""}${takesActor && takesUser ? "+" : ""}${takesUser ? "userId" : ""} but never uses it`);
    } else if (takesActor && !guards && !/eq\([^)]*vendorId|actor\.vendorId|actor\.courierId/.test(body)) {
      suspicious.push(`${file}:${name} — takes actor, no assertCan and no visible scope`);
    }
  }
}
console.log(`checked ${checked} identity-taking functions`);
console.log(suspicious.length ? suspicious.join("\n") : "every one references its identity and guards or scopes");

import { appRouter } from "../server/routers.js";
const defs = (appRouter as unknown as { _def: { procedures: Record<string, { _def: { type: string } }> } })._def.procedures;
const rows = Object.entries(defs).map(([name, p]) => `${p._def.type.padEnd(9)} ${name}`);
console.log("total:", rows.length);
console.log(rows.sort().join("\n"));

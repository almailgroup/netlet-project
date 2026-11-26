/**
 * Every request the iPhone app sends is one the server takes.
 *
 * The app's tests decode the server's answers from recordings, so a change to
 * what comes back fails them; nothing checked what the app sends. A field the
 * server renamed or made required, a procedure moved or turned from a query
 * into a mutation, passed every demo test and failed on the live site. This
 * reads each `Procedure<In, Out>(query|mutation: "…")` in the app and the
 * Swift type it sends, and holds them to the server's own procedure and zod
 * input: it exists, it is the same kind, every key the server needs is sent
 * (and never left out as a nil optional), and nothing the app sends is
 * dropped as a key the server does not know.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appRouter } from "./index.js";

const APP = path.resolve(import.meta.dirname, "../../../Frontend/iOS/NetLet");

/** A key as it goes on the wire: `optional` is left out when nil, `nullable` may go as null. */
type Field = { name: string; optional: boolean; nullable: boolean; type: string };
type SwiftStruct = { name: string; fields: Field[]; custom: boolean; opaque: boolean; file: string };
type Call = { input: string; kind: "query" | "mutation"; path: string; at: string };

function swiftSources(dir: string): { file: string; text: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name.startsWith(".") ? [] : swiftSources(full);
    return entry.name.endsWith(".swift") ? [{ file: path.relative(APP, full), text: readFileSync(full, "utf-8") }] : [];
  });
}

/** The index just past the brace that closes the one at `open`, strings and comments skipped. */
function closing(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "/") {
      i = text.indexOf("\n", i);
      if (i < 0) return text.length;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i) + 1;
      continue;
    }
    if (c === '"') {
      i += 1;
      while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
      continue;
    }
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return text.length;
}

/** The first match of `pattern` at the body's own level, not inside a nested type or function. */
function ownMatch(body: string, pattern: RegExp): RegExpExecArray | undefined {
  const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
  for (const match of body.matchAll(global)) {
    let depth = 0;
    for (let i = 0; i < (match.index ?? 0); i += 1) {
      if (body[i] === '"') {
        i += 1;
        while (i < body.length && body[i] !== '"') i += body[i] === "\\" ? 2 : 1;
        continue;
      }
      if (body[i] === "{") depth += 1;
      else if (body[i] === "}") depth -= 1;
    }
    if (depth === 0) return match as RegExpExecArray;
  }
  return undefined;
}

/** The body's own lines: what sits at depth one, nested types and functions left out. */
function topLevel(body: string): string {
  let depth = 0;
  let out = "";
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (c === "/" && body[i + 1] === "/") {
      const end = body.indexOf("\n", i);
      i = end < 0 ? body.length : end - 1;
      continue;
    }
    if (c === '"') {
      const start = i;
      i += 1;
      while (i < body.length && body[i] !== '"') i += body[i] === "\\" ? 2 : 1;
      if (depth === 0) out += body.slice(start, i + 1);
      continue;
    }
    if (c === "{") {
      depth += 1;
      if (depth === 1) out += "{";
      continue;
    }
    if (c === "}") {
      depth -= 1;
      if (depth === 0) out += "}";
      continue;
    }
    if (depth === 0) out += c;
  }
  return out;
}

function structsIn(file: string, text: string): SwiftStruct[] {
  const found: (SwiftStruct & { start: number; end: number })[] = [];
  const all: { name: string; start: number; end: number }[] = [];
  for (const match of text.matchAll(/\bstruct\s+(\w+)\s*(?:<[^>]*>)?\s*(?::\s*([^{]+))?\{/g)) {
    const open = (match.index ?? 0) + match[0].length - 1;
    const end = closing(text, open);
    // Named by the structs it sits in, so `Draw.Reference` is not `API.Reference`.
    const parent = all.filter(o => o.start < open && open < o.end).sort((a, b) => b.start - a.start)[0];
    const name = parent ? `${parent.name}.${match[1]}` : match[1];
    all.push({ name, start: open, end });
    if (!/\bEncodable\b|\bCodable\b/.test(match[2] ?? "")) continue;
    const body = text.slice(open + 1, end - 1);
    const own = topLevel(body);
    const properties: Field[] = [];
    for (const line of own.split("\n")) {
      const property = /^\s*(?:@\w+(?:\([^)]*\))?\s+)*(?:public\s+|private\s+|fileprivate\s+|internal\s+)?(let|var)\s+(\w+)\s*:\s*([^={]+?)\s*(=.*)?$/.exec(line);
      if (!property || /\bstatic\b/.test(line)) continue;
      // A `var` followed by a body is computed, never encoded.
      if (property[1] === "var" && /\{\s*$/.test(line)) continue;
      const type = property[3].trim();
      const optional = type.endsWith("?") || /^Optional</.test(type);
      properties.push({ name: property[2], type, optional, nullable: /^OrNull</.test(type) });
    }
    // The wire names CodingKeys gives, `case a = "b"` included.
    const keysEnum = ownMatch(body, /enum\s+CodingKeys\s*:[^{]*\{([^}]*)\}/)?.[1];
    const wire = new Map<string, string>();
    if (keysEnum) for (const part of keysEnum.replace(/\bcase\b/g, ",").split(/[,\n]/)) {
      const named = /^\s*(\w+)\s*(?:=\s*"([^"]+)")?\s*$/.exec(part);
      if (named) wire.set(named[1], named[2] ?? named[1]);
    }
    const encoder = ownMatch(body, /func\s+encode\s*\(\s*to\b[^{]*\{/);
    let fields: Field[] = properties;
    let custom = false;
    let opaque = false;
    if (encoder) {
      const writer = body.slice(encoder.index + encoder[0].length - 1, closing(body, encoder.index + encoder[0].length - 1));
      custom = true;
      if (/nestedContainer|unkeyedContainer|singleValueContainer|superEncoder/.test(writer)) opaque = true;
      fields = [];
      for (const write of writer.matchAll(/\.encode(IfPresent|Nil)?\(\s*(?:([^\n]*?)\s*,\s*)?forKey:\s*\.(\w+)\s*\)/g)) {
        const value = (write[2] ?? "").trim();
        const wrapped = /^OrNull\(/.test(value);
        const property = properties.find(p => p.name === /(\w+)(?=[^(]*$)|^OrNull\((\w+)/.exec(value)?.slice(1).find(Boolean) || p.name === value.split(".")[0]);
        const name = wire.get(write[3]) ?? write[3];
        if (fields.some(f => f.name === name)) continue;
        fields.push({
          name,
          type: property?.type ?? "",
          optional: write[1] === "IfPresent",
          nullable: write[1] === "Nil" || wrapped || (write[1] === undefined && !!property?.optional) || !!property?.nullable,
        });
      }
    } else if (keysEnum) {
      // Synthesised from CodingKeys: only the keys it lists, by their wire names.
      fields = properties.filter(p => wire.has(p.name)).map(p => ({ ...p, name: wire.get(p.name)! }));
    }
    found.push({ name, fields, custom, opaque, file, start: open, end });
  }
  return found;
}

function callsIn(file: string, text: string): Call[] {
  const calls: Call[] = [];
  for (const match of text.matchAll(/Procedure<\s*([A-Za-z_][\w.]*)\s*,[^\n]*?>\((query|mutation):\s*"([^"]+)"/g)) {
    calls.push({ input: match[1].split(".").pop() ?? match[1], kind: match[2] as Call["kind"], path: match[3], at: `${file}:${text.slice(0, match.index).split("\n").length}` });
  }
  return calls;
}

/* zod 4's own description of a schema, read the way a parse would walk it. */
type ZodLike = { _zod: { def: Record<string, unknown> & { type: string } }; safeParse: (value: unknown) => { success: boolean } };

function unwrap(schema: ZodLike | undefined): ZodLike | undefined {
  let at = schema;
  for (let i = 0; at && i < 12; i += 1) {
    const def = at._zod.def;
    if (["optional", "nullable", "default", "prefault", "readonly", "catch", "nonoptional"].includes(def.type)) at = def.innerType as ZodLike;
    else if (def.type === "pipe") at = def.in as ZodLike;
    else if (def.type === "lazy") at = (def.getter as () => ZodLike)();
    else return at;
  }
  return at;
}

/** An object's keys, each with whether it may be left out, and whether it takes keys it does not name. */
type Shape = { keys: Map<string, ZodLike>; open: boolean };

function shapeOf(schema: ZodLike | undefined): Shape | undefined {
  const at = unwrap(schema);
  if (!at || at._zod.def.type !== "object") return undefined;
  const catchall = at._zod.def.catchall as ZodLike | undefined;
  return { keys: new Map(Object.entries(at._zod.def.shape as Record<string, ZodLike>)), open: !!catchall && catchall._zod.def.type !== "never" };
}

/** The object a field holds, through an array or a record of them. */
function elementShape(schema: ZodLike): Shape | undefined {
  const at = unwrap(schema);
  if (!at) return undefined;
  if (at._zod.def.type === "array") return shapeOf(at._zod.def.element as ZodLike);
  return shapeOf(at);
}

/** The struct a Swift field's type names, through `?`, `[…]` and `OrNull<…>`. */
function fieldStruct(type: string, owner: string, structs: Map<string, SwiftStruct[]>): SwiftStruct | undefined {
  const bare = type.replace(/\?$/, "").replace(/^\[(.+)\]$/, "$1").replace(/^OrNull<(.+)>$/, "$1").replace(/\?$/, "").replace(/^API\./, "");
  // A nested type is looked for beside its owner first, as Swift resolves it.
  const scopes = owner.split(".");
  for (let depth = scopes.length; depth >= 0; depth -= 1) {
    const name = [...scopes.slice(0, depth), bare].join(".");
    const found = structs.get(name);
    if (found?.length === 1) return found[0];
  }
  return undefined;
}

/**
 * Required keys a Swift optional holds that are set on every send by how the
 * request is built, each with the reason. An entry here is a promise the code
 * keeps, so it names where.
 */
/**
 * Request types whose encoder writes a nested container, which this cannot
 * follow, each checked by hand against the server's input.
 */
const WRITTEN_BY_HAND = new Map([
  // { id, change: { action, price? } } — subscriptions.change's `change` union.
  ["StandingOrderChange", "id and a change of { action } or { action: acceptPrice, price }"],
]);

const SET_ON_EVERY_SEND = new Map([
  // AddressFormModel.save sends `update` only while editing, with that row's id.
  ["customer.addresses.update id", "sent only while an address is being edited, carrying its id"],
]);

describe("the iPhone app's requests", () => {
  const sources = swiftSources(APP);
  const structs = new Map<string, SwiftStruct[]>();
  for (const { file, text } of sources) for (const found of structsIn(file, text)) structs.set(found.name, [...(structs.get(found.name) ?? []), found]);
  const calls = sources.flatMap(({ file, text }) => callsIn(file, text));
  const procedures = (appRouter as unknown as { _def: { procedures: Record<string, { _def: { type: string; inputs: ZodLike[] } }> } })._def.procedures;

  it("reads a Swift type the way its encoder writes it", () => {
    const sample = `
      struct Outer: Encodable {
        struct Reference: Encodable { let data: String }
        let id: Int
        var note: String?
        let wrapped: OrNull<Int>
        var total: Int { 3 }
        static let shared = 1
      }
      struct Written: Encodable {
        struct Step: Encodable {
          func encode(to encoder: Encoder) throws { var c = encoder.container(keyedBy: CodingKeys.self); try c.encode(x, forKey: .x) }
        }
        var imageUrl: String?
        let count: Int
        var tag: String?
        func encode(to encoder: Encoder) throws {
          var c = encoder.container(keyedBy: CodingKeys.self)
          try c.encode(OrNull(imageUrl), forKey: .imageUrl)
          try c.encode(count, forKey: .count)
          try c.encodeIfPresent(tag, forKey: .label)
        }
        private enum CodingKeys: String, CodingKey { case imageUrl, count, label = "tagName" }
      }`;
    const read = new Map(structsIn("sample.swift", sample).map(s => [s.name, s]));
    expect([...read.keys()]).toEqual(["Outer", "Outer.Reference", "Written", "Written.Step"]);
    expect(read.get("Outer")?.fields.map(f => [f.name, f.optional, f.nullable])).toEqual([["id", false, false], ["note", true, false], ["wrapped", false, true]]);
    // The struct's own encoder, never its nested Step's.
    expect(read.get("Written")?.fields.map(f => [f.name, f.optional, f.nullable])).toEqual([["imageUrl", false, true], ["count", false, false], ["tagName", true, false]]);
  });

  it("reads the app's procedures and their types", () => {
    // A guard that finds nothing passes: it has read the app.
    expect(sources.length).toBeGreaterThan(200);
    expect(calls.length).toBeGreaterThan(300);
    expect(structs.size).toBeGreaterThan(100);
  });

  it("asks only for procedures the server has, as the kind they are", () => {
    const wrong = calls.flatMap(call => {
      const procedure = procedures[call.path];
      if (!procedure) return [`${call.at} ${call.path}: no such procedure`];
      return procedure._def.type === call.kind ? [] : [`${call.at} ${call.path}: the app sends a ${call.kind}, the server has a ${procedure._def.type}`];
    });
    expect(wrong).toEqual([]);
  });

  it("sends every key the server needs and none it would drop", () => {
    const problems: string[] = [];
    let compared = 0;
    let nested = 0;
    /* Which keys some procedure sending a type takes, so a shared type's
       optional field, left nil by the procedure that does not take it, is
       not called dropped. */
    const takenByType = new Map<string, Set<string>>();
    for (const call of calls) {
      const shape = shapeOf(procedures[call.path]?._def.inputs[0]);
      if (!shape) continue;
      const set = takenByType.get(call.input) ?? new Set<string>();
      for (const key of shape.keys.keys()) set.add(key);
      takenByType.set(call.input, set);
    }

    /* `union` is every key of every option when the server's input is a union:
       the app sets one option's keys and leaves the rest nil, so an optional
       field may stand for an option's key, and one of another option's is no
       drop. */
    function compare(sent: SwiftStruct, shape: Shape, where: string, top: string | undefined, depth: number, union?: Set<string>): string[] {
      const found: string[] = [];
      for (const [key, schema] of shape.keys) {
        const mayOmit = schema.safeParse(undefined).success;
        const field = sent.fields.find(f => f.name === key);
        if (!field && !mayOmit) found.push(`${where}: never sends "${key}", which the server needs`);
        else if (field?.optional && !mayOmit && !union && !(top && SET_ON_EVERY_SEND.has(`${top} ${key}`)))
          found.push(`${where}: "${key}" is optional in ${sent.name} (left out when nil), the server needs it`);
        if (field?.nullable && !schema.safeParse(null).success) found.push(`${where}: "${key}" can go as null, which the server refuses`);
        if (field && depth < 4) {
          const inner = fieldStruct(field.type, sent.name, structs);
          const innerShape = elementShape(schema);
          if (inner && innerShape && !inner.opaque) {
            nested += 1;
            found.push(...compare(inner, innerShape, `${where} › ${key}`, undefined, depth + 1));
          }
        }
      }
      if (shape.open) return found;
      for (const field of sent.fields) {
        if (shape.keys.has(field.name)) continue;
        // A shared type's optional field another procedure takes is nil here.
        if (field.optional && top && takenByType.get(sent.name.split(".").pop() ?? sent.name)?.has(field.name)) continue;
        if (field.optional && union?.has(field.name)) continue;
        found.push(`${where}: sends "${field.name}", which the server drops`);
      }
      return found;
    }

    /** The shapes a server input may take: one object, or each option of a union of them. */
    function shapesOf(schema: ZodLike | undefined): Shape[] {
      const at = unwrap(schema);
      if (!at) return [];
      if (at._zod.def.type === "union") return (at._zod.def.options as ZodLike[]).flatMap(option => shapesOf(option));
      const shape = shapeOf(at);
      return shape ? [shape] : [];
    }

    for (const call of calls) {
      const procedure = procedures[call.path];
      if (!procedure) continue;
      const inputs = procedure._def.inputs;
      if (call.input === "NoInput") {
        const shape = shapeOf(inputs[0]);
        if (shape) for (const [key, schema] of shape.keys) if (!schema.safeParse(undefined).success) problems.push(`${call.at} ${call.path}: sends nothing, the server needs "${key}"`);
        compared += 1;
        continue;
      }
      const candidates = structs.get(call.input) ?? [];
      if (candidates.length !== 1) {
        problems.push(`${call.at} ${call.path}: ${candidates.length} Encodable structs named ${call.input}`);
        continue;
      }
      const sent = candidates[0];
      if (sent.opaque) {
        if (!WRITTEN_BY_HAND.has(sent.name)) problems.push(`${call.at} ${call.path}: ${sent.name} writes nested containers; check it by hand and say so in WRITTEN_BY_HAND`);
        continue;
      }
      if (inputs.length === 0) {
        compared += 1;
        if (sent.fields.length > 0) problems.push(`${call.at} ${call.path}: sends ${sent.fields.map(f => f.name).join(", ")}, the server takes no input`);
        continue;
      }
      const shapes = shapesOf(inputs[0]);
      if (shapes.length === 0) {
        problems.push(`${call.at} ${call.path}: the server's input is neither an object nor a union of them`);
        continue;
      }
      compared += 1;
      // A union is met by any one of its options.
      const union = shapes.length > 1 ? new Set(shapes.flatMap(shape => [...shape.keys.keys()])) : undefined;
      const tries = shapes.map(shape => compare(sent, shape, `${call.at} ${call.path}`, call.path, 0, union));
      if (!tries.some(t => t.length === 0)) problems.push(...tries.sort((a, b) => a.length - b.length)[0]);
    }
    console.log(`compared ${compared} of ${calls.length} requests, ${nested} nested types`);
    expect(compared).toBeGreaterThan(440);
    expect(nested).toBeGreaterThan(20);
    expect(problems).toEqual([]);
  });
});

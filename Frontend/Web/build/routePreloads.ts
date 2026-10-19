/**
 * Which code each shopping address needs, read from the app's own route table
 * at build time, so the page can start fetching it before the app has started.
 *
 * Every page but the home page is its own chunk, and a chunk was asked for
 * only once the main bundle had arrived and run — about 900ms into a cold
 * visit on a phone — after which the page waited a further round trip for its
 * own code, and the first paint waited with it. The address already says
 * which page it is, so `public/route-preload.js` reads this table the moment
 * the HTML arrives and preloads the matching page and everything it imports
 * that the main bundle does not.
 *
 * Read from `App.tsx`'s `ROUTES` and its `lazyPage` imports rather than kept
 * as a second list, so a new page is preloaded with nothing else to edit. A
 * shape this cannot read is a page that is simply not preloaded, never a
 * broken one; the test fails if the table comes out short.
 */
export type RouteTable = { base: string; files: string[]; routes: [pattern: string, files: number[]][] };
/** The table, and the routes whose page no chunk was found for — said by the build, never silent. */
export type RouteTableResult = { table: RouteTable; unplaced: string[] };

/** `App.tsx`'s shopping and sign-in routes, as [wouter pattern, page module]. The portal's are left out. */
export function routesFromApp(source: string): [pattern: string, module: string][] {
  const modules = new Map<string, string>();
  for (const match of source.matchAll(/const (\w+) = lazyPage\(\(\) => import\("@\/pages\/([\w/]+)"\)\)/g)) {
    modules.set(match[1], `/pages/${match[2]}.tsx`);
  }
  const routes: [string, string][] = [];
  for (const match of source.matchAll(/\{ path: "([^"]+)", page: (\w+), frame: "(shop|bare)" \}/g)) {
    const module = modules.get(match[2]);
    if (module) routes.push([match[1], module]);
  }
  return routes;
}

/** A wouter pattern as an anchored regular expression over the path below the base. */
export function patternSource(pattern: string): string {
  if (pattern === "/") return "^/?$";
  const body = pattern
    .split("/")
    .map(part => (part.startsWith(":") ? "[^/]+" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/");
  return `^${body}/?$`;
}

type Chunk = { fileName: string; imports: string[]; isEntry: boolean; facadeModuleId: string | null; moduleIds?: string[] };

/** The table for a built bundle: each route's page chunk and its static imports, less the main bundle's own. */
export function routeTable(routes: [string, string][], chunks: Chunk[], base: string): RouteTableResult {
  const byName = new Map(chunks.map(chunk => [chunk.fileName, chunk]));
  const closure = (start: string[], into = new Set<string>()) => {
    for (const file of start) {
      if (into.has(file)) continue;
      into.add(file);
      closure(byName.get(file)?.imports ?? [], into);
    }
    return into;
  };
  const entry = chunks.find(chunk => chunk.isEntry);
  const already = closure(entry ? [entry.fileName] : []);
  const files: string[] = [];
  const indexOf = (file: string) => {
    const at = files.indexOf(file);
    return at >= 0 ? at : files.push(file) - 1;
  };
  const table: RouteTable["routes"] = [];
  const unplaced: string[] = [];
  for (const [pattern, module] of routes) {
    /* By the module the chunk is for, or failing that one it holds: Rollup
       leaves the facade null on a page chunk it has merged shared code into,
       which the product page's is. */
    const page = chunks.find(chunk => chunk.facadeModuleId?.endsWith(module))
      ?? chunks.find(chunk => !chunk.isEntry && chunk.moduleIds?.some(id => id.endsWith(module)));
    if (!page) {
      unplaced.push(pattern);
      continue;
    }
    const wanted = [...closure([page.fileName])].filter(file => !already.has(file));
    if (wanted.length) table.push([patternSource(pattern), wanted.map(indexOf)]);
  }
  return { table: { base, files, routes: table }, unplaced };
}

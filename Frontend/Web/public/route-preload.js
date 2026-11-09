/*
 * Preloads the code of the page this address is, before the app has started.
 *
 * Every page but the home page is its own file, and it used to be asked for
 * only once the main bundle had arrived and run, so a phone opening a shared
 * product link waited for two downloads in a row. The table is written into
 * the page by the build (Frontend/Web/build/routePreloads.ts): a pattern per
 * route and the files that page needs beyond the main bundle. This adds a
 * module preload for each file of the one row the address matches; the app's
 * own import then finds them already here.
 *
 * A file rather than inline because the CSP allows scripts from this origin
 * only, and async so it never holds up the page. Anything wrong — no table, a
 * pattern this browser cannot read — leaves the page exactly as it was.
 */
(function () {
  try {
    var data = document.getElementById("netlet-routes");
    if (!data) return;
    var table = JSON.parse(data.textContent);
    var path = location.pathname;
    if (table.base !== "/" && path.indexOf(table.base) === 0) path = "/" + path.slice(table.base.length);
    /* On a portal's own address (Shared/portal.ts) the address bar leaves the
       portal's /admin off: /orders there is the app's /admin/orders. An
       admin. or vendor. address is the portal by its own name, as there. */
    var host = location.hostname.toLowerCase().replace(/\.$/, "");
    var named = /^(admin|vendor)\.((?:[a-z0-9-]+\.)*[a-z0-9-]+)$/.exec(host);
    var onPortal = named && (table.portal ? named[2] === table.portal : named[2].indexOf(".") !== -1 || named[2] === "localhost");
    if (onPortal && !/^\/(admin(\/|$)|signin$|invoices\/|terms$|privacy$|seller-agreement$)/.test(path)) {
      path = path === "/" ? "/admin" : "/admin" + path;
    }
    /* On a portal, wake the server now. A server that has been idle takes a
       second or two to start, and the portal's first request is sent only
       once the app's script has downloaded and run; asked here, the start
       happens while the script downloads, and the app's request finds a
       server already up, its database connections open (/api/readyz asks
       the database). Nothing waits on the answer. */
    if (onPortal && window.fetch) fetch(table.base + "api/readyz", { credentials: "omit", cache: "no-store" }).catch(function () {});
    for (var i = 0; i < table.routes.length; i++) {
      if (!new RegExp(table.routes[i][0]).test(path)) continue;
      var files = table.routes[i][1];
      for (var j = 0; j < files.length; j++) {
        var link = document.createElement("link");
        link.rel = "modulepreload";
        link.href = table.base + table.files[files[j]];
        /* As the app's own module scripts ask, so the preload is the one they use. */
        link.crossOrigin = "";
        document.head.appendChild(link);
      }
      return;
    }
  } catch (error) {
    /* Nothing preloaded is the page as it always was. */
  }
})();

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

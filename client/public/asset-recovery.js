/*
 * When a built file fails to load, fetch it again past the cache and reload,
 * once.
 *
 * Every file under /assets/ is cached for a year as immutable — its name is a
 * hash of its contents, so it can never change. The trap is a response that
 * is *not* the file. For a few seconds while Vercel switches deployments, a
 * browser can get the new page and ask the old deployment for one of the new
 * page's scripts; the old deployment does not have it, and the answer that
 * came back was the HTML page. The browser then kept that HTML as the script
 * for a year, and an ordinary reload never asked again: a blank page, for
 * that visitor, until they cleared their cache. vercel.json no longer answers
 * /assets/ with the page, so a missing file is a plain 404 now, and this is
 * what recovers from either.
 *
 * The same holds for a tab left open across a deploy: its pages load on
 * demand, and the files they ask for belong to the deployment that has gone.
 * Vite reports that as `vite:preloadError`.
 *
 * `cache: "reload"` is the part a reload cannot do: it goes to the network
 * and overwrites the bad cached entry with whatever is there now. Then one
 * reload. A file that is genuinely missing stays missing, so a second failure
 * within a minute does nothing rather than reloading forever, and if
 * sessionStorage is unavailable it does nothing at all for the same reason.
 *
 * A file of its own rather than an inline script, because the server's
 * content security policy allows scripts from this origin only. Deferred, so
 * it costs the first paint nothing and still runs before the app's own module
 * script, which is deferred behind it.
 */
(function () {
  var KEY = "netlet:asset-recovery";
  var WINDOW_MS = 60000;
  var started = false;

  function allowed() {
    try {
      var last = Number(window.sessionStorage.getItem(KEY) || 0);
      if (Date.now() - last < WINDOW_MS) return false;
      window.sessionStorage.setItem(KEY, String(Date.now()));
      return true;
    } catch (error) {
      return false;
    }
  }

  function assetUrls(extra) {
    var urls = [];
    var nodes = document.querySelectorAll('script[src*="/assets/"], link[href*="/assets/"]');
    for (var i = 0; i < nodes.length; i++) urls.push(nodes[i].src || nodes[i].href);
    if (extra) {
      var found = String(extra).match(/[^\s"'()]*\/assets\/[^\s"'()]+\.(?:js|css)/g);
      if (found) urls = urls.concat(found);
    }
    return urls;
  }

  function recover(extra) {
    if (started || !allowed()) return false;
    started = true;
    var fetches = assetUrls(extra).map(function (url) {
      return window.fetch(url, { cache: "reload", credentials: "same-origin" }).catch(function () {});
    });
    Promise.all(fetches).then(function () {
      window.location.reload();
    });
    return true;
  }

  window.addEventListener(
    "error",
    function (event) {
      var element = event.target;
      if (!element || (element.tagName !== "SCRIPT" && element.tagName !== "LINK")) return;
      var url = element.src || element.href || "";
      if (url.indexOf("/assets/") === -1) return;
      recover(url);
    },
    true,
  );

  window.addEventListener("vite:preloadError", function (event) {
    var payload = event && event.payload;
    if (recover(payload && payload.message)) event.preventDefault();
  });
})();

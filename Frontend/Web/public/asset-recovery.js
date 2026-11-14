/*
 * When a built file fails to load, fetch it again past the cache and reload —
 * and if that lands on the old build again, try again a little later.
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
 * Vite reports that as `vite:preloadError`, and the crash screen asks too
 * (`window.__netletRecover`), for a page whose own code failed to arrive.
 *
 * **One reload was not enough, and the owner met the case.** A deploy takes a
 * few seconds to reach every server, so the reload a failure starts can be
 * handed the old page once more; it then fails again, and the first version,
 * which allowed one reload a minute, left the shopper on the crash screen (or
 * a blank page) until they reloaded by hand. So it tries up to four times,
 * each later than the last (`DELAYS`): at once, then after 3, 10 and 30
 * seconds, which outlasts the switch-over. A file genuinely missing from a
 * build is still missing after the fourth, and then it stops rather than
 * reloading forever; a page that has run for half a minute without a failure
 * forgets the count, so the next deploy starts afresh.
 *
 * **Only the file that failed is fetched again**, with `cache: "reload"` —
 * the part a reload cannot do: it goes to the network and overwrites the bad
 * cached entry with whatever is there now. It used to refetch every file on
 * the page, which overwrote the browser's good copy of the old build's main
 * script with a 404, so an old page handed back once more could not even
 * start and the reload drew nothing at all.
 *
 * Without sessionStorage it does nothing, since it could not count.
 *
 * A file of its own rather than an inline script, because the server's
 * content security policy allows scripts from this origin only. Deferred, so
 * it costs the first paint nothing and still runs before the app's own module
 * script, which is deferred behind it.
 */
(function () {
  var KEY = "netlet:asset-recovery";
  /* How long each reload waits after the failure that asks for it. */
  var DELAYS = [0, 3000, 10000, 30000];
  /* Attempts older than this are not counted. */
  var WINDOW_MS = 10 * 60 * 1000;
  /* A page that runs this long without a failure forgets the attempts. */
  var SETTLED_MS = 30000;
  var pending = false;

  function readAttempts(now) {
    var raw = window.sessionStorage.getItem(KEY);
    var list;
    try {
      list = JSON.parse(raw || "[]");
    } catch (error) {
      list = [];
    }
    /* The first version kept one time as a bare number. */
    if (typeof list === "number") list = [list];
    if (!Array.isArray(list)) list = [];
    return list.filter(function (time) {
      return typeof time === "number" && now - time < WINDOW_MS && now >= time;
    });
  }

  /* The wait before the next reload, or -1 when no reload is left. */
  function claimAttempt() {
    try {
      var now = Date.now();
      var list = readAttempts(now);
      if (list.length >= DELAYS.length) return -1;
      var wait = DELAYS[list.length];
      list.push(now);
      window.sessionStorage.setItem(KEY, JSON.stringify(list));
      return wait;
    } catch (error) {
      return -1;
    }
  }

  function failedUrls(extra) {
    var found = String(extra || "").match(/[^\s"'()]*\/assets\/[^\s"'()]+\.(?:js|css)/g);
    return found || [];
  }

  /* Whether a reload is on its way: true when this call started one or one
     was already coming, false when every attempt has been used. */
  function recover(extra) {
    if (pending) return true;
    var wait = claimAttempt();
    if (wait < 0) return false;
    pending = true;
    var fetches = failedUrls(extra).map(function (url) {
      return window.fetch(url, { cache: "reload", credentials: "same-origin" }).catch(function () {});
    });
    Promise.all(fetches).then(function () {
      window.setTimeout(function () {
        window.location.reload();
      }, wait);
    });
    return true;
  }

  window.__netletRecover = recover;

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

  /* Not `preventDefault`: that makes the import answer `undefined`, which the
     page then fails on with a sentence nobody can tell from a real fault. Let
     the import fail as itself, so the crash screen knows it for a stale build
     and says the shop is updating while the reload waits its turn. */
  window.addEventListener("vite:preloadError", function (event) {
    var payload = event && event.payload;
    recover(payload && payload.message);
  });

  window.addEventListener("load", function () {
    window.setTimeout(function () {
      if (pending) return;
      try {
        window.sessionStorage.removeItem(KEY);
      } catch (error) {
        /* Nothing was counted, then. */
      }
    }, SETTLED_MS);
  });
})();

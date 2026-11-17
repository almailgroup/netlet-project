/*
 * Inter's stylesheet is fetched without blocking the first paint
 * (`media="print"`, index.html says why) and promoted to every medium once it
 * has arrived. This is that promotion. It was an inline `onload` attribute,
 * which the Content-Security-Policy the server sends (`script-src-attr
 * 'none'`) refuses to run: Vercel serves the plain page without that policy,
 * so the home page had Inter, but a product, a department, a store, the
 * categories or a guide opened straight from a link is answered by the
 * function, with the policy — and there the stylesheet stayed print-only and
 * the page was drawn in the fallback font. A file from this origin is
 * allowed by `script-src 'self'`.
 */
(function () {
  var link = document.querySelector("link[data-webfont]");
  if (!link) return;
  function show() {
    link.media = "all";
  }
  /* Already here (a fast cache): `sheet` exists once a stylesheet has loaded. */
  if (link.sheet) show();
  else link.addEventListener("load", show, { once: true });
})();

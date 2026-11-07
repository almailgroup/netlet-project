/*
 * Where Google's sign-in popup comes back to (Sign in with Google on the
 * website, `lib/googleSignIn.ts`). Google puts the identity token in the
 * address's fragment, which no server and no Referer ever sees; this page
 * hands it to the page that opened the popup and closes.
 *
 * It answers on a BroadcastChannel, which reaches the sign-in page on this
 * origin whatever the opener policy did to `window.opener` while the popup
 * was on Google's page, and through the opener as well where there is one.
 * The fragment is taken out of the address first, so the token is in no
 * history entry. A file, not an inline script, because the server's CSP
 * allows scripts from this origin only.
 */
(function () {
  var params = new URLSearchParams(window.location.hash.slice(1));
  var message = {
    type: "netlet-google",
    idToken: params.get("id_token"),
    state: params.get("state"),
    error: params.get("error"),
  };
  try { window.history.replaceState(null, "", window.location.pathname); } catch (e) {}
  try {
    var channel = new BroadcastChannel("netlet-google");
    channel.postMessage(message);
    channel.close();
  } catch (e) {}
  try {
    if (window.opener) window.opener.postMessage(message, window.location.origin);
  } catch (e) {}
  var arabic = /^ar\b/i.test(navigator.language || "");
  window.addEventListener("DOMContentLoaded", function () {
    var said = document.getElementById("said");
    if (said) said.textContent = arabic ? "يمكنك إغلاق هذه النافذة." : "You can close this window.";
  });
  window.setTimeout(function () { window.close(); }, 80);
})();

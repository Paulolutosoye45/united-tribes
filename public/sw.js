/*
 * United Tribes service worker.
 *
 * It does three things, and nothing else:
 *   1. keeps the "you are offline" page (and what it needs to look right) so a phone with no signal shows that instead of
 *      the browser's error;
 *   2. keeps the framework's fingerprinted files, fonts and icons, which never change under the same name, so the app opens fast;
 *   3. steps aside for everything else.
 *
 * It never stores a page, a data request, a sign-in or anything with a person's name in it: pages always come from the
 * network, so a phone that is lent to someone else shows nothing of the last person. Bump VERSION to clear the old files.
 */
const VERSION = "ut-v1";
const SHELL = `${VERSION}-shell`;
const FILES = `${VERSION}-files`;
const OFFLINE = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL);
      const page = await fetch(OFFLINE, { credentials: "omit", cache: "reload" });
      if (!page.ok) throw new Error("offline page unavailable");
      const html = await page.clone().text();
      await shell.put(OFFLINE, page);
      // What the page needs to be styled: its stylesheets, and the fonts those name.
      const sheets = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]*>/g)]
        .map((m) => /href="([^"]+)"/.exec(m[0])?.[1])
        .filter(Boolean)
        .map((href) => new URL(href.replace(/&amp;/g, "&"), self.location.origin))
        .filter((u) => u.origin === self.location.origin);
      const files = await caches.open(FILES);
      for (const url of sheets) {
        const res = await fetch(url, { credentials: "omit" }).catch(() => null);
        if (!res || !res.ok) continue;
        await files.put(url, res.clone());
        const css = await res.text();
        for (const m of css.matchAll(/url\(([^)]+)\)/g)) {
          const ref = m[1].replace(/^["']|["']$/g, "");
          if (!/\.woff2?(\?|$)/.test(ref)) continue;
          const font = new URL(ref, url);
          if (font.origin !== self.location.origin) continue;
          const f = await fetch(font, { credentials: "omit" }).catch(() => null);
          if (f && f.ok) await files.put(font, f);
        }
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (!key.startsWith(VERSION)) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

/** Files that are safe to keep: they are named by what is in them, or they are the church's own images. */
const KEEP = [/^\/_next\/static\//, /^\/icons\//, /^\/brand\//, /\.(?:woff2?)$/];

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // A page: always ask the network. Only when that fails, show the offline page.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const kept = await caches.match(OFFLINE, { cacheName: SHELL });
        return kept || new Response("You are offline.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
      }),
    );
    return;
  }

  if (!KEEP.some((re) => re.test(url.pathname))) return;

  // A kept file: use the copy if there is one, otherwise fetch it and keep it.
  event.respondWith(
    (async () => {
      const cache = await caches.open(FILES);
      const hit = await cache.match(request);
      if (hit) return hit;
      const res = await fetch(request);
      if (res.ok && res.type === "basic") await cache.put(request, res.clone());
      return res;
    })(),
  );
});

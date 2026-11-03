/*
 * The service worker, served by app/sw.js/route.ts (the repo tracks no .js files) and registered
 * with scope "/?", so it controls only the installed app's start URL (/?source=pwa).
 *
 * It keeps one thing on the device: the home page and the /_next/static files it references, so
 * the installed app opens offline. Nothing else is ever cached: no API answer, no test-server
 * response, no other page. Requests it doesn't handle go straight to the network untouched.
 *
 * - Home page: network first; after 4 s without an answer, the cached copy (a connection that is
 *   up but useless otherwise shows a blank page). The network answer keeps loading in the
 *   background and refreshes the copy when it lands, pruning static files the new page no longer
 *   uses, so the cache never grows past one version. A refresh is all or nothing: if any of the
 *   new page's files can't be fetched, the old copy and its files stay.
 * - /_next/static/*: cache first (the files are content-hashed, so a name never changes meaning).
 */
export const SERVICE_WORKER_SOURCE = `"use strict";
const CACHE = "kilomita-shell-v1";
const SHELL = "/";
const STATIC = "/_next/static/";
const TIMEOUT_MS = 4000;

function assetsOf(html) {
  const found = new Set();
  for (const match of html.matchAll(/(?:src|href)="(\\/_next\\/static\\/[^"?#]+)"/g)) found.add(match[1]);
  return [...found];
}

async function refresh(response) {
  const cache = await caches.open(CACHE);
  const assets = assetsOf(await response.clone().text());
  await Promise.all(assets.map(async (path) => {
    if (await cache.match(path)) return;
    const asset = await fetch(path);
    // All or nothing: a missing file must not replace a working copy with a broken one.
    if (!asset.ok) throw new Error("asset");
    await cache.put(path, asset);
  }));
  await cache.put(SHELL, response);
  const keep = new Set(assets.map((path) => new URL(path, self.location.origin).href));
  for (const request of await cache.keys()) {
    const url = new URL(request.url);
    if (url.pathname.startsWith(STATIC) && !keep.has(url.href)) await cache.delete(request);
  }
}

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));
}

async function navigate(event) {
  const network = fetch(event.request);
  event.waitUntil(network.then((response) => {
    if (response.ok && response.type === "basic") return refresh(response.clone());
  }).catch(() => undefined));
  try {
    return await Promise.race([network, timeout(TIMEOUT_MS)]);
  } catch {
    const cached = await caches.match(SHELL);
    return cached ?? network;
  }
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(fetch(SHELL).then((response) => {
    if (response.ok) return refresh(response);
  }).catch(() => undefined));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys()
    .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(navigate(event));
    return;
  }
  if (url.pathname.startsWith(STATIC)) {
    event.respondWith(caches.match(request).then((hit) => hit ?? fetch(request)));
  }
});
`;

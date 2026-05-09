// ============================================================
// sw.js — Zion Spotify Service Worker
// Acts as a "proxy" in the browser. Intercepts network requests
// and caches audio files so they play even when offline.
// ============================================================

const CACHE_NAME = 'zion-audio-cache-v1';
const STATIC_CACHE = 'zion-static-v1';

// Static assets to pre-cache on install
const STATIC_ASSETS = [
  '/',
  '/index.html'
];

// ── Install: pre-cache static shell ──────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// ── Activate: clean up old caches ────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== STATIC_CACHE)
          .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch: intercept requests ─────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Handle audio/media requests — cache-first for offline playback
  if (isAudioRequest(event.request)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const cached = await cache.match(event.request);
        if (cached) {
          // Serve from cache immediately
          return cached;
        }
        // Fetch from network and store in cache
        try {
          const networkResponse = await fetch(event.request.clone());
          if (networkResponse && networkResponse.status === 200) {
            // Only cache same-origin or CORS-allowed responses
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        } catch (err) {
          // Network failed — return cached if available
          return cached || new Response('Audio unavailable offline', { status: 503 });
        }
      })
    );
    return;
  }

  // For HTML/static: network first, fall back to cache
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match('/index.html')
      )
    );
    return;
  }

  // Default: stale-while-revalidate
  event.respondWith(
    caches.match(event.request).then(cached => {
      const networkFetch = fetch(event.request).then(response => {
        if (response && response.status === 200 && response.type === 'basic') {
          caches.open(STATIC_CACHE).then(cache => cache.put(event.request, response.clone()));
        }
        return response;
      });
      return cached || networkFetch;
    })
  );
});

// ── Message: manual cache a song URL ─────────────────────────
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'CACHE_SONG') {
    const songUrl = event.data.url;
    event.waitUntil(
      caches.open(CACHE_NAME).then(async cache => {
        const existing = await cache.match(songUrl);
        if (!existing) {
          try {
            const response = await fetch(songUrl);
            if (response && response.status === 200) {
              await cache.put(songUrl, response);
              // Notify client that caching succeeded
              self.clients.matchAll().then(clients => {
                clients.forEach(client =>
                  client.postMessage({ type: 'SONG_CACHED', url: songUrl })
                );
              });
            }
          } catch (e) {
            console.warn('[SW] Could not cache song:', songUrl, e);
          }
        }
      })
    );
  }
});

// ── Helper ────────────────────────────────────────────────────
function isAudioRequest(request) {
  const url = request.url.toLowerCase();
  const isAudioMime =
    request.headers.get('Accept') &&
    request.headers.get('Accept').includes('audio');
  const isAudioExtension =
    url.includes('.mp3') ||
    url.includes('.ogg') ||
    url.includes('.wav') ||
    url.includes('.flac') ||
    url.includes('.aac') ||
    url.includes('.m4a') ||
    url.includes('audio') ||
    url.includes('storage') || // Supabase Storage URLs
    url.includes('supabase');
  return isAudioMime || isAudioExtension;
}


const CACHE_NAME = 'rava-golden-v1.2';
const DYNAMIC_CACHE = 'rava-dynamic-v1';
const MEDIA_CACHE = 'rava-media-v1'; // مخصوص فایل‌های صوتی روایت‌ها
const MAX_DYNAMIC_ITEMS = 50; 

// تابع کمکی برای محدود کردن حجم کش
const limitCacheSize = async (name, maxItems) => {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  if (keys.length > maxItems) {
    await cache.delete(keys[0]);
    limitCacheSize(name, maxItems);
  }
};

const STATIC_ASSETS = [
  '/',
  '/index.html',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter(key => ![CACHE_NAME, DYNAMIC_CACHE, MEDIA_CACHE].includes(key))
            .map(key => caches.delete(key))
      );
    })
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // ۱. استراتژی کش برای فایل‌های صوتی (Narratives) از Supabase
  if (url.href.includes('/storage/v1/object/public/narratives/')) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        return cachedResponse || fetch(request).then((networkResponse) => {
          return caches.open(MEDIA_CACHE).then((cache) => {
            cache.put(request, networkResponse.clone());
            return networkResponse;
          });
        });
      })
    );
    return;
  }

  // ۲. استراتژی کش برای تصاویر
  if (request.destination === 'image') {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        return cachedResponse || fetch(request).then((networkResponse) => {
          return caches.open(DYNAMIC_CACHE).then((cache) => {
            cache.put(request, networkResponse.clone());
            limitCacheSize(DYNAMIC_CACHE, MAX_DYNAMIC_ITEMS);
            return networkResponse;
          });
        });
      })
    );
    return;
  }

  // ۳. استراتژی پیش‌فرض برای سایر درخواست‌ها (Network First)
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});

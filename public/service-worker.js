const STATIC_CACHE_NAME = 'DynamicBoard-static-cache-v7';
const DATA_CACHE_NAME = 'DynamicBoard-data-cache-v7';
const APP_SHELL_FILES = [
	'/',
	'/index.html',
	'/manifest.json',
	'/css/styles.css',
	'/js/app.js',
	'/CharCode.json',
	'/logo.png',
	'/icons/192.png',
	'/icons/512.png',
	'/icons/apple-icon-180.png',
	'/icons/manifest-icon-192.maskable.png',
	'/icons/manifest-icon-512.maskable.png',
];

self.addEventListener('install', event => {
	event.waitUntil(
		caches.open(STATIC_CACHE_NAME).then(cache => cache.addAll(APP_SHELL_FILES)),
	);
	self.skipWaiting();
});

self.addEventListener('activate', event => {
	event.waitUntil(
		caches.keys().then(keys => {
			return Promise.all(
				keys
					.filter(key => key !== STATIC_CACHE_NAME && key !== DATA_CACHE_NAME)
					.map(key => caches.delete(key)),
			);
		}),
	);
	self.clients.claim();
});

function isApiRequest(request) {
	const url = new URL(request.url);
	return url.origin === self.location.origin && url.pathname.startsWith('/api');
}

async function networkFirstApi(request) {
	const cache = await caches.open(DATA_CACHE_NAME);
	try {
		const response = await fetch(request);
		if (response && response.ok) {
			cache.put(request, response.clone());
		}
		return response;
	} catch {
		const cachedResponse = await cache.match(request);
		if (cachedResponse) return cachedResponse;
		return new Response(
			JSON.stringify({
				error: 'Offline and no cached API response available.',
			}),
			{
				status: 503,
				headers: { 'Content-Type': 'application/json' },
			},
		);
	}
}

async function networkFirstNavigation(request) {
	const cache = await caches.open(STATIC_CACHE_NAME);
	try {
		const response = await fetch(request);
		if (response && response.ok) {
			cache.put(request, response.clone());
		}
		return response;
	} catch {
		const cachedResponse =
			(await cache.match(request, { ignoreSearch: true })) ||
			(await cache.match('/index.html')) ||
			(await cache.match('/'));
		if (cachedResponse) return cachedResponse;
		return new Response('Offline', {
			status: 503,
			headers: { 'Content-Type': 'text/plain' },
		});
	}
}

async function cacheFirstAsset(request) {
	const cache = await caches.open(STATIC_CACHE_NAME);
	const cachedResponse = await cache.match(request, { ignoreSearch: true });
	if (cachedResponse) return cachedResponse;

	try {
		const response = await fetch(request);
		if (response && (response.ok || response.type === 'opaque')) {
			cache.put(request, response.clone());
		}
		return response;
	} catch {
		return cache.match(request, { ignoreSearch: true });
	}
}

self.addEventListener('fetch', event => {
	const { request } = event;

	if (request.method !== 'GET') return;

	if (isApiRequest(request)) {
		event.respondWith(networkFirstApi(request));
		return;
	}

	if (request.mode === 'navigate') {
		event.respondWith(networkFirstNavigation(request));
		return;
	}

	if (
		['style', 'script', 'worker', 'image', 'font', 'manifest'].includes(
			request.destination,
		)
	) {
		event.respondWith(cacheFirstAsset(request));
	}
});

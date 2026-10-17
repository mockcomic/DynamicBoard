const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

const tmpConfig = path.join(__dirname, `.api-test-${process.pid}.json`);
process.env.DYNAMICBOARD_DISABLE_MAIN = '1';
process.env.DYNAMICBOARD_CONFIG_PATH = tmpConfig;

fs.writeFileSync(
	tmpConfig,
	JSON.stringify({
		schemaVersion: 2,
		isEnabled: false,
		timer: 120000,
		apiWriteKey: 'seed-key',
		isValidKey: true,
		timezone: 'UTC',
		messages: [],
	}),
);

const app = require('../server');

let baseUrl;
let server;

const originalFetch = global.fetch;

test.before(async () => {
	await new Promise(resolve => {
		server = app.listen(0, '127.0.0.1', () => {
			baseUrl = `http://127.0.0.1:${server.address().port}`;
			resolve();
		});
	});
});

test.after(() => {
	global.fetch = originalFetch;
	// undici keeps sockets alive after fetch(); close them so the process exits.
	server?.closeAllConnections?.();
	server?.close();
	fs.rmSync(tmpConfig, { force: true });
});

const readStoredConfig = () => JSON.parse(fs.readFileSync(tmpConfig, 'utf8'));

test('GET /api redacts the api key and exposes hasApiKey', async () => {
	const res = await fetch(`${baseUrl}/api`);
	assert.equal(res.status, 200);
	const body = await res.json();
	assert.equal(body.apiWriteKey, undefined);
	assert.equal(body.hasApiKey, true);
	assert.equal(body.timezone, 'UTC');
});

test('GET / serves the app shell', async () => {
	const res = await fetch(`${baseUrl}/`);
	assert.equal(res.status, 200);
	const text = await res.text();
	assert.match(text, /Dynamicboard/);
});

test('PUT /api with an invalid payload is rejected with 400', async () => {
	const res = await fetch(`${baseUrl}/api`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ timer: 5 }),
	});
	assert.equal(res.status, 400);
	const body = await res.json();
	assert.match(body.error, /timer/);
	// Stored config untouched.
	assert.equal(readStoredConfig().timer, 120000);
});

test('PUT /api rejects malformed messages with 400', async () => {
	const res = await fetch(`${baseUrl}/api`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ messages: [{ id: 1, type: 'carrier-pigeon', msg: 'x', data: 'x' }] }),
	});
	assert.equal(res.status, 400);
});

test('PUT /api without apiWriteKey keeps the stored key', async () => {
	const res = await fetch(`${baseUrl}/api`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ timer: 90000, messages: [] }),
	});
	assert.equal(res.status, 200);
	const stored = readStoredConfig();
	assert.equal(stored.apiWriteKey, 'seed-key');
	assert.equal(stored.timer, 90000);
});

test('PUT /api with a new key resets the validity flag', async () => {
	const res = await fetch(`${baseUrl}/api`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ apiWriteKey: 'replacement-key' }),
	});
	assert.equal(res.status, 200);
	const stored = readStoredConfig();
	assert.equal(stored.apiWriteKey, 'replacement-key');
	assert.equal(stored.isValidKey, null);
});

test('PUT /api with an empty key clears it', async () => {
	const putRes = await fetch(`${baseUrl}/api`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ apiWriteKey: '' }),
	});
	assert.equal(putRes.status, 200);
	assert.equal(readStoredConfig().apiWriteKey, null);

	const getRes = await fetch(`${baseUrl}/api`);
	const body = await getRes.json();
	assert.equal(body.hasApiKey, false);
});

test('POST /api/send reports missing key when none is configured', async () => {
	const res = await fetch(`${baseUrl}/api/send`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ type: 'text', data: 'hello' }),
	});
	assert.equal(res.status, 400);
	const body = await res.json();
	assert.match(body.error, /Missing API key/);
});

test('POST /api/send forwards text to Vestaboard', async () => {
	await fetch(`${baseUrl}/api`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ apiWriteKey: 'send-key', isValidKey: true }),
	});

	const calls = [];
	const realFetch = global.fetch;
	global.fetch = async (url, options) => {
		calls.push({ url, options });
		return { ok: true, status: 200, statusText: 'OK' };
	};

	const res = await realFetch(`${baseUrl}/api/send`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ type: 'text', data: 'hello board' }),
	});
	global.fetch = originalFetch;

	assert.equal(res.status, 200);
	assert.equal(calls.length, 1);
	assert.equal(calls[0].url, 'https://rw.vestaboard.com/');
	assert.equal(calls[0].options.body, JSON.stringify({ text: 'hello board' }));
});

test('POST /api/send forwards grid JSON strings', async () => {
	const calls = [];
	const realFetch = global.fetch;
	global.fetch = async (url, options) => {
		calls.push({ url, options });
		return { ok: true, status: 201, statusText: 'Created' };
	};

	const grid = JSON.stringify([[1, 2, 3]]);
	const res = await realFetch(`${baseUrl}/api/send`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ type: 'grid', data: grid }),
	});
	global.fetch = originalFetch;

	assert.equal(res.status, 200);
	assert.equal(calls[0].options.body, grid);
});

test('POST /api/send rejects unknown types with 400', async () => {
	const res = await fetch(`${baseUrl}/api/send`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ type: 'morse', data: '...' }),
	});
	assert.equal(res.status, 400);
});

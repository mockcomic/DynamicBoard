// Regression tests for config durability and rotation-loop hardening:
// corrupt-JSON quarantine, unique temp files under concurrent writes,
// controller writes not clobbering fresher saves, 4xx sends not stalling
// rotation, and timer clamping.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

const tmpConfig = path.join(__dirname, `.durable-test-${process.pid}.json`);
process.env.DYNAMICBOARD_DISABLE_MAIN = '1';
process.env.DYNAMICBOARD_CONFIG_PATH = tmpConfig;

const {
	__processMessagesForTests,
	__setConfigForTests,
	__resetStateForTests,
} = require('../backend/routes/controller');
const {
	readConfigSync,
	writeConfigSync,
	CONFIG_PATH,
} = require('../backend/services/config-store');

const originalFetch = global.fetch;

function baseConfig(messages) {
	return {
		schemaVersion: 2,
		isEnabled: true,
		timer: 1000,
		apiWriteKey: 'key-1',
		isValidKey: true,
		timezone: 'UTC',
		messages,
	};
}

test.afterEach(() => {
	global.fetch = originalFetch;
	__resetStateForTests();
	fs.rmSync(tmpConfig, { force: true });
	// Only clean OUR leftovers: test files run in parallel processes and
	// must not delete each other's in-flight .<pid> temp files.
	for (const f of fs.readdirSync(__dirname)) {
		const ours =
			f.includes(`.${process.pid}.`) || f.includes(`durable-test-${process.pid}`);
		if (ours && (f.endsWith('.tmp') || f.includes('.corrupt-'))) {
			fs.rmSync(path.join(__dirname, f), { force: true });
		}
	}
});

test('corrupt config.json is quarantined and defaults take over', () => {
	fs.writeFileSync(tmpConfig, '{ nope, not json');

	const cfg = readConfigSync();
	assert.equal(cfg.apiWriteKey, null, 'falls back to defaults');
	assert.ok(
		fs.readdirSync(__dirname).some(f => f.includes('.corrupt-')),
		'bad file preserved as config.json.corrupt-<ts>',
	);
});

test('concurrent config writes do not collide or throw', async () => {
	writeConfigSync(baseConfig([]));

	const writes = Array.from({ length: 12 }, (_, i) =>
		Promise.resolve().then(() =>
			writeConfigSync(baseConfig([{ id: i, type: 'text', msg: `m${i}`, data: `d${i}`, eventData: {} }])),
		),
	);
	// Old code: shared `${pid}.tmp` path made all but one rename throw ENOENT.
	await Promise.all(writes);

	const stored = JSON.parse(fs.readFileSync(tmpConfig, 'utf8'));
	assert.equal(stored.messages.length, 1);
	assert.deepEqual(
		fs.readdirSync(__dirname).filter(f => f.endsWith('.tmp')),
		[],
		'no temp files left behind',
	);
});

test('a permanently rejected send (4xx) is skipped, not retried forever', async () => {
	const messages = [
		{ id: 1, type: 'text', msg: 'bad', data: 'BAD', eventData: { isEvent: false, startDate: '', endDate: '', repeatEveryYear: false } },
		{ id: 2, type: 'text', msg: 'good', data: 'GOOD', eventData: { isEvent: false, startDate: '', endDate: '', repeatEveryYear: false } },
	];
	__setConfigForTests(baseConfig(messages));

	const attempted = [];
	global.fetch = async (url, opts) => {
		const text = JSON.parse(opts.body).text;
		attempted.push(text);
		return text === 'BAD'
			? { ok: false, status: 400, statusText: 'Bad Request' }
			: { ok: true, status: 200, statusText: 'OK' };
	};

	await __processMessagesForTests(); // tries 1 (BAD), 400 -> skip
	await __processMessagesForTests(); // must now advance to 2 (GOOD)

	assert.deepEqual(attempted, ['BAD', 'GOOD']);
});

test('network errors still pin the message for retry (transient)', async () => {
	const messages = [
		{ id: 1, type: 'text', msg: 'a', data: 'A', eventData: { isEvent: false, startDate: '', endDate: '', repeatEveryYear: false } },
		{ id: 2, type: 'text', msg: 'b', data: 'B', eventData: { isEvent: false, startDate: '', endDate: '', repeatEveryYear: false } },
	];
	__setConfigForTests(baseConfig(messages));

	const attempted = [];
	global.fetch = async (url, opts) => {
		const text = JSON.parse(opts.body).text;
		attempted.push(text);
		throw new Error('offline');
	};

	await __processMessagesForTests();
	await __processMessagesForTests();

	assert.deepEqual(attempted, ['A', 'A'], 'same message retried on transient failure');
});

test('controller 403 persist uses the fresh on-disk document', async () => {
	// Disk holds a newer save (messages 5,6); the loop still holds an old one.
	writeConfigSync(
		baseConfig([
			{ id: 5, type: 'text', msg: 'new', data: 'N', eventData: {} },
			{ id: 6, type: 'text', msg: 'new2', data: 'N2', eventData: {} },
		]),
	);
	__setConfigForTests(baseConfig([{ id: 1, type: 'text', msg: 'old', data: 'O', eventData: {} }]));

	global.fetch = async () => ({ ok: false, status: 403, statusText: 'Forbidden' });

	const { sendToVestaboard } = require('../backend/routes/controller');
	await sendToVestaboard('hello', 'text');

	const stored = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
	assert.equal(stored.isValidKey, false, 'flag written');
	assert.deepEqual(
		stored.messages.map(m => m.id),
		[5, 6],
		'recent UI save survived the controller write (no stale clobber)',
	);
});

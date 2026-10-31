// Regression tests for the rotation loop: an expired non-yearly event is
// auto-deleted mid-iteration, and the loop must survive the array shrinking
// under it (previously the stale index crashed processMessages and killed the
// server via an unhandled rejection in the setTimeout loop).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

const tmpConfig = path.join(__dirname, `.rotation-test-${process.pid}.json`);
process.env.DYNAMICBOARD_DISABLE_MAIN = '1';
process.env.DYNAMICBOARD_CONFIG_PATH = tmpConfig;

const {
	__processMessagesForTests,
	__setConfigForTests,
	__resetStateForTests,
} = require('../backend/routes/controller');

const originalFetch = global.fetch;

function eventMessage(id, startDate, endDate, repeatEveryYear) {
	return {
		id,
		type: 'text',
		msg: `msg ${id}`,
		data: `payload ${id}`,
		eventData: { isEvent: true, startDate, endDate, repeatEveryYear },
	};
}

function plainMessage(id) {
	return {
		id,
		type: 'text',
		msg: `msg ${id}`,
		data: `payload ${id}`,
		eventData: { isEvent: false, startDate: '', endDate: '', repeatEveryYear: false },
	};
}

test.afterEach(() => {
	global.fetch = originalFetch;
	__resetStateForTests();
});

test('rotation survives auto-deletion of an expired event message', async () => {
	fs.writeFileSync(
		tmpConfig,
		JSON.stringify({
			schemaVersion: 2,
			isEnabled: true,
			timer: 1000,
			apiWriteKey: 'key-1',
			isValidKey: true,
			timezone: 'UTC',
			messages: [
				plainMessage(1),
				eventMessage(2, '2020-01-01T00:00', '2020-01-31T23:59', false),
				plainMessage(3),
			],
		}),
	);

	const sends = [];
	global.fetch = async (url, opts) => {
		sends.push(JSON.parse(opts.body).text);
		return { ok: true, status: 200, statusText: 'OK' };
	};

	const cfg = JSON.parse(fs.readFileSync(tmpConfig, 'utf8'));
	__setConfigForTests(cfg);

	// Tick 1: sends msg 1 (lastMsg -> 0).
	await __processMessagesForTests();
	// Tick 2: lands on the expired event (id 2), deletes it; loop must not
	// throw on the now-shorter array and simply moves on.
	await __processMessagesForTests();
	// Tick 3: with only [1, 3] left, rotation still works and sends.
	await __processMessagesForTests();

	const stored = JSON.parse(fs.readFileSync(tmpConfig, 'utf8'));
	assert.deepEqual(
		stored.messages.map(m => m.id),
		[1, 3],
		'expired event removed from persisted config',
	);
	assert.ok(
		sends.includes('payload 3'),
		`rotation kept running after the deletion; sends were ${JSON.stringify(sends)}`,
	);
});

test('rotation stops cleanly when the last message is deleted', async () => {
	fs.writeFileSync(
		tmpConfig,
		JSON.stringify({
			schemaVersion: 2,
			isEnabled: true,
			timer: 1000,
			apiWriteKey: 'key-1',
			isValidKey: true,
			timezone: 'UTC',
			messages: [eventMessage(7, '2020-01-01T00:00', '2020-01-31T23:59', false)],
		}),
	);

	global.fetch = async () => ({ ok: true, status: 200, statusText: 'OK' });

	__setConfigForTests(JSON.parse(fs.readFileSync(tmpConfig, 'utf8')));

	// Should not throw; the only message is an expired event that gets deleted.
	await __processMessagesForTests();

	const stored = JSON.parse(fs.readFileSync(tmpConfig, 'utf8'));
	assert.deepEqual(stored.messages, [], 'expired single event removed');
});

test.after(() => {
	fs.rmSync(tmpConfig, { force: true });
});

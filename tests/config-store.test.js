const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

const tmpConfig = path.join(__dirname, `.config-test-${process.pid}.json`);
process.env.DYNAMICBOARD_CONFIG_PATH = tmpConfig;

const {
	sanitizeConfig,
	toPublicConfig,
	DEFAULT_CONFIG,
	CONFIG_PATH,
	readConfig,
	writeConfig,
	writeConfigSync,
	readConfigSync,
	isValidTimezone,
} = require('../backend/services/config-store');

test.after(() => {
	fs.rmSync(tmpConfig, { force: true });
});

test('CONFIG_PATH honors DYNAMICBOARD_CONFIG_PATH', () => {
	assert.equal(CONFIG_PATH, tmpConfig);
});

test('sanitizeConfig keeps the stored key when the payload omits it', () => {
	const existing = { ...DEFAULT_CONFIG, apiWriteKey: 'secret-key' };
	const out = sanitizeConfig({ timer: 60000 }, existing);
	assert.equal(out.apiWriteKey, 'secret-key');
	assert.equal(out.timer, 60000);
});

test('sanitizeConfig sets a new key and clears stale validity state', () => {
	const existing = { ...DEFAULT_CONFIG, apiWriteKey: 'old', isValidKey: true };
	const out = sanitizeConfig({ apiWriteKey: ' new-key ' }, existing);
	assert.equal(out.apiWriteKey, 'new-key');
	assert.equal(out.isValidKey, null);
});

test('sanitizeConfig accepts explicit validity flag with a new key', () => {
	const existing = { ...DEFAULT_CONFIG, apiWriteKey: 'old' };
	const out = sanitizeConfig({ apiWriteKey: 'new-key', isValidKey: true }, existing);
	assert.equal(out.apiWriteKey, 'new-key');
	assert.equal(out.isValidKey, true);
});

test('sanitizeConfig clears the key with empty string or null', () => {
	const existing = { ...DEFAULT_CONFIG, apiWriteKey: 'secret-key', isValidKey: true };
	assert.equal(sanitizeConfig({ apiWriteKey: '' }, existing).apiWriteKey, null);
	assert.equal(sanitizeConfig({ apiWriteKey: null }, existing).apiWriteKey, null);
});

test('sanitizeConfig rejects out-of-range timers', () => {
	assert.throws(
		() => sanitizeConfig({ timer: 10 }, DEFAULT_CONFIG),
		err => err.statusCode === 400,
	);
	assert.throws(
		() => sanitizeConfig({ timer: 'abc' }, DEFAULT_CONFIG),
		err => err.statusCode === 400,
	);
});

test('sanitizeConfig rejects unknown message types and shapes', () => {
	assert.throws(
		() => sanitizeConfig({ messages: [{ id: 1, type: 'video', msg: '', data: '' }] }, DEFAULT_CONFIG),
		err => err.statusCode === 400,
	);
	assert.throws(
		() => sanitizeConfig({ messages: 'nope' }, DEFAULT_CONFIG),
		err => err.statusCode === 400,
	);
	assert.throws(
		() => sanitizeConfig({ messages: [{ id: 1, type: 'text' }] }, DEFAULT_CONFIG),
		err => err.statusCode === 400,
	);
});

test('sanitizeConfig normalizes messages and fills eventData defaults', () => {
	const out = sanitizeConfig(
		{ messages: [{ id: 7, type: 'text', msg: 'hi', data: 'hi', extra: 'ignored' }] },
		DEFAULT_CONFIG,
	);
	assert.deepEqual(out.messages, [
		{
			id: 7,
			type: 'text',
			msg: 'hi',
			data: 'hi',
			eventData: { isEvent: false, startDate: '', endDate: '', repeatEveryYear: false },
		},
	]);
	assert.equal(out.extra, undefined);
});

test('sanitizeConfig validates timezone strings', () => {
	const out = sanitizeConfig({ timezone: 'America/Los_Angeles' }, DEFAULT_CONFIG);
	assert.equal(out.timezone, 'America/Los_Angeles');

	assert.throws(
		() => sanitizeConfig({ timezone: 'Mars/Olympus' }, DEFAULT_CONFIG),
		err => err.statusCode === 400,
	);
	assert.equal(sanitizeConfig({ timezone: null }, DEFAULT_CONFIG).timezone, null);
	assert.equal(sanitizeConfig({ timezone: '' }, DEFAULT_CONFIG).timezone, null);
});

test('isValidTimezone accepts IANA zones and rejects junk', () => {
	assert.equal(isValidTimezone('UTC'), true);
	assert.equal(isValidTimezone('Europe/Berlin'), true);
	assert.equal(isValidTimezone('Not/AZone'), false);
	assert.equal(isValidTimezone(''), false);
});

test('toPublicConfig redacts the api key and exposes hasApiKey', () => {
	const pub = toPublicConfig({ ...DEFAULT_CONFIG, apiWriteKey: 'shhh' });
	assert.equal(pub.apiWriteKey, undefined);
	assert.equal(pub.hasApiKey, true);
	assert.equal(toPublicConfig({ ...DEFAULT_CONFIG }).hasApiKey, false);
});

test('write/read roundtrip through the async and sync stores', async () => {
	await writeConfig({ ...DEFAULT_CONFIG, timer: 61000 });
	assert.equal((await readConfig()).timer, 61000);

	writeConfigSync({ ...DEFAULT_CONFIG, timer: 62000 });
	assert.equal(readConfigSync().timer, 62000);
});

test('atomic write leaves only the real config file behind', async () => {
	await writeConfig({ ...DEFAULT_CONFIG, timer: 63000 });
	const dir = path.dirname(CONFIG_PATH);
	const leftovers = fs.readdirSync(dir).filter(
		name => name.startsWith(path.basename(CONFIG_PATH)) && name !== path.basename(CONFIG_PATH),
	);
	assert.deepEqual(leftovers, []);
});

test('readConfig creates the default config when the file is missing', async () => {
	fs.rmSync(CONFIG_PATH, { force: true });
	const cfg = await readConfig();
	assert.equal(cfg.apiWriteKey, null);
	assert.equal(cfg.schemaVersion, DEFAULT_CONFIG.schemaVersion);
	assert.ok(fs.existsSync(CONFIG_PATH));
});

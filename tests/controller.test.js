const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const dayjs = require('dayjs');
const utcPlugin = require('dayjs/plugin/utc');
const timezonePlugin = require('dayjs/plugin/timezone');
dayjs.extend(utcPlugin);
dayjs.extend(timezonePlugin);

process.env.DYNAMICBOARD_DISABLE_MAIN = '1';
const {
	checkVariable,
	sendToVestaboard,
	__setConfigForTests,
	__getConfigForTests,
	__resetStateForTests,
} = require('../backend/routes/controller');
const { CONFIG_PATH } = require('../backend/services/config-store');

const originalFetch = global.fetch;
const originalWriteFileSync = fs.writeFileSync;
const originalRenameSync = fs.renameSync;

// Deterministic epoch-day helpers (config is pinned to UTC in tests).
function dayNum(year, month, day) {
	return Date.UTC(year, month - 1, day) / 86400000;
}

function todayNumUtc() {
	const now = dayjs().tz('UTC');
	return dayNum(now.year(), now.month() + 1, now.date());
}

function dateFromDayNum(num) {
	const d = new Date(num * 86400000);
	return {
		year: d.getUTCFullYear(),
		month: d.getUTCMonth() + 1,
		day: d.getUTCDate(),
	};
}

function isValidCalendarDate(month, day, year) {
	const d = new Date(Date.UTC(year, month - 1, day));
	return (
		d.getUTCFullYear() === year &&
		d.getUTCMonth() === month - 1 &&
		d.getUTCDate() === day
	);
}

function getNextOccurrenceNum(month, day, todayN, startYear) {
	for (let year = startYear; year <= startYear + 8; year++) {
		if (!isValidCalendarDate(month, day, year)) continue;
		const candidate = dayNum(year, month, day);
		if (candidate < todayN) continue;
		return candidate;
	}
	return null;
}

test.beforeEach(() => {
	// Pin templates to UTC so expectations don't depend on the machine clock.
	__setConfigForTests({ timezone: 'UTC' });
});

test.afterEach(() => {
	global.fetch = originalFetch;
	fs.writeFileSync = originalWriteFileSync;
	fs.renameSync = originalRenameSync;
	__resetStateForTests();
});

test('tillDate replaces future date placeholder with day difference', () => {
	const t = todayNumUtc();
	const { year, month, day } = dateFromDayNum(t + 10);
	const input = `Event in {tillDate(${month},${day},${year})} days`;

	assert.equal(checkVariable(input), 'Event in 10 days');
});

test('tillDate counts absolute days for a past date', () => {
	const t = todayNumUtc();
	const { year, month, day } = dateFromDayNum(t - 4);
	const input = `Event was {tillDate(${month},${day},${year})} days ago`;

	assert.equal(checkVariable(input), 'Event was 4 days ago');
});

test('tillDate uses yearly occurrence for repeatEveryYear messages', () => {
	const t = todayNumUtc();
	const { year, month, day } = dateFromDayNum(t - 40);
	const next = getNextOccurrenceNum(month, day, t, dayjs().tz('UTC').year());
	const input = `Event in {tillDate(${month},${day},1994)} days`;
	const expected = `Event in ${next - t} days`;

	assert.equal(checkVariable(input, { repeatEveryYear: true }), expected);
});

test('tillDate supports explicit yearly flag as fourth parameter', () => {
	const t = todayNumUtc();
	const { month, day } = dateFromDayNum(t - 1);
	const next = getNextOccurrenceNum(month, day, t, dayjs().tz('UTC').year());
	const input = `Event in {tillDate(${month},${day},1994,true)} days`;
	const expected = `Event in ${next - t} days`;

	assert.equal(checkVariable(input), expected);
});

test('tillDate explicit false flag keeps absolute mode', () => {
	const t = todayNumUtc();
	const { year, month, day } = dateFromDayNum(t - 7);
	const input = `Event was {tillDate(${month},${day},${year},false)} days ago`;

	assert.equal(checkVariable(input, { repeatEveryYear: true }), 'Event was 7 days ago');
});

test('birthday returns Happy Birthday on the exact birthday', () => {
	const t = todayNumUtc();
	const { year, month, day } = dateFromDayNum(t);
	const input = `{birthday(Ada,${month},${day},${year},30)}`;

	assert.equal(checkVariable(input), 'Happy Birthday Ada!');
});

test('birthday returns countdown when inside days-ahead window', () => {
	const t = todayNumUtc();
	const { year, month, day } = dateFromDayNum(t + 5);
	const input = `{birthday("Ada",${month},${day},${year},30)}`;

	assert.equal(checkVariable(input), "Ada's birthday is in 5 days");
});

test('birthday uses default 30-day window when daysAhead is omitted', () => {
	const t = todayNumUtc();
	const { year, month, day } = dateFromDayNum(t + 14);
	const input = `{birthday(Ada,${month},${day},${year})}`;

	assert.equal(checkVariable(input), "Ada's birthday is in 14 days");
});

test('birthday returns empty string when outside days-ahead window', () => {
	const t = todayNumUtc();
	const { year, month, day } = dateFromDayNum(t + 45);
	const input = `{birthday(Ada,${month},${day},${year},30)}`;

	assert.equal(checkVariable(input), '');
});

test('birthday invalid daysAhead is replaced with NaN', () => {
	assert.equal(checkVariable('{birthday(Ada,4,18,1994,abc)}'), 'NaN');
});

test('birthday supports custom countdown and day-of text overrides', () => {
	const t = todayNumUtc();
	const { year, month, day } = dateFromDayNum(t + 3);
	const input =
		`{birthday(Ada,${month},${day},${year},30,"Only {days} {dayLabel} until {name}!","It's {name}'s day!")}`;

	assert.equal(checkVariable(input), 'Only 3 days until Ada!');
});

test('birthday uses custom day-of text override on the birthday', () => {
	const t = todayNumUtc();
	const { year, month, day } = dateFromDayNum(t);
	const input =
		`{birthday(Ada,${month},${day},${year},30,"","Party time for {name}!")}`;

	assert.equal(checkVariable(input), 'Party time for Ada!');
});

test('function parameter parsing keeps commas inside quoted strings', () => {
	const t = todayNumUtc();
	const { year, month, day } = dateFromDayNum(t + 2);
	const input =
		`{birthday(Ada,${month},${day},${year},30,"Heads up, {name}: {days} {dayLabel} left","Happy Birthday, {name}!")}`;

	assert.equal(checkVariable(input), 'Heads up, Ada: 2 days left');
});

test('todayDate replaces no-argument placeholder', () => {
	const output = checkVariable('Today is {todayDate}');

	assert.notEqual(output, 'Today is {todayDate}');
	assert.match(output, /^Today is \d{2}\/\d{2}\/\d{4}$/);
});

test('unknown template function leaves input unchanged', () => {
	assert.equal(checkVariable('Value: {unknown(1)}'), 'Value: {unknown(1)}');
});

test('returns original string when no template exists', () => {
	assert.equal(checkVariable('Static message'), 'Static message');
});

test('malformed placeholder command leaves input unchanged', () => {
	assert.equal(checkVariable('Value: {todayDate(}'), 'Value: {todayDate(}');
});

test('tillDate handles whitespace around arguments', () => {
	const t = todayNumUtc();
	const { year, month, day } = dateFromDayNum(t + 2);
	const input = `In {tillDate( ${month} , ${day} , ${year} )} days`;

	assert.equal(checkVariable(input), 'In 2 days');
});

test('tillDate invalid date is replaced with NaN', () => {
	assert.equal(checkVariable('Value {tillDate(2,30,2026)}'), 'Value NaN');
});

test('tillDate invalid numeric arguments are replaced with NaN', () => {
	assert.equal(checkVariable('Value {tillDate(a,10,2026)}'), 'Value NaN');
});

test('multiple placeholders in one message are all replaced', () => {
	const iso = checkVariable('Date {todayIso}');
	const output = checkVariable('{todayIso} and {todayDate}');

	assert.match(output, /^\d{4}-\d{2}-\d{2} and \d{2}\/\d{2}\/\d{4}$/);
	assert.notEqual(iso, 'Date {todayIso}');
});

test('templates resolve against the configured time zone', () => {
	__setConfigForTests({ timezone: 'Pacific/Kiritimati' });
	const expected = dayjs().tz('Pacific/Kiritimati').format('YYYY-MM-DD');

	assert.equal(checkVariable('{todayIso}'), expected);
});

test('invalid configured time zone falls back to the system zone', () => {
	__setConfigForTests({ timezone: 'Not/AZone' });
	const expected = dayjs().tz(dayjs.tz.guess()).format('YYYY-MM-DD');

	assert.equal(checkVariable('{todayIso}'), expected);
});

test('todayIso returns date in YYYY-MM-DD format', () => {
	const output = checkVariable('ISO {todayIso()}');
	assert.match(output, /^ISO \d{4}-\d{2}-\d{2}$/);
});

test('nowTime returns time in HH:mm format', () => {
	const output = checkVariable('Time {nowTime()}');
	assert.match(output, /^Time \d{2}:\d{2}$/);
});

test('sendToVestaboard reports missing api key when not configured', async () => {
	let fetchCalled = false;
	global.fetch = async () => {
		fetchCalled = true;
		return { ok: true, status: 200, statusText: 'OK' };
	};

	const result = await sendToVestaboard('hello world', 'text');
	assert.deepEqual(result, {
		ok: false,
		status: 400,
		statusText: 'missing_api_key',
	});
	assert.equal(fetchCalled, false);
});

test('sendToVestaboard posts text payload when api key exists', async () => {
	const calls = [];
	global.fetch = async (url, options) => {
		calls.push({ url, options });
		return { ok: true, status: 200, statusText: 'OK' };
	};

	__setConfigForTests({ apiWriteKey: 'key-123', isValidKey: true });

	const result = await sendToVestaboard('hello world', 'text');
	assert.deepEqual(result, { ok: true, status: 200, statusText: 'OK' });
	assert.equal(calls.length, 1);
	assert.equal(calls[0].url, 'https://rw.vestaboard.com/');
	assert.equal(calls[0].options.method, 'POST');
	assert.equal(calls[0].options.body, JSON.stringify({ text: 'hello world' }));
	assert.equal(
		calls[0].options.headers['X-Vestaboard-Read-Write-Key'],
		'key-123',
	);
	assert.ok(calls[0].options.signal, 'fetch must use an abort signal timeout');
});

test('sendToVestaboard posts grid payload when type is grid', async () => {
	const calls = [];
	global.fetch = async (url, options) => {
		calls.push({ url, options });
		return { ok: true, status: 201, statusText: 'Created' };
	};

	__setConfigForTests({ apiWriteKey: 'key-xyz', isValidKey: true });
	const gridPayload = [
		[1, 2, 3],
		[4, 5, 6],
	];

	const result = await sendToVestaboard(gridPayload, 'grid');
	assert.deepEqual(result, { ok: true, status: 201, statusText: 'Created' });
	assert.equal(calls.length, 1);
	assert.equal(calls[0].options.body, JSON.stringify(gridPayload));
});

test('sendToVestaboard parses stored grid JSON strings', async () => {
	const calls = [];
	global.fetch = async (url, options) => {
		calls.push({ url, options });
		return { ok: true, status: 201, statusText: 'Created' };
	};

	__setConfigForTests({ apiWriteKey: 'key-xyz', isValidKey: true });
	const gridPayload = [[1, 2]];

	const result = await sendToVestaboard(JSON.stringify(gridPayload), 'grid');
	assert.deepEqual(result, { ok: true, status: 201, statusText: 'Created' });
	assert.equal(calls[0].options.body, JSON.stringify(gridPayload));
});

test('sendToVestaboard rejects malformed grid strings without fetching', async () => {
	let fetchCalled = false;
	global.fetch = async () => {
		fetchCalled = true;
		return { ok: true };
	};

	__setConfigForTests({ apiWriteKey: 'key-xyz', isValidKey: true });

	const result = await sendToVestaboard('not-json', 'grid');
	assert.deepEqual(result, {
		ok: false,
		status: 400,
		statusText: 'invalid_grid_payload',
	});
	assert.equal(fetchCalled, false);
});

test('sendToVestaboard marks key invalid and persists config on 403', async () => {
	const writes = [];
	const renames = [];
	fs.writeFileSync = (path, value) => {
		writes.push({ path, value });
	};
	fs.renameSync = (from, to) => {
		renames.push({ from, to });
	};
	global.fetch = async () => ({
		ok: false,
		status: 403,
		statusText: 'Forbidden',
	});

	__setConfigForTests({ apiWriteKey: 'bad-key', isValidKey: true });

	const result = await sendToVestaboard('hello world', 'text');
	assert.deepEqual(result, { ok: false, status: 403, statusText: 'Forbidden' });
	assert.equal(__getConfigForTests().isValidKey, false);
	assert.equal(writes.length, 1, 'atomic write should stage one temp file');
	assert.ok(writes[0].path.startsWith(CONFIG_PATH));
	assert.notEqual(writes[0].path, CONFIG_PATH, 'staged via temp file');
	assert.deepEqual(renames, [{ from: writes[0].path, to: CONFIG_PATH }]);
	assert.equal(JSON.parse(writes[0].value).isValidKey, false);
});

test('sendToVestaboard returns network_error and persists config on fetch failure', async () => {
	const writes = [];
	fs.writeFileSync = (path, value) => {
		writes.push({ path, value });
	};
	fs.renameSync = () => {};
	global.fetch = async () => {
		throw new Error('network down');
	};

	__setConfigForTests({ apiWriteKey: 'key-123', isValidKey: true });

	const result = await sendToVestaboard('hello world', 'text');
	assert.deepEqual(result, {
		ok: false,
		status: 0,
		statusText: 'network_error',
	});
	assert.equal(writes.length, 1);
});

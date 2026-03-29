const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const moment = require('moment');

process.env.DYNAMICBOARD_DISABLE_MAIN = '1';
const {
	checkVariable,
	sendToVestaboard,
	__setConfigForTests,
	__getConfigForTests,
	__resetStateForTests,
} = require('../backend/routes/controller');

const originalFetch = global.fetch;
const originalWriteFileSync = fs.writeFileSync;

function getNextOccurrence(month, day, today = moment().startOf('day')) {
	const startYear = today.year();
	for (let year = startYear; year <= startYear + 8; year++) {
		const candidate = moment(
			`${year}-${month}-${day}`,
			'YYYY-M-D',
			true
		).startOf('day');
		if (!candidate.isValid()) continue;
		if (candidate.isBefore(today)) continue;
		return candidate;
	}
	return null;
}

test.afterEach(() => {
	global.fetch = originalFetch;
	fs.writeFileSync = originalWriteFileSync;
	__resetStateForTests();
});

test('tillDate replaces future date placeholder with day difference', () => {
	const today = moment().startOf('day');
	const target = today.clone().add(10, 'days');
	const input = `Event in {tillDate(${target.format('M,D,YYYY')})} days`;
	const expected = `Event in ${target.diff(today, 'days')} days`;

	assert.equal(checkVariable(input), expected);
});

test('tillDate counts absolute days for a past date', () => {
	const today = moment().startOf('day');
	const target = today.clone().subtract(4, 'days');
	const input = `Event was {tillDate(${target.format('M,D,YYYY')})} days ago`;
	const expected = `Event was ${Math.abs(target.diff(today, 'days'))} days ago`;

	assert.equal(checkVariable(input), expected);
});

test('tillDate uses yearly occurrence for repeatEveryYear messages', () => {
	const today = moment().startOf('day');
	const target = today.clone().subtract(40, 'days');
	const month = Number(target.format('M'));
	const day = Number(target.format('D'));
	const nextOccurrence = getNextOccurrence(month, day, today);
	const input = `Event in {tillDate(${month},${day},1994)} days`;
	const expected = `Event in ${nextOccurrence.diff(today, 'days')} days`;

	assert.equal(checkVariable(input, { repeatEveryYear: true }), expected);
});

test('tillDate supports explicit yearly flag as fourth parameter', () => {
	const today = moment().startOf('day');
	const target = today.clone().subtract(1, 'day');
	const month = Number(target.format('M'));
	const day = Number(target.format('D'));
	const nextOccurrence = getNextOccurrence(month, day, today);
	const input = `Event in {tillDate(${month},${day},1994,true)} days`;
	const expected = `Event in ${nextOccurrence.diff(today, 'days')} days`;

	assert.equal(checkVariable(input), expected);
});

test('birthday returns Happy Birthday on the exact birthday', () => {
	const today = moment().startOf('day');
	const month = today.format('M');
	const day = today.format('D');
	const input = `{birthday(Ada,${month},${day},1994,30)}`;

	assert.equal(checkVariable(input), 'Happy Birthday Ada!');
});

test('birthday returns countdown when inside days-ahead window', () => {
	const today = moment().startOf('day');
	const target = today.clone().add(5, 'days');
	const month = target.format('M');
	const day = target.format('D');
	const input = `{birthday("Ada",${month},${day},1994,30)}`;

	assert.equal(checkVariable(input), "Ada's birthday is in 5 days");
});

test('birthday returns empty string when outside days-ahead window', () => {
	const today = moment().startOf('day');
	const target = today.clone().add(45, 'days');
	const month = target.format('M');
	const day = target.format('D');
	const input = `{birthday(Ada,${month},${day},1994,30)}`;

	assert.equal(checkVariable(input), '');
});

test('todayDate replaces no-argument placeholder', () => {
	const output = checkVariable('Today is {todayDate()}');

	assert.notEqual(output, 'Today is {todayDate()}');
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
	const today = moment().startOf('day');
	const target = today.clone().add(2, 'days');
	const input = `In {tillDate( ${target.format('M')} , ${target.format('D')} , ${target.format('YYYY')} )} days`;
	const expected = `In ${target.diff(today, 'days')} days`;

	assert.equal(checkVariable(input), expected);
});

test('tillDate invalid date is replaced with NaN', () => {
	assert.equal(checkVariable('Value {tillDate(2,30,2026)}'), 'Value NaN');
});

test('tillDate invalid numeric arguments are replaced with NaN', () => {
	assert.equal(checkVariable('Value {tillDate(a,10,2026)}'), 'Value NaN');
});

test('todayDate placeholder also works without parentheses', () => {
	const expected = `Date ${new Date()
		.toISOString()
		.slice(0, 10)
		.split('-')
		.reverse()
		.join('/')}`;

	assert.equal(checkVariable('Date {todayDate}'), expected);
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
		'key-123'
	);
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

test('sendToVestaboard marks key invalid and persists config on 403', async () => {
	const writes = [];
	fs.writeFileSync = (path, value) => {
		writes.push({ path, value });
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
	assert.equal(writes.length, 1);
	assert.equal(writes[0].path, './config.json');
	assert.equal(JSON.parse(writes[0].value).isValidKey, false);
});

test('sendToVestaboard returns network_error and persists config on fetch failure', async () => {
	const writes = [];
	fs.writeFileSync = (path, value) => {
		writes.push({ path, value });
	};
	global.fetch = async () => {
		throw new Error('network down');
	};

	__setConfigForTests({ apiWriteKey: 'key-123', isValidKey: true });

	const result = await sendToVestaboard('hello world', 'text');
	assert.deepEqual(result, { ok: false, status: 0, statusText: 'network_error' });
	assert.equal(writes.length, 1);
	assert.equal(writes[0].path, './config.json');
});

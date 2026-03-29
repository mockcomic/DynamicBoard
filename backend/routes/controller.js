const moment = require('moment');
const { logInfo, logWarn, logError } = require('../utils/logger');
const {
	ensureConfigSync,
	readConfigSync,
	writeConfigSync,
} = require('../services/config-store');

let config = null;
let isLooping = false;
let runtimeData = null;
let intervalId = null;
let lastMsg = null;

const TRUE_VALUES = new Set(['true', '1', 'yes', 'y', 'yearly', 'repeat']);
const FALSE_VALUES = new Set(['false', '0', 'no', 'n']);

function parseBooleanFlag(value) {
	if (value == null || value === '') return null;
	const normalized = String(value).trim().toLowerCase();
	if (TRUE_VALUES.has(normalized)) return true;
	if (FALSE_VALUES.has(normalized)) return false;
	return null;
}

function removeOuterQuotes(value) {
	if (typeof value !== 'string') return '';
	const trimmed = value.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1).trim();
	}
	return trimmed;
}

function buildStrictDate(month, day, year) {
	return moment(`${year}-${month}-${day}`, 'YYYY-M-D', true).startOf('day');
}

function getNextYearlyOccurrence(month, day, today) {
	const startYear = today.year();
	for (let year = startYear; year <= startYear + 8; year++) {
		const candidate = buildStrictDate(month, day, year);
		if (!candidate.isValid()) continue;
		if (candidate.isBefore(today)) continue;
		return candidate;
	}
	return null;
}

const functionCalls = {
	tillDate: {
		name: 'tillDate',
		description:
			'Returns the difference in days between today and the given date.',
		callBack: (arr, context = {}) => {
			const [monthRaw, dayRaw, yearRaw, repeatRaw] = arr;
			const month = Number(monthRaw);
			const day = Number(dayRaw);
			const year = Number(yearRaw);

			if (![month, day, year].every(Number.isFinite)) {
				logWarn('Invalid tillDate arguments', { args: arr });
				return NaN;
			}

			const targetDate = buildStrictDate(month, day, year);

			if (!targetDate.isValid()) {
				logWarn('Invalid tillDate date', { args: arr });
				return NaN;
			}

			const today = moment().startOf('day');
			const repeatFlag = parseBooleanFlag(repeatRaw);
			const isYearly =
				repeatFlag != null
					? repeatFlag
					: context?.repeatEveryYear === true;

			if (isYearly) {
				const nextOccurrence = getNextYearlyOccurrence(month, day, today);
				if (!nextOccurrence) {
					logWarn('Invalid yearly tillDate date', { args: arr });
					return NaN;
				}
				return nextOccurrence.diff(today, 'days');
			}

			return Math.abs(targetDate.diff(today, 'days'));
		},
	},
	birthday: {
		name: 'birthday',
		description:
			'Returns a birthday countdown in a display window and switches to Happy Birthday on the day.',
		callBack: arr => {
			const [nameRaw, monthRaw, dayRaw, yearRaw, daysAheadRaw = '30'] = arr;
			const month = Number(monthRaw);
			const day = Number(dayRaw);
			const year = Number(yearRaw);
			const daysAhead = Number(daysAheadRaw);

			if (![month, day, year, daysAhead].every(Number.isFinite) || daysAhead < 0) {
				logWarn('Invalid birthday arguments', { args: arr });
				return NaN;
			}

			const birthDate = buildStrictDate(month, day, year);
			if (!birthDate.isValid()) {
				logWarn('Invalid birthday date', { args: arr });
				return NaN;
			}

			const today = moment().startOf('day');
			const nextBirthday = getNextYearlyOccurrence(month, day, today);
			if (!nextBirthday) {
				logWarn('Invalid next birthday occurrence', { args: arr });
				return NaN;
			}

			const safeName = removeOuterQuotes(nameRaw);
			const daysUntil = nextBirthday.diff(today, 'days');
			if (daysUntil === 0) {
				return safeName ? `Happy Birthday ${safeName}!` : 'Happy Birthday!';
			}
			if (daysUntil > daysAhead) {
				return '';
			}

			const dayLabel = daysUntil === 1 ? 'day' : 'days';
			const prefix = safeName ? `${safeName}'s birthday` : 'Birthday';
			return `${prefix} is in ${daysUntil} ${dayLabel}`;
		},
	},
	todayDate: {
		name: 'todayDate',
		description: 'Returns todays date.',
		callBack: () => {
			return new Date().toISOString().slice(0, 10).split('-').reverse().join('/');
		},
	},
	todayIso: {
		name: 'todayIso',
		description: 'Returns today in YYYY-MM-DD format.',
		callBack: () => {
			return new Date().toISOString().slice(0, 10);
		},
	},
	nowTime: {
		name: 'nowTime',
		description: 'Returns current local time in HH:mm format.',
		callBack: () => {
			return moment().format('HH:mm');
		},
	},
};

function persistConfig(nextConfig) {
	try {
		writeConfigSync(nextConfig);
	} catch (error) {
		logError('Failed to write config.json', error);
	}
}

function loadConfig() {
	try {
		ensureConfigSync();
		config = readConfigSync();
		if (!config.apiWriteKey) {
			logWarn('No API key found in config.json. Please add it.');
		}
		return config;
	} catch (error) {
		logError('Failed to load config.json', error);
		return config;
	}
}

function checkVariable(string, context = {}) {
	const match = string.match(/\{(.+?)\}/);
	if (!match) return string;

	const [placeholder, command] = match;
	const commandMatch = command.match(/^([a-zA-Z0-9_]+)(?:\((.*)\))?$/);
	if (!commandMatch) return string;

	const [, functionName, rawParams = ''] = commandMatch;
	const params =
		rawParams === ''
			? []
			: rawParams.split(',').map(param => param.trim());

	if (functionCalls[functionName]) {
		const result = functionCalls[functionName].callBack(params, context);
		logInfo('Template variable replaced', {
			placeholder,
			result,
		});
		return string.replace(placeholder, result);
	}

	return string;
}

async function sendToVestaboard(data, dataType) {
	logInfo('Sending to Vestaboard', { type: dataType });
	if (!config?.apiWriteKey) {
		logWarn('Missing apiWriteKey, cannot send to Vestaboard');
		return { ok: false, status: 400, statusText: 'missing_api_key' };
	}
	try {
		const body =
			dataType === 'grid'
				? JSON.stringify(data)
				: JSON.stringify({ text: data });

		const res = await fetch('https://rw.vestaboard.com/', {
			body,
			headers: {
				'Content-Type': 'application/json',
				'X-Vestaboard-Read-Write-Key': config.apiWriteKey,
			},
			method: 'POST',
		});
		logInfo('Vestaboard response', {
			status: res.status,
			statusText: res.statusText,
		});
		if (res.status === 403) {
			logWarn('Invalid apiWriteKey, isValidKey set to false');
			config.isValidKey = false;
			persistConfig(config);
		}
		return { ok: res.ok, status: res.status, statusText: res.statusText };
	} catch (error) {
		logError('Error in sendToVestaboard', error);
		if (config) {
			persistConfig(config);
		}
		return { ok: false, status: 0, statusText: 'network_error' };
	}
}

function deleteMessage(id) {
	if (!Array.isArray(runtimeData?.messages)) return;

	const filteredData = runtimeData.messages.filter(message => {
		logInfo('Evaluating message for delete', {
			messageId: message.id,
			targetId: id,
			match: message.id == id,
		});
		return message.id != id;
	});

	runtimeData.messages = filteredData;
	config = runtimeData;
	persistConfig(runtimeData);
	logInfo('Deleted message from config', { id });
}

async function processEvent(messageData) {
	const { eventData } = messageData;
	if (!eventData.startDate || !eventData.endDate) return;

	const isYearly = eventData.repeatEveryYear;

	const now = moment();
	const startRaw = moment(eventData.startDate);
	const endRaw = moment(eventData.endDate);

	if (!startRaw.isValid() || !endRaw.isValid()) return false;

	let start = startRaw;
	let end = endRaw;

	if (isYearly) {
		// Repeat every year based on month/day/time, including ranges that span the year boundary.
		start = startRaw.clone().year(now.year());
		end = endRaw.clone().year(now.year());

		if (end.isBefore(start)) {
			// Example: Dec 1 - Feb 25 should wrap into the next year.
			if (now.isBefore(end)) {
				start = start.subtract(1, 'year');
			} else {
				end = end.add(1, 'year');
			}
		}
	} else if (end.isBefore(start)) {
		logWarn('Invalid date range on message', { id: messageData.id });
		return false;
	}

	logInfo('Event range check', {
		id: messageData.id,
		isYearly,
		start: start.toISOString(),
		end: end.toISOString(),
	});
	if (now.isBetween(start, end, undefined, '[]')) {
		logInfo('Event is within range', { id: messageData.id });
		return true;
	} else if (!isYearly && now.isAfter(end)) {
		logInfo('Deleting expired non-yearly message', { id: messageData.id });
		await deleteMessage(messageData.id);
	}

	return false;
}

async function processMessages() {
	if (!runtimeData?.isEnabled) {
		logInfo('Message loop disabled');
		isLooping = false;
		return;
	}

	const len = Array.isArray(runtimeData?.messages) ? runtimeData.messages.length : 0;
	if (len === 0) {
		logInfo('No messages to process');
		isLooping = false;
		return;
	}

	let idx = lastMsg == null ? 0 : (lastMsg + 1) % len;

	for (let attempts = 0; attempts < len; attempts++) {
		const messageData = runtimeData.messages[idx];

		if (messageData?.eventData?.isEvent === true) {
			const validMessage = await processEvent(messageData);
			if (!validMessage) {
				runtimeData = loadConfig();
				idx = (idx + 1) % len;
				continue;
			}
		}

		if (messageData?.type === 'grid') {
			await sendToVestaboard(messageData.data, 'grid');
		} else if (messageData?.type === 'text') {
			const msg = checkVariable(messageData.data, {
				repeatEveryYear: messageData?.eventData?.repeatEveryYear === true,
			});
			if (!String(msg).trim()) {
				logInfo('Skipping empty rendered text message', {
					id: messageData.id,
				});
				idx = (idx + 1) % len;
				continue;
			}
			await sendToVestaboard(msg, 'text');
		}

		lastMsg = idx;
		logInfo('Processed message', { id: messageData.id, index: idx });
		return;
	}

	isLooping = false;
}

function loopMessages() {
	if (isLooping) return;

	isLooping = true;
	logInfo('Starting message loop');

	const loop = async function () {
		await processMessages();

		if (runtimeData && runtimeData.isEnabled) {
			// Schedule next loop using the updated timer
			intervalId = setTimeout(loop, runtimeData.timer);
		} else {
			isLooping = false;
			clearTimeout(intervalId);
			logInfo('Stopping message loop');
		}
	};

	loop();
}

function main() {
	setInterval(() => {
		const nextConfig = loadConfig();
		if (!nextConfig?.apiWriteKey) {
			return;
		}

		const wasEnabled = runtimeData?.isEnabled;
		const timerChanged = runtimeData?.timer !== nextConfig.timer;

		runtimeData = nextConfig;

		if (runtimeData.isEnabled && (!wasEnabled || timerChanged)) {
			logInfo('Updating loop with new timer', { timer: runtimeData.timer });
			clearTimeout(intervalId);
			isLooping = false;
			loopMessages();
		}
	}, 5000);
}

if (process.env.DYNAMICBOARD_DISABLE_MAIN !== '1') {
	main();
}

function __setConfigForTests(nextConfig) {
	config = nextConfig;
	runtimeData = nextConfig;
}

function __getConfigForTests() {
	return config;
}

function __resetStateForTests() {
	clearTimeout(intervalId);
	intervalId = null;
	config = null;
	runtimeData = null;
	lastMsg = null;
	isLooping = false;
}

module.exports = {
	checkVariable: checkVariable,
	sendToVestaboard: sendToVestaboard,
	__setConfigForTests,
	__getConfigForTests,
	__resetStateForTests,
};

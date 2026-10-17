const dayjs = require('dayjs');
const utcPlugin = require('dayjs/plugin/utc');
const timezonePlugin = require('dayjs/plugin/timezone');
const isBetweenPlugin = require('dayjs/plugin/isBetween');
const { logInfo, logWarn, logError } = require('../utils/logger');
const {
	ensureConfigSync,
	readConfigSync,
	writeConfigSync,
	isValidTimezone,
} = require('../services/config-store');

dayjs.extend(utcPlugin);
dayjs.extend(timezonePlugin);
dayjs.extend(isBetweenPlugin);

const SEND_TIMEOUT_MS = 10000;

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

function splitFunctionParams(rawParams) {
	if (rawParams == null || rawParams === '') return [];

	const result = [];
	let current = '';
	let quoteChar = null;

	for (let i = 0; i < rawParams.length; i++) {
		const ch = rawParams[i];
		const prev = i > 0 ? rawParams[i - 1] : '';

		if ((ch === '"' || ch === "'") && prev !== '\\') {
			if (quoteChar === ch) {
				quoteChar = null;
			} else if (!quoteChar) {
				quoteChar = ch;
			}
			current += ch;
			continue;
		}

		if (ch === ',' && !quoteChar) {
			result.push(current.trim());
			current = '';
			continue;
		}

		current += ch;
	}

	result.push(current.trim());
	return result;
}

function renderBirthdayTemplate(template, safeName, daysUntil, dayLabel) {
	return template
		.replaceAll('{name}', safeName)
		.replaceAll('{days}', String(daysUntil))
		.replaceAll('{dayLabel}', dayLabel);
}

function findTemplatePlaceholder(input) {
	if (typeof input !== 'string' || input.length === 0) return null;

	for (let i = 0; i < input.length; i++) {
		if (input[i] !== '{') continue;

		let j = i + 1;
		while (j < input.length && /[a-zA-Z0-9_]/.test(input[j])) j++;
		if (j === i + 1) continue;

		if (input[j] === '}') {
			const placeholder = input.slice(i, j + 1);
			const command = input.slice(i + 1, j);
			return { placeholder, command };
		}

		if (input[j] !== '(') continue;

		let k = j + 1;
		let depth = 1;
		let quoteChar = null;

		while (k < input.length) {
			const ch = input[k];
			const prev = k > 0 ? input[k - 1] : '';

			if ((ch === '"' || ch === "'") && prev !== '\\') {
				if (quoteChar === ch) {
					quoteChar = null;
				} else if (!quoteChar) {
					quoteChar = ch;
				}
				k++;
				continue;
			}

			if (!quoteChar) {
				if (ch === '(') depth++;
				if (ch === ')') depth--;

				if (depth === 0) {
					if (input[k + 1] === '}') {
						const placeholder = input.slice(i, k + 2);
						const command = input.slice(i + 1, k + 1);
						return { placeholder, command };
					}
					break;
				}
			}

			k++;
		}
	}

	return null;
}

// --- Timezone helpers -------------------------------------------------------

function resolveTimezone() {
	const tz = config?.timezone;
	if (typeof tz === 'string' && isValidTimezone(tz)) return tz;
	// Fall back to the server's system zone instead of UTC so "today" matches
	// the board owner's calendar day.
	return dayjs.tz.guess();
}

// Calendar dates are compared as epoch-day numbers so daylight-saving days
// (23/25 hours) can never shift a day difference.
function toDayNumber(year, month, day) {
	return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

function todayDayNumber(tz) {
	const now = dayjs().tz(tz);
	return toDayNumber(now.year(), now.month() + 1, now.date());
}

/**
 * Returns the epoch-day number for month/day/year, or null when the calendar
 * date does not exist (e.g. Feb 30) or the arguments are out of range.
 */
function buildStrictDate(month, day, year) {
	if (![month, day, year].every(Number.isInteger)) return null;
	if (month < 1 || month > 12 || day < 1 || day > 31) return null;
	if (year < 1000 || year > 9999) return null;
	const d = new Date(Date.UTC(year, month - 1, day));
	if (
		d.getUTCFullYear() !== year ||
		d.getUTCMonth() !== month - 1 ||
		d.getUTCDate() !== day
	) {
		return null;
	}
	return Math.floor(d.getTime() / 86400000);
}

function getNextYearlyOccurrence(month, day, todayNum, startYear) {
	for (let year = startYear; year <= startYear + 8; year++) {
		const candidate = buildStrictDate(month, day, year);
		if (candidate == null) continue; // e.g. Feb 29 in a non-leap year
		if (candidate < todayNum) continue;
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

			const targetNum = buildStrictDate(month, day, year);
			if (targetNum == null) {
				logWarn('Invalid tillDate date', { args: arr });
				return NaN;
			}

			const tz = resolveTimezone();
			const todayNum = todayDayNumber(tz);
			const repeatFlag = parseBooleanFlag(repeatRaw);
			const isYearly =
				repeatFlag != null ? repeatFlag : context?.repeatEveryYear === true;

			if (isYearly) {
				const nextOccurrence = getNextYearlyOccurrence(
					month,
					day,
					todayNum,
					dayjs().tz(tz).year(),
				);
				if (nextOccurrence == null) {
					logWarn('Invalid yearly tillDate date', { args: arr });
					return NaN;
				}
				return nextOccurrence - todayNum;
			}

			return Math.abs(targetNum - todayNum);
		},
	},
	birthday: {
		name: 'birthday',
		description:
			'Returns a birthday countdown and switches to a birthday message on the day. Supports optional custom text overrides.',
		callBack: arr => {
			const [
				nameRaw,
				monthRaw,
				dayRaw,
				yearRaw,
				daysAheadRaw = '30',
				daysToTextRaw = '',
				dayOfTextRaw = '',
			] = arr;
			const month = Number(monthRaw);
			const day = Number(dayRaw);
			const year = Number(yearRaw);
			const daysAhead = Number(daysAheadRaw);

			if (
				![month, day, year, daysAhead].every(Number.isFinite) ||
				daysAhead < 0
			) {
				logWarn('Invalid birthday arguments', { args: arr });
				return NaN;
			}

			if (buildStrictDate(month, day, year) == null) {
				logWarn('Invalid birthday date', { args: arr });
				return NaN;
			}

			const tz = resolveTimezone();
			const now = dayjs().tz(tz);
			const todayNum = todayDayNumber(tz);
			const nextBirthday = getNextYearlyOccurrence(
				month,
				day,
				todayNum,
				now.year(),
			);
			if (nextBirthday == null) {
				logWarn('Invalid next birthday occurrence', { args: arr });
				return NaN;
			}

			const safeName = removeOuterQuotes(nameRaw);
			const daysToTextTemplate = removeOuterQuotes(daysToTextRaw);
			const dayOfTextTemplate = removeOuterQuotes(dayOfTextRaw);
			const daysUntil = nextBirthday - todayNum;
			const dayLabel = daysUntil === 1 ? 'day' : 'days';

			if (daysUntil === 0) {
				if (dayOfTextTemplate) {
					return renderBirthdayTemplate(
						dayOfTextTemplate,
						safeName,
						daysUntil,
						dayLabel,
					);
				}
				return safeName ? `Happy Birthday ${safeName}!` : 'Happy Birthday!';
			}
			if (daysUntil > daysAhead) {
				return '';
			}

			if (daysToTextTemplate) {
				return renderBirthdayTemplate(
					daysToTextTemplate,
					safeName,
					daysUntil,
					dayLabel,
				);
			}

			const prefix = safeName ? `${safeName}'s birthday` : 'Birthday';
			return `${prefix} is in ${daysUntil} ${dayLabel}`;
		},
	},
	todayDate: {
		name: 'todayDate',
		description: 'Returns today\'s date in the configured time zone.',
		callBack: () => dayjs().tz(resolveTimezone()).format('DD/MM/YYYY'),
	},
	todayIso: {
		name: 'todayIso',
		description: 'Returns today in YYYY-MM-DD format (configured time zone).',
		callBack: () => dayjs().tz(resolveTimezone()).format('YYYY-MM-DD'),
	},
	nowTime: {
		name: 'nowTime',
		description:
			'Returns current time in HH:mm format (configured time zone).',
		callBack: () => dayjs().tz(resolveTimezone()).format('HH:mm'),
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
	if (typeof string !== 'string') return string;

	let output = string;
	// Replace every placeholder (previously only the first was handled).
	for (let guard = 0; guard < 20; guard++) {
		const match = findTemplatePlaceholder(output);
		if (!match) break;

		const { placeholder, command } = match;
		const commandMatch = command.match(/^([a-zA-Z0-9_]+)(?:\((.*)\))?$/);
		if (!commandMatch) break;

		const [, functionName, rawParams = ''] = commandMatch;
		const fn = functionCalls[functionName];
		if (!fn) break;

		const params = splitFunctionParams(rawParams);
		const result = fn.callBack(params, context);
		logInfo('Template variable replaced', { placeholder, result });

		// Function-valued replacement avoids `$&`-style patterns in results.
		const next = output.replace(placeholder, () => String(result));
		if (next === output) break;
		output = next;
	}

	return output;
}

async function sendToVestaboard(data, dataType) {
	logInfo('Sending to Vestaboard', { type: dataType });
	if (!config?.apiWriteKey) {
		logWarn('Missing apiWriteKey, cannot send to Vestaboard');
		return { ok: false, status: 400, statusText: 'missing_api_key' };
	}
	try {
		let payload = data;
		if (dataType === 'grid' && typeof payload === 'string') {
			// Grid messages are stored as JSON strings; send the parsed array so
			// the board receives a real grid instead of an encoded string.
			try {
				payload = JSON.parse(payload);
			} catch {
				logWarn('Invalid grid payload', { sample: payload.slice(0, 40) });
				return { ok: false, status: 400, statusText: 'invalid_grid_payload' };
			}
		}

		const body =
			dataType === 'grid'
				? JSON.stringify(payload)
				: JSON.stringify({ text: data });

		const res = await fetch('https://rw.vestaboard.com/', {
			body,
			headers: {
				'Content-Type': 'application/json',
				'X-Vestaboard-Read-Write-Key': config.apiWriteKey,
			},
			method: 'POST',
			// Without a timeout a hung request stalls the rotation loop forever.
			signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
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

	const tz = resolveTimezone();
	const now = dayjs().tz(tz);
	const startRaw = dayjs.tz(eventData.startDate, tz);
	const endRaw = dayjs.tz(eventData.endDate, tz);

	if (!startRaw.isValid() || !endRaw.isValid()) return false;

	// Re-stamp a date onto another year, preserving the wall-clock time in tz.
	const withYear = (dj, year) =>
		dayjs.tz(`${year}${dj.format('MM-DDTHH:mm')}`, tz);

	let start = startRaw;
	let end = endRaw;

	if (isYearly) {
		// Repeat every year based on month/day/time, including ranges that span the year boundary.
		start = withYear(startRaw, now.year());
		end = withYear(endRaw, now.year());

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
	if (now.isBetween(start, end, null, true)) {
		logInfo('Event is within range', { id: messageData.id });
		return true;
	} else if (!isYearly && now.isAfter(end)) {
		logInfo('Deleting expired non-yearly message', { id: messageData.id });
		deleteMessage(messageData.id);
	}

	return false;
}

async function processMessages() {
	if (!runtimeData?.isEnabled) {
		logInfo('Message loop disabled');
		isLooping = false;
		return;
	}

	const len = Array.isArray(runtimeData?.messages)
		? runtimeData.messages.length
		: 0;
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

		let result;
		if (messageData?.type === 'grid') {
			result = await sendToVestaboard(messageData.data, 'grid');
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
			result = await sendToVestaboard(msg, 'text');
		}

		if (result && !result.ok) {
			// Transient failure (offline board, outage, timeout): keep the same
			// message selected so the next tick retries it instead of skipping.
			logWarn('Send failed; will retry this message on the next tick', {
				id: messageData.id,
				status: result.status,
				statusText: result.statusText,
			});
			return;
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

// Reload config.json and (re)start the rotation loop when needed. Called both
// from the file poll below and right after PUT /api writes (via
// notifyConfigChanged) so changes apply immediately.
function reloadConfig() {
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
}

function notifyConfigChanged() {
	reloadConfig();
}

function main() {
	// Fast path for UI-driven changes; the poll is a fallback for manual edits.
	setInterval(reloadConfig, 5000);
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
	checkVariable,
	sendToVestaboard,
	notifyConfigChanged,
	__setConfigForTests,
	__getConfigForTests,
	__resetStateForTests,
};

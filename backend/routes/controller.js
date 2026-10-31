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
const MIN_TIMER_MS = 1000;
const MAX_TIMER_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TIMER_MS = 120000;

let config = null;
let isLooping = false;
let runtimeData = null;
let intervalId = null;
let lastMsg = null;
// Supersedes in-flight loop iterations whenever the rotator restarts.
let loopGeneration = 0;
// Last loop-relevant state observed by reloadConfig (drives restart checks).
let lastLoopEnabled = false;
let lastLoopTimer = null;
let lastUnreadableConfigLog = 0;

function logWarnThrottled(message) {
	const now = Date.now();
	if (now - lastUnreadableConfigLog > 60000) {
		lastUnreadableConfigLog = now;
		logWarn(message);
	}
}

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
	let result = trimmed;
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		result = trimmed.slice(1, -1);
	}
	// Undo the \" / \' escaping the client applies so escaped quotes render
	// as plain quotes on the board instead of literal backslashes.
	return result.replace(/\\(["'])/g, '$1').trim();
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

// Re-read from disk before mutating so controller writes never clobber a
// recent PUT /api save with a stale in-memory copy (read-modify-write).
function persistMutation(mutate) {
	let target;
	try {
		target = readConfigSync();
	} catch {
		target = config ?? runtimeData;
	}
	mutate(target);
	config = target;
	runtimeData = target;
	persistConfig(target);
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
			persistMutation(target => {
				target.isValidKey = false;
			});
		} else if (res.ok && config && config.isValidKey === false) {
			// A send that worked proves the key: clear a stale invalid banner.
			persistMutation(target => {
				target.isValidKey = true;
			});
		}
		return { ok: res.ok, status: res.status, statusText: res.statusText };
	} catch (error) {
		// Transient failure (board offline, DNS hiccup): do NOT rewrite
		// config.json here — nothing changed and a stale document would
		// clobber recent UI saves.
		logError('Error in sendToVestaboard', error);
		return { ok: false, status: 0, statusText: 'network_error' };
	}
}

function deleteMessage(id) {
	if (!Array.isArray(runtimeData?.messages)) return;

	persistMutation(target => {
		if (!Array.isArray(target.messages)) target.messages = [];
		const filtered = target.messages.filter(
			message => String(message.id) !== String(id),
		);
		logInfo('Evaluating message for delete', {
			messageId: id,
			removed: filtered.length !== target.messages.length,
		});
		target.messages = filtered;
	});
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
	// A Feb 29 event must not silently roll into Mar 1 in non-leap years:
	// advance to the next year where that calendar date exists (mirrors
	// getNextYearlyOccurrence's behavior for tillDate/birthday).
	const withYear = (dj, year) => {
		let y = year;
		while (buildStrictDate(dj.month() + 1, dj.date(), y) == null) y++;
		return dayjs.tz(`${y}${dj.format('MM-DDTHH:mm')}`, tz);
	};

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
		// The message list can shrink mid-loop (processEvent auto-deletes
		// expired events), so re-read the array bounds every iteration and
		// skip indexes that no longer exist instead of crashing on undefined.
		const currentLen = Array.isArray(runtimeData?.messages)
			? runtimeData.messages.length
			: 0;
		if (currentLen === 0) {
			logInfo('No messages left to process');
			isLooping = false;
			return;
		}
		idx = idx % currentLen;
		const messageData = runtimeData.messages[idx];
		if (!messageData) {
			idx = (idx + 1) % currentLen;
			continue;
		}

		if (messageData.eventData?.isEvent === true) {
			const validMessage = await processEvent(messageData);
			if (!validMessage) {
				runtimeData = loadConfig() || runtimeData;
				idx = (idx + 1) % (runtimeData?.messages?.length || 1);
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
			if (!String(msg).trim() || /NaN/.test(String(msg))) {
				logInfo('Skipping unrenderable text message', {
					id: messageData.id,
				});
				idx = (idx + 1) % currentLen;
				continue;
			}
			result = await sendToVestaboard(msg, 'text');
		}

		if (result && !result.ok) {
			// Permanent rejection (4xx other than 429): the board will never
			// accept this payload, so advance past it instead of stalling the
			// rotation on one bad message forever.
			const permanent =
				result.status >= 400 && result.status < 500 && result.status !== 429;
			if (permanent) {
				// next tick starts at idx+1, leaving this bad message behind
				lastMsg = idx;
				logWarn('Send permanently rejected; skipping message', {
					id: messageData.id,
					status: result.status,
					statusText: result.statusText,
				});
				return;
			}
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
	const myToken = ++loopGeneration;
	logInfo('Starting message loop');

	const loop = async function () {
		try {
			await processMessages();
		} catch (error) {
			// A throw here previously surfaced as an unhandled rejection that
			// (via isLooping staying true) permanently deadlocked the rotator.
			logError('Message loop iteration failed', error);
		}

		// A config reload may have started a newer loop while we awaited;
		// an orphan reschedules itself no more.
		if (myToken !== loopGeneration) return;

		if (runtimeData && runtimeData.isEnabled) {
			// Schedule next loop using the updated timer, clamped so a
			// hand-edited config can't spin the loop at ~1ms.
			const timer = clampTimer(runtimeData.timer);
			intervalId = setTimeout(loop, timer);
		} else {
			isLooping = false;
			clearTimeout(intervalId);
			logInfo('Stopping message loop');
		}
	};

	loop();
}

function clampTimer(timer) {
	const num = Number(timer);
	if (!Number.isFinite(num) || num < MIN_TIMER_MS || num > MAX_TIMER_MS) {
		logWarn('Config timer out of range; clamping', { timer });
		if (!Number.isFinite(num)) return DEFAULT_TIMER_MS;
		return Math.min(Math.max(num, MIN_TIMER_MS), MAX_TIMER_MS);
	}
	return num;
}

// Reload config.json and (re)start the rotation loop when needed. Called both
// from the file poll below and right after PUT /api writes (via
// notifyConfigChanged) so changes apply immediately.
function reloadConfig() {
	const nextConfig = loadConfig();

	if (!nextConfig) {
		// config.json unreadable (corrupt): keep rotating on the last good
		// config, but don't hammer the log every 5s about the same file.
		logWarnThrottled('Keeping last config; config.json is unreadable');
		return;
	}

	runtimeData = nextConfig;

	if (!nextConfig.apiWriteKey) {
		// Keyless: nothing to rotate to. Make sure a running loop is stopped
		// so the old document isn't retried forever.
		if (intervalId || isLooping) {
			loopGeneration++;
			clearTimeout(intervalId);
			intervalId = null;
			isLooping = false;
			logInfo('No API key configured; message loop stopped');
		}
		return;
	}

	const wasEnabled = lastLoopEnabled;
	const timerChanged = lastLoopTimer !== nextConfig.timer;
	lastLoopEnabled = nextConfig.isEnabled;
	lastLoopTimer = nextConfig.timer;

	if (nextConfig.isEnabled && (!wasEnabled || timerChanged)) {
		logInfo('Updating loop with new timer', { timer: nextConfig.timer });
		loopGeneration++; // supersede any in-flight iteration
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
	loopGeneration++;
	lastLoopEnabled = false;
	lastLoopTimer = null;
}

module.exports = {
	checkVariable,
	sendToVestaboard,
	notifyConfigChanged,
	__processMessagesForTests: processMessages,
	__setConfigForTests,
	__getConfigForTests,
	__resetStateForTests,
};

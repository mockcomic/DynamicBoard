const fs = require('fs');
const path = require('path');

// Resolve against the project root instead of the process cwd, so the app
// behaves the same when launched from another directory (or as a pkg binary).
// An explicit path can be provided via DYNAMICBOARD_CONFIG_PATH.
const CONFIG_PATH = process.env.DYNAMICBOARD_CONFIG_PATH
	? path.resolve(process.env.DYNAMICBOARD_CONFIG_PATH)
	: path.join(__dirname, '..', '..', 'config.json');

const SCHEMA_VERSION = 2;

const MIN_TIMER_MS = 1000;
const MAX_TIMER_MS = 24 * 60 * 60 * 1000;

const DEFAULT_CONFIG = Object.freeze({
	schemaVersion: SCHEMA_VERSION,
	isEnabled: true,
	timer: 120000,
	apiWriteKey: null,
	isValidKey: null,
	timezone: null,
	messages: [],
});

function cloneDefaultConfig() {
	return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

function serializeConfig(config) {
	return JSON.stringify(config, null, 2);
}

// Write via a temp file + rename so a crash mid-write can never leave a
// truncated config.json behind (rename is atomic on POSIX and Windows).
function atomicWriteSync(file, data) {
	const tmp = `${file}.${process.pid}.tmp`;
	fs.writeFileSync(tmp, data);
	fs.renameSync(tmp, file);
}

async function atomicWriteAsync(file, data) {
	const tmp = `${file}.${process.pid}.tmp`;
	await fs.promises.writeFile(tmp, data);
	await fs.promises.rename(tmp, file);
}

function isValidTimezone(value) {
	if (typeof value !== 'string' || !value) return false;
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: value });
		return true;
	} catch {
		return false;
	}
}

function validationError(message) {
	const err = new Error(message);
	err.statusCode = 400;
	return err;
}

function normalizeEventData(input) {
	const source = input && typeof input === 'object' ? input : {};
	return {
		isEvent: source.isEvent === true,
		startDate: typeof source.startDate === 'string' ? source.startDate : '',
		endDate: typeof source.endDate === 'string' ? source.endDate : '',
		repeatEveryYear: source.repeatEveryYear === true,
	};
}

function normalizeMessage(input, index) {
	if (!input || typeof input !== 'object' || Array.isArray(input)) {
		throw validationError(`messages[${index}] must be an object`);
	}
	if (input.type !== 'grid' && input.type !== 'text') {
		throw validationError(
			`messages[${index}].type must be "grid" or "text"`,
		);
	}
	if (input.id == null) {
		throw validationError(`messages[${index}].id is required`);
	}
	if (typeof input.msg !== 'string') {
		throw validationError(`messages[${index}].msg must be a string`);
	}
	if (
		typeof input.data !== 'string' &&
		!Array.isArray(input.data) &&
		input.data != null
	) {
		throw validationError(`messages[${index}].data must be a string or array`);
	}

	return {
		id: input.id,
		type: input.type,
		msg: input.msg,
		data: input.data == null ? '' : input.data,
		eventData: normalizeEventData(input.eventData),
	};
}

/**
 * Merge a client-supplied config payload onto the stored config.
 *
 * Secret handling: the API key is never echoed to clients (GET redacts it),
 * so an absent/null `apiWriteKey` in a PUT means "keep the stored key".
 * An empty string clears it (used by the UI's reset action).
 */
function sanitizeConfig(input, existing) {
	const base = existing || cloneDefaultConfig();
	const source = input && typeof input === 'object' ? input : {};

	// isEnabled
	let isEnabled = base.isEnabled;
	if (source.isEnabled !== undefined) {
		if (typeof source.isEnabled !== 'boolean') {
			throw validationError('isEnabled must be a boolean');
		}
		isEnabled = source.isEnabled;
	}

	// timer
	let timer = base.timer;
	if (source.timer !== undefined) {
		const num = Number(source.timer);
		if (!Number.isFinite(num) || num < MIN_TIMER_MS || num > MAX_TIMER_MS) {
			throw validationError(
				`timer must be between ${MIN_TIMER_MS} and ${MAX_TIMER_MS} ms`,
			);
		}
		timer = num;
	}

	// apiWriteKey
	let apiWriteKey = base.apiWriteKey ?? null;
	if (source.apiWriteKey === null || source.apiWriteKey === '') {
		apiWriteKey = null;
	} else if (typeof source.apiWriteKey === 'string') {
		apiWriteKey = source.apiWriteKey.trim() || null;
	} else if (source.apiWriteKey !== undefined) {
		throw validationError('apiWriteKey must be a string');
	}

	// isValidKey
	let isValidKey = base.isValidKey ?? null;
	if (source.isValidKey === null || source.isValidKey === undefined) {
		// undefined/null from a redacted client payload keeps stored state,
		// except when the key itself changed (a new key is unverified again).
		if (apiWriteKey !== (base.apiWriteKey ?? null)) isValidKey = null;
	} else if (typeof source.isValidKey === 'boolean') {
		isValidKey = source.isValidKey;
	} else {
		throw validationError('isValidKey must be a boolean or null');
	}

	// timezone
	let timezone = base.timezone ?? null;
	if (source.timezone === null || source.timezone === '') {
		timezone = null;
	} else if (typeof source.timezone === 'string') {
		if (!isValidTimezone(source.timezone.trim())) {
			throw validationError(
				`timezone "${source.timezone}" is not a valid IANA time zone`,
			);
		}
		timezone = source.timezone.trim();
	} else if (source.timezone !== undefined) {
		throw validationError('timezone must be a string or null');
	}

	// messages
	let messages = base.messages;
	if (source.messages !== undefined) {
		if (!Array.isArray(source.messages)) {
			throw validationError('messages must be an array');
		}
		messages = source.messages.map(normalizeMessage);
	}

	return {
		schemaVersion: SCHEMA_VERSION,
		isEnabled,
		timer,
		apiWriteKey,
		isValidKey,
		timezone,
		messages,
	};
}

/** Client-safe view of the config: the API key never leaves the backend. */
function toPublicConfig(config) {
	return {
		schemaVersion: config.schemaVersion ?? SCHEMA_VERSION,
		isEnabled: config.isEnabled,
		timer: config.timer,
		isValidKey: config.isValidKey ?? null,
		timezone: config.timezone ?? null,
		hasApiKey: Boolean(config.apiWriteKey),
		messages: Array.isArray(config.messages) ? config.messages : [],
	};
}

function ensureConfigSync() {
	if (!fs.existsSync(CONFIG_PATH)) {
		const defaultConfig = cloneDefaultConfig();
		atomicWriteSync(CONFIG_PATH, serializeConfig(defaultConfig));
		return defaultConfig;
	}

	return readConfigSync();
}

function readConfigSync() {
	const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
	return JSON.parse(raw);
}

function writeConfigSync(data) {
	atomicWriteSync(CONFIG_PATH, serializeConfig(data));
}

async function readConfig() {
	try {
		const raw = await fs.promises.readFile(CONFIG_PATH, 'utf8');
		return JSON.parse(raw);
	} catch (err) {
		if (err && err.code === 'ENOENT') {
			const defaultConfig = cloneDefaultConfig();
			await atomicWriteAsync(CONFIG_PATH, serializeConfig(defaultConfig));
			return defaultConfig;
		}
		throw err;
	}
}

async function writeConfig(data) {
	await atomicWriteAsync(CONFIG_PATH, serializeConfig(data));
}

module.exports = {
	CONFIG_PATH,
	DEFAULT_CONFIG,
	SCHEMA_VERSION,
	ensureConfigSync,
	readConfigSync,
	writeConfigSync,
	readConfig,
	writeConfig,
	sanitizeConfig,
	toPublicConfig,
	isValidTimezone,
};

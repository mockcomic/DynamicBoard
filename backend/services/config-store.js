const fs = require('fs');
const path = require('path');
const { logWarn } = require('../utils/logger');

// Resolve against the project root instead of the process cwd, so the app
// behaves the same when launched from another directory (or as a pkg binary).
// An explicit path can be provided via DYNAMICBOARD_CONFIG_PATH.
// Under pkg, __dirname lives in the read-only snapshot, so default to the
// directory beside the executable — that is the only place a packaged app
// can bootstrap and persist its config.
const CONFIG_PATH = process.env.DYNAMICBOARD_CONFIG_PATH
	? path.resolve(process.env.DYNAMICBOARD_CONFIG_PATH)
	: process.pkg
		? path.join(path.dirname(process.execPath), 'config.json')
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
	// 'cloud' posts via rw.vestaboard.com; 'local' talks to the board's
	// Local API on port 7000 (no internet round-trip).
	transport: 'cloud',
	localBoard: { address: null, apiKey: null },
});

function cloneDefaultConfig() {
	return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

function serializeConfig(config) {
	return JSON.stringify(config, null, 2);
}

// Write via a temp file + rename so a crash mid-write can never leave a
// truncated config.json behind (rename is atomic on POSIX and Windows).
// The temp name is unique per write: concurrent writers (overlapping PUTs,
// or a sync controller write racing an async route write) previously shared
// one `${pid}.tmp` path and corrupted each other's renames.
function tmpPathFor(file) {
	return `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
}

// config.json holds the Vestaboard API key: never group/world-readable.
const WRITE_OPTIONS = { mode: 0o600 };

function atomicWriteSync(file, data) {
	const tmp = tmpPathFor(file);
	try {
		fs.writeFileSync(tmp, data, WRITE_OPTIONS);
		fs.chmodSync(tmp, 0o600); // survive a pre-existing tmp's mode
		fs.renameSync(tmp, file);
	} catch (err) {
		fs.rmSync(tmp, { force: true });
		throw err;
	}
}

async function atomicWriteAsync(file, data) {
	const tmp = tmpPathFor(file);
	try {
		await fs.promises.writeFile(tmp, data, WRITE_OPTIONS);
		await fs.promises.chmod(tmp, 0o600);
		await fs.promises.rename(tmp, file);
	} catch (err) {
		await fs.promises.rm(tmp, { force: true }).catch(() => {});
		throw err;
	}
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

	// transport
	let transport = base.transport ?? 'cloud';
	if (source.transport !== undefined) {
		if (source.transport !== 'cloud' && source.transport !== 'local') {
			throw validationError('transport must be "cloud" or "local"');
		}
		transport = source.transport;
	}

	// localBoard: {address, apiKey}. apiKey is a secret like the cloud key:
	// absent/null keeps the stored value, '' clears it, redacted in GET.
	let localBoard = {
		address: base.localBoard?.address ?? null,
		apiKey: base.localBoard?.apiKey ?? null,
	};
	if (source.localBoard !== undefined) {
		const src = source.localBoard;
		if (!src || typeof src !== 'object' || Array.isArray(src)) {
			throw validationError('localBoard must be an object');
		}
		if (src.address === undefined) {
			// keep stored address
		} else if (typeof src.address === 'string') {
			const a = src.address.trim().toLowerCase();
			if (!a) localBoard.address = null;
			else if (
				!/^(\d{1,3}(\.\d{1,3}){3}|[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)*|[a-f0-9:]+(\.local)?)$/i.test(
					a,
				)
			) {
				throw validationError('localBoard.address is not a valid IP or hostname');
			} else {
				localBoard.address = a;
			}
		} else if (src.address === null) {
			localBoard.address = null;
		} else {
			throw validationError('localBoard.address must be a string or null');
		}
		if (src.apiKey === null || src.apiKey === '') {
			localBoard.apiKey = null;
		} else if (typeof src.apiKey === 'string') {
			localBoard.apiKey = src.apiKey.trim() || null;
		} else if (src.apiKey !== undefined) {
			throw validationError('localBoard.apiKey must be a string');
		}
	}

	// messages
	let messages = base.messages;
	if (source.messages !== undefined) {
		if (!Array.isArray(source.messages)) {
			throw validationError('messages must be an array');
		}
		messages = source.messages.map(normalizeMessage);
		const seen = new Set(messages.map(m => String(m.id)));
		if (seen.size !== messages.length) {
			throw validationError('message ids must be unique');
		}
	}

	return {
		schemaVersion: SCHEMA_VERSION,
		isEnabled,
		timer,
		apiWriteKey,
		isValidKey,
		timezone,
		transport,
		localBoard,
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
		transport: config.transport ?? 'cloud',
		// Local key is a secret too: clients see only whether one is set.
		localBoard: {
			address: config.localBoard?.address ?? null,
			hasApiKey: Boolean(config.localBoard?.apiKey),
		},
		hasApiKey: Boolean(config.apiWriteKey),
		messages: Array.isArray(config.messages) ? config.messages : [],
	};
}

// A corrupt config.json (bad hand edit, power loss) must not brick the app:
// quarantine the unreadable file and fall back to defaults so the UI can
// recover by re-saving (GET then shows hasApiKey=false and prompts for it).
function quarantineCorruptConfig(err) {
	const stamp = new Date().toISOString().replace(/[:.]/g, '-');
	const badPath = `${CONFIG_PATH}.corrupt-${stamp}`;
	try {
		fs.renameSync(CONFIG_PATH, badPath);
	} catch {
		// rename failed (permissions?); fall back to defaults anyway.
	}
	logConfigCorruption(`config.json was unreadable (${err.message}); moved to ${badPath}`);
	return cloneDefaultConfig();
}

let lastCorruptionLog = 0;
function logConfigCorruption(message) {
	const now = Date.now();
	if (now - lastCorruptionLog > 60000) {
		lastCorruptionLog = now;
		logWarn(message);
	}
}

function parseConfig(raw) {
	try {
		return JSON.parse(raw);
	} catch (err) {
		return quarantineCorruptConfig(err);
	}
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
	return parseConfig(raw);
}

function writeConfigSync(data) {
	atomicWriteSync(CONFIG_PATH, serializeConfig(data));
}

async function readConfig() {
	try {
		const raw = await fs.promises.readFile(CONFIG_PATH, 'utf8');
		return parseConfig(raw);
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

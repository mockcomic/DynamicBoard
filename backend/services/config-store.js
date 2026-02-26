const fs = require('fs');

const CONFIG_PATH = './config.json';

const DEFAULT_CONFIG = Object.freeze({
	isEnabled: true,
	timer: 120000,
	apiWriteKey: null,
	isValidKey: null,
	messages: [],
});

function cloneDefaultConfig() {
	return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

function ensureConfigSync() {
	if (!fs.existsSync(CONFIG_PATH)) {
		const defaultConfig = cloneDefaultConfig();
		fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig));
		return defaultConfig;
	}

	return readConfigSync();
}

function readConfigSync() {
	const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
	return JSON.parse(raw);
}

function writeConfigSync(data) {
	fs.writeFileSync(CONFIG_PATH, JSON.stringify(data));
}

async function readConfig() {
	try {
		const raw = await fs.promises.readFile(CONFIG_PATH, 'utf8');
		return JSON.parse(raw);
	} catch (err) {
		if (err && err.code === 'ENOENT') {
			const defaultConfig = cloneDefaultConfig();
			await fs.promises.writeFile(CONFIG_PATH, JSON.stringify(defaultConfig));
			return defaultConfig;
		}
		throw err;
	}
}

async function writeConfig(data) {
	await fs.promises.writeFile(CONFIG_PATH, JSON.stringify(data));
}

module.exports = {
	CONFIG_PATH,
	DEFAULT_CONFIG,
	ensureConfigSync,
	readConfigSync,
	writeConfigSync,
	readConfig,
	writeConfig,
};

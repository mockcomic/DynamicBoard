function normalizeMeta(meta) {
	if (meta instanceof Error) {
		return { message: meta.message, stack: meta.stack };
	}
	return meta;
}

function log(level, message, meta) {
	const ts = new Date().toISOString();
	const prefix = `[${ts}] [${level.toUpperCase()}] ${message}`;
	const output = normalizeMeta(meta);

	switch (level) {
		case 'error':
			output !== undefined ? console.error(prefix, output) : console.error(prefix);
			break;
		case 'warn':
			output !== undefined ? console.warn(prefix, output) : console.warn(prefix);
			break;
		default:
			output !== undefined ? console.log(prefix, output) : console.log(prefix);
			break;
	}
}

function logInfo(message, meta) {
	log('info', message, meta);
}

function logWarn(message, meta) {
	log('warn', message, meta);
}

function logError(message, meta) {
	log('error', message, meta);
}

module.exports = { logInfo, logWarn, logError };

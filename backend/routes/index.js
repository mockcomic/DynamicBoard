const express = require('express');
const path = require('path');
const router = express.Router();
const { logInfo, logWarn, logError } = require('../utils/logger');
const {
	readConfig,
	writeConfig,
	sanitizeConfig,
	toPublicConfig,
} = require('../services/config-store');

const {
	sendToVestaboard,
	checkVariable,
	notifyConfigChanged,
} = require('./controller');

const INDEX_PATH = path.join(__dirname, '..', '..', 'public', 'index.html');

router.get('/api', async (req, res) => {
	res.setHeader('Cache-Control', 'no-store');
	try {
		logInfo('GET /api', { ip: req.ip });
		const data = await readConfig();
		// Redact the API key: the browser never needs the secret itself, only
		// whether one is configured (hasApiKey).
		res.status(200).json(toPublicConfig(data));
	} catch (err) {
		logError('Failed GET /api', err);
		res.status(500).json({ error: 'Failed to read config' });
	}
});

router.put('/api', async (req, res) => {
	res.setHeader('Cache-Control', 'no-store');
	try {
		const existing = await readConfig();
		const next = sanitizeConfig(req.body, existing);
		await writeConfig(next);
		logInfo('PUT /api', { ip: req.ip });
		// Apply the new config to the rotation loop without waiting for the poll.
		notifyConfigChanged();
		res.status(200).json({ ok: true });
	} catch (err) {
		if (err && err.statusCode === 400) {
			logWarn('PUT /api rejected invalid config', { message: err.message });
			return res.status(400).json({ error: err.message });
		}
		logError('Failed PUT /api', err);
		return res.status(500).json({ error: 'Error updating JSON' });
	}
});

router.get('/', (req, res) => {
	res.setHeader('Cache-Control', 'no-store');
	res.sendFile(INDEX_PATH);
});

router.post('/api/send', async (req, res) => {
	res.setHeader('Cache-Control', 'no-store');
	const { type, data } = req.body || {};
	logInfo('POST /api/send', { ip: req.ip, type });

	if (!type || !data) {
		logWarn('POST /api/send missing payload', { type, hasData: !!data });
		return res.status(400).json({ error: 'Missing type or data' });
	}

	try {
		const mapVestaboardError = result => {
			const status = result?.status && result.status > 0 ? result.status : 502;
			const error =
				status === 403
					? 'Invalid API key'
					: status === 400
						? 'Missing API key'
						: 'Failed to send to Vestaboard';
			return { status, error };
		};

		if (type === 'grid') {
			const result = await sendToVestaboard(data, 'grid');
			if (!result?.ok) {
				const { status, error } = mapVestaboardError(result);
				return res.status(status).json({
					error,
					details: result?.statusText,
				});
			}
		} else if (type === 'text') {
			const msg = checkVariable(data);
			if (!String(msg).trim()) {
				return res.status(400).json({
					error: 'Message resolved to empty text',
					details:
						'Template output is empty (for example, birthday message outside the configured days-ahead window).',
				});
			}
			const result = await sendToVestaboard(msg, 'text');
			if (!result?.ok) {
				const { status, error } = mapVestaboardError(result);
				return res.status(status).json({
					error,
					details: result?.statusText,
				});
			}
		} else {
			return res.status(400).json({ error: 'Invalid message type' });
		}

		return res.status(200).json({ ok: true });
	} catch (err) {
		logError('POST /api/send failed', err);
		return res.status(500).json({ error: 'Server error' });
	}
});

module.exports = router;

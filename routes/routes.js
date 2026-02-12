const express = require('express');
const fs = require('fs');
const router = express.Router();
const { logInfo, logWarn, logError } = require('../backend/utils/logger');

const {
	sendToVestaboard,
	checkVariable,
} = require('../backend/routes/controller');

router.get('/api', async (req, res) => {
	res.setHeader('Cache-Control', 'no-store');
	try {
		const data = await fs.promises.readFile('config.json', 'utf8');
		res.status(200).json(JSON.parse(data));
		logInfo('GET /api', { ip: req.ip });
	} catch (err) {
		logError('Failed GET /api', err);
		res.status(500).json({ error: 'Failed to read config' });
	}
});

router.put('/api', (req, res) => {
	res.setHeader('Cache-Control', 'no-store');
	const msg = JSON.stringify(req.body);
	fs.writeFile('config.json', msg, err => {
		if (err) {
			logError('Failed PUT /api', err);
			return res.status(500).json({ error: 'Error updating JSON' });
		}
		logInfo('PUT /api', { ip: req.ip });
		res.status(200).json({ ok: true });
	});
});

router.get('/', (req, res) => {
	res.setHeader('Cache-Control', 'no-store');
	res.render('index');
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
		if (type === 'grid') {
			const payload = JSON.parse(data);
			const result = await sendToVestaboard(payload, 'grid');
			if (!result?.ok) {
				const status =
					result?.status && result.status > 0 ? result.status : 502;
				const error =
					status === 403
						? 'Invalid API key'
						: status === 400
							? 'Missing API key'
							: 'Failed to send to Vestaboard';
				return res.status(status).json({
					error,
					details: result?.statusText,
				});
			}
		} else if (type === 'text') {
			const msg = checkVariable(data);
			const result = await sendToVestaboard(msg, 'text');
			if (!result?.ok) {
				const status =
					result?.status && result.status > 0 ? result.status : 502;
				const error =
					status === 403
						? 'Invalid API key'
						: status === 400
							? 'Missing API key'
							: 'Failed to send to Vestaboard';
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

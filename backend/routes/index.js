const express = require('express');
const path = require('path');
const router = express.Router();
const { logInfo, logWarn, logError } = require('../utils/logger');

// Serialize read-modify-write on config.json so overlapping PUTs can't lose
// updates or collide on the (now-unique, but still last-writer-wins) rename.
let writeQueue = Promise.resolve();
function withConfigLock(fn) {
	const next = writeQueue.then(fn, fn);
	writeQueue = next.catch(() => {});
	return next;
}
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
	discoverLocalBoards,
	enableLocalApi,
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
		await withConfigLock(async () => {
			const existing = await readConfig();
			const next = sanitizeConfig(req.body, existing);
			await writeConfig(next);
		});
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
			// sendToVestaboard reports internal failures as status 0 with a
			// machine-readable statusText; don't mislabel those as key issues.
			const reason = result?.statusText;
			let error;
			if (reason === 'missing_api_key') {
				error = 'Missing API key';
			} else if (reason === 'no_local_board') {
				error = 'No board selected — scan for boards in Settings';
			} else if (reason === 'missing_local_key') {
				error = 'Board is missing its local key — enable the Local API in Settings';
			} else if (reason === 'local_api_not_enabled') {
				error = 'Local API is not enabled on this board yet — enter your enablement token in Settings';
			} else if (reason === 'bad_local_key') {
				error = 'Local API key was rejected by the board';
			} else if (reason === 'local_unreachable') {
				error = 'Could not reach the board on the local network';
			} else if (reason === 'invalid_grid_payload') {
				error = 'Saved grid message is malformed';
			} else if (reason === 'network_error') {
				error = 'Could not reach the Vestaboard service';
			} else if (status === 403) {
				error = 'Invalid API key';
			} else if (reason?.startsWith?.('Unsupported characters')) {
				error = reason;
			} else {
				error = 'Failed to send to Vestaboard';
			}
			return {
				status:
					reason === 'missing_api_key' ||
					reason === 'no_local_board' ||
					reason === 'missing_local_key'
						? 400
						: status,
				error,
			};
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
			// A template that evaluated to NaN means bad function args — and
			// String(NaN) would sail past the empty check and print 'NaN'.
			if (!String(msg).trim() || /NaN/.test(String(msg))) {
				return res.status(400).json({
					error: 'Message could not be rendered',
					details:
						'Template output is empty or invalid (for example a birthday date like Feb 30, or a message outside its days-ahead window).',
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

// LAN discovery: parallel probe of :7000 across the given subnet prefix,
// classified by the board's Server header (AirTunes noise is filtered out).
router.post('/api/discover', async (req, res) => {
	res.setHeader('Cache-Control', 'no-store');
	let subnet = String(req.body?.subnet || '').trim();
	if (!subnet) {
		// Default to the caller's /24: the server and its users share the LAN.
		const ip = String(req.ip || '').replace('::ffff:', '');
		const parts = ip.split('.');
		if (parts.length === 4) subnet = parts.slice(0, 3).join('.');
	}
	try {
		const result = await discoverLocalBoards(subnet);
		res.status(200).json(result);
	} catch (err) {
		if (err.statusCode === 400) {
			return res.status(400).json({ error: err.message });
		}
		logError('POST /api/discover failed', err);
		res.status(500).json({ error: 'Discovery scan failed' });
	}
});

// One-time Local API enablement: exchanges the emailed token for the
// board's permanent local key. The key is returned exactly once, straight
// to this caller — it gets stored server-side and never echoed again.
router.post('/api/local/enable', async (req, res) => {
	res.setHeader('Cache-Control', 'no-store');
	const { address, token } = req.body || {};
	if (!address || !token) {
		return res.status(400).json({ error: 'Missing address or token' });
	}
	try {
		const result = await enableLocalApi(address, String(token).trim());
		if (result.status !== 200) {
			let detail = `HTTP ${result.status}`;
			try {
				detail = JSON.parse(result.body)?.message || detail;
			} catch {}
			return res
				.status(result.status === 403 ? 403 : 502)
				.json({ error: `Board rejected the token: ${detail}` });
		}
		let apiKey = null;
		let message = '';
		try {
			const parsed = JSON.parse(result.body);
			apiKey = parsed.apiKey || null;
			message = parsed.message || '';
		} catch {}
		if (!apiKey) {
			return res.status(502).json({ error: 'Board enabled the API but returned no key' });
		}
		await withConfigLock(async () => {
			const existing = await readConfig();
			existing.localBoard = {
				address: String(address).trim().toLowerCase(),
				apiKey,
			};
			await writeConfig(existing);
		});
		notifyConfigChanged();
		logInfo('Local API enabled', { address });
		res.status(200).json({ ok: true, message });
	} catch (err) {
		logError('POST /api/local/enable failed', err);
		res.status(502).json({ error: 'Could not reach the board to enable the Local API' });
	}
});

module.exports = router;

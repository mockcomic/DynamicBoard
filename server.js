const express = require('express');
const path = require('path');
const routes = require('./backend/routes');
const os = require('os');
const { logInfo, logError } = require('./backend/utils/logger');
const app = express();
const port = Number(process.env.PORT) || 4000;

function get192LanIP() {
	const nets = os.networkInterfaces();
	for (const iface of Object.values(nets)) {
		for (const config of iface) {
			if (
				config.family === 'IPv4' &&
				!config.internal &&
				config.address.startsWith('192.168.')
			) {
				return config.address;
			}
		}
	}
	return null;
}

app.use(
	express.static(path.join(__dirname, 'public'), {
		// iOS Safari (and home-screen web apps) can be very sticky with cached JS.
		// Force revalidation so new client code reliably ships after deploys.
		setHeaders(res, filePath) {
			if (
				filePath.endsWith('.html') ||
				filePath.endsWith('.js') ||
				filePath.endsWith('.css')
			) {
				res.setHeader('Cache-Control', 'no-store');
			}
		},
	})
);

app.use(express.json({ limit: '1mb' }));

app.use('/', routes);

// Body-parse failures must not return Express's HTML error page: the PWA
// toasts raw HTML at the user. Map them to the {error} JSON shape instead.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
	if (err?.type === 'entity.parse.failed') {
		return res.status(400).json({ error: 'Malformed JSON request body' });
	}
	if (err?.type === 'entity.too.large') {
		return res.status(413).json({ error: 'Request body too large' });
	}
	logError('Unhandled request error', err);
	return res.status(500).json({ error: 'Server error' });
});

if (require.main === module) {
	app.listen(port, () => {
		const lanIP = get192LanIP() || '127.0.0.1';
		logInfo('Server started', {
			local: `http://localhost:${port}`,
			network: `http://${lanIP}:${port}`,
		});
	});
}

module.exports = app;

const express = require('express');
const path = require('path');
const ejs = require('ejs');
const routes = require('./routes/routes');
const os = require('os');
const app = express();
const port = 4000;

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

app.use(express.static(path.join(__dirname, 'public')));
app.set('views', path.join(__dirname, 'public'));

app.engine('html', ejs.renderFile);
app.set('view engine', 'html');

app.use(express.json());

app.use('/', routes);

app.listen(port, () => {
	const lanIP = get192LanIP() || '127.0.0.1';
	console.log(`Local:   http://localhost:${port}`);
	console.log(`Network: http://${lanIP}:${port}`);
});

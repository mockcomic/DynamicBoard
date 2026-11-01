// Vestaboard Local API: LAN discovery + direct-to-board send.
// Discovery = parallel TCP/HTTP probe of :7000 across the subnet, classified
// by the `Server:` response header (real boards answer `Vestaboard/x.y.z`;
// Apple AirTunes also squats :7000 and must not be offered).
const http = require('http');
const net = require('net');
const dns = require('dns');
const fs = require('fs');
const path = require('path');
const { logInfo, logWarn } = require('../utils/logger');

const BOARD_PORT = 7000;
const PROBE_TIMEOUT_MS = 900;
// WiFi boards in power-save mode answer the first SYN late (AP buffering +
// cold ARP), which a single 900 ms pass can miss entirely. Hosts that didn't
// hard-fail get one patient re-probe before they're written off.
const RETRY_TIMEOUT_MS = 2000;
const SEND_TIMEOUT_MS = 5000;
const GRID_COLS = 22;
const GRID_ROWS = 6;

// Same codex the UI editor uses, loaded server-side so local sends never
// depend on the browser having fetched it.
const CODEX = (() => {
	const file = path.join(__dirname, '..', '..', 'public', 'CharCode.json');
	const raw = fs.readFileSync(file, 'utf8');
	return JSON.parse(raw);
})();

function probeHost(ip, timeoutMs = PROBE_TIMEOUT_MS) {
	return new Promise(resolve => {
		const sock = new net.Socket();
		let settled = false;
		const finish = result => {
			if (settled) return;
			settled = true;
			sock.destroy();
			resolve(result);
		};
		sock.setTimeout(timeoutMs);
		sock.on('timeout', () => finish(TIMEOUT));
		sock.on('error', () => finish(null));
		sock.connect(BOARD_PORT, ip, () => {
			sock.write(
				`GET /local-api/message HTTP/1.1\r\nHost: ${ip}\r\nConnection: close\r\n\r\n`,
			);
			let buf = '';
			sock.on('data', chunk => {
				buf += chunk.toString('latin1');
				if (/\r\n\r\n/.test(buf) || buf.length > 4096) {
					const status = Number(
						(buf.match(/^HTTP\/1\.[01] (\d+)/) || [])[1] || 0,
					);
					const server = (buf.match(/^Server:\s*(.+)$/im) || [])[1] || '';
					finish({ status, server: server.trim() });
				}
			});
		});
	});
}

function resolveMdns(name) {
	return new Promise(resolve => {
		dns.lookup(name, { all: true, verbatim: true }, (err, addrs) =>
			resolve(err || !addrs?.length ? null : addrs[0].address),
		);
	});
}

const TIMEOUT = Symbol('probe-timeout');

// One probe with a patient retry on timeout (WiFi power-save hosts answer
// the first SYN late); a hard connection error is definitive, no retry.
function probeHostWithRetry(ip) {
	return probeHost(ip).then(r =>
		r === TIMEOUT ? probeHost(ip, RETRY_TIMEOUT_MS) : r,
	);
}

// Only responders whose Server header says Vestaboard are offered as boards.
function isVestaboard(serverHeader) {
	return /^vestaboard\//i.test(serverHeader || '');
}

async function discover(subnetPrefix) {
	if (!/^\d{1,3}(\.\d{1,3}){1,2}$/.test(subnetPrefix || '')) {
		const err = new Error('subnet must look like 192.168.0');
		err.statusCode = 400;
		throw err;
	}
	const parts = subnetPrefix.split('.');
	while (parts.length < 3) parts.push(0);
	const base = parts.join('.');

	// mDNS first: the documented primary names, so a board keeps its name
	// even when its DHCP lease moved.
	const mdnsNames = ['vestaboard.local', 'vestaboard-2.local', 'vestaboard-3.local'];
	const mdns = await Promise.all(mdnsNames.map(n => resolveMdns(n).then(ip => [n, ip])));

	const probes = [];
	for (let i = 1; i <= 254; i++) {
		const ip = `${base}.${i}`;
		probes.push(
			probeHostWithRetry(ip).then(r => (r && r !== TIMEOUT ? { ip, ...r } : null)),
		);
	}
	const results = (await Promise.all(probes)).filter(Boolean);

	const boards = [];
	const noise = [];
	for (const r of results) {
		if (isVestaboard(r.server)) {
			const mdnsName = mdns.find(([, ip]) => ip === r.ip)?.[0] || null;
			boards.push({
				address: mdnsName || r.ip,
				ip: r.ip,
				mdnsName,
				firmware: r.server.replace(/^vestaboard\//i, ''),
				status: r.status,
			});
		} else {
			noise.push({ ip: r.ip, server: r.server || '(none)', status: r.status });
		}
	}
	logInfo('LAN discovery complete', {
		subnet: base,
		boards: boards.length,
		noise: noise.length,
	});
	return { subnet: `${base}.1-254`, boards, others: noise };
}

// Uppercase + codex map (mirrors the grid editor), greedy word-wrap across
// the 22x6 face. Words longer than a row break mid-word. The wrapped block
// is CENTERED (each line horizontally, the block vertically) to match how
// the Vestaboard cloud renders plain text — without this, messages that
// looked right via cloud suddenly sit top-left in local mode.
// Unsupported characters are reported, not silently blanked; overflow
// beyond 6 rows is reported via `truncated`.
function textToVbml(text) {
	const unsupported = [];
	const lines = [];
	const pushLine = l => lines.push(l.slice(0, GRID_COLS));

	for (const rawLine of String(text).split('\n')) {
		let row = '';
		const flush = () => {
			if (row) pushLine(row);
			row = '';
		};
		for (const word of rawLine.toUpperCase().split(' ')) {
			for (const ch of word) {
				if (ch && !(ch in CODEX)) unsupported.push(ch);
			}
			if (word === '') continue;
			let rest = word;
			// break over-long words into row-sized chunks
			while (rest.length > GRID_COLS) {
				if (row) {
					pushLine(row);
					row = '';
				}
				pushLine(rest.slice(0, GRID_COLS));
				rest = rest.slice(GRID_COLS);
			}
			if (!row) row = rest;
			else if (row.length + 1 + rest.length <= GRID_COLS) row += ' ' + rest;
			else flush(), (row = rest);
		}
		flush();
	}
	const uniqueUnsupported = [...new Set(unsupported)];
	if (uniqueUnsupported.length) {
		const err = new Error(
			`Unsupported characters for the board: ${uniqueUnsupported.join(' ')}`,
		);
		err.statusCode = 400;
		throw err;
	}
	// Center the block: pad each wrapped line horizontally, then place the
	// block vertically mid-face (matching the cloud renderer).
	const centered = lines.map(l => {
		const pad = Math.max(0, Math.floor((GRID_COLS - l.length) / 2));
		return ' '.repeat(pad) + l;
	});
	const used0 = centered.slice(0, GRID_ROWS);
	const truncated = centered.length > GRID_ROWS;
	const top = Math.floor((GRID_ROWS - used0.length) / 2);
	const used = [
		...Array.from({ length: top }, () => ''),
		...used0,
	];
	const grid = Array.from({ length: GRID_ROWS }, (_, r) =>
		Array.from({ length: GRID_COLS }, (_, c) => {
			const ch = used[r]?.[c] ?? '';
			return ch === '' ? CODEX[''] : CODEX[ch] ?? CODEX[''];
		}),
	);
	return { grid, truncated };
}

function boardRequest(address, apiKey, method, body) {
	return new Promise((resolve, reject) => {
		const req = http.request({
			host: address,
			port: BOARD_PORT,
			method,
			path: '/local-api/message',
			timeout: SEND_TIMEOUT_MS,
			headers: {
				'Content-Type': 'application/json',
				...(apiKey ? { 'X-Vestaboard-Local-Api-Key': apiKey } : {}),
			},
		});
		req.on('error', reject);
		req.on('timeout', () => {
			req.destroy();
			reject(new Error('timeout'));
		});
		let buf = '';
		req.on('response', res => {
			res.on('data', d => (buf += d));
			res.on('end', () => resolve({ status: res.statusCode, body: buf }));
		});
		if (body) req.write(JSON.stringify(body));
		req.end();
	});
}

async function enableLocalApi(address, enablementToken) {
	return new Promise((resolve, reject) => {
		const req = http.request({
			host: address,
			port: BOARD_PORT,
			method: 'POST',
			path: '/local-api/enablement',
			timeout: SEND_TIMEOUT_MS,
			headers: {
				'Content-Type': 'application/json',
				'X-Vestaboard-Local-Api-Enablement-Token': enablementToken,
			},
		});
		req.on('error', reject);
		req.on('timeout', () => {
			req.destroy();
			reject(new Error('timeout'));
		});
		let buf = '';
		req.on('response', res => {
			res.on('data', d => (buf += d));
			res.on('end', () =>
				resolve({ status: res.statusCode, body: buf }),
			);
		});
		req.end();
	});
}

async function sendGridToLocal(address, apiKey, grid) {
	try {
		const res = await boardRequest(address, apiKey, 'POST', grid);
		if (res.status >= 200 && res.status < 300)
			return { ok: true, status: res.status };
		return {
			ok: false,
			status: res.status,
			statusText: localErrorText(res.status, res.body),
		};
	} catch (err) {
		logWarn('Local board send failed', { address, error: err.message });
		return { ok: false, status: 0, statusText: 'local_unreachable' };
	}
}

function localErrorText(status, body) {
	if (status === 403) return 'local_api_not_enabled';
	if (status === 401) return 'bad_local_key';
	if (status === 400) return 'board_rejected_payload';
	if (status === 429) return 'Too Many Requests';
	return body?.slice(0, 80) || `local_http_${status}`;
}

module.exports = { discover, textToVbml, sendGridToLocal, enableLocalApi, GRID_COLS, GRID_ROWS };

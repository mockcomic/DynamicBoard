// Self-update: check GitHub releases for a newer version and, on the
// pkg-binary form (the usual production setup), download + swap + restart.
//
// Design constraints:
// - Never block the app: checks run on a timer, the HTTP routes only read
//   the cache (a manual check is the sole request-path fetch, user-initiated).
// - GitHub outage == "status unknown", not an error state in the UI.
// - Apply is Linux-only (the production box): download to a sibling temp
//   file, verify size + API-provided sha256 digest, chmod, atomic rename
//   over the running binary (the live process keeps its inode), exit.
//   A supervisor (systemd/pm2) or a manual relaunch starts the new build.
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { logInfo, logWarn, logError } = require('../utils/logger');

const REPO = 'mockcomic/DynamicBoard';
const LATEST_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 30_000; // keep boot lean
const FETCH_TIMEOUT_MS = 8000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000; // ~80 MB over LAN-ish internet

const APP_VERSION = (() => {
	try {
		return require('../../package.json').version || '0.0.0';
	} catch {
		return '0.0.0';
	}
})();

const DISABLED =
	process.env.DYNAMICBOARD_DISABLE_UPDATE_CHECK === '1' ||
	process.env.DYNAMICBOARD_DISABLE_UPDATE_CHECK === 'true';

// pkg-binary detection: under pkg, process.pkg exists. Plain `node server.js`
// dev/docker runs cannot self-swap (no single-file executable to rename).
const IS_PKG = Boolean(process.pkg);
const CAN_APPLY =
	IS_PKG && os.platform() === 'linux' && !DISABLED;

/** Strict v-ish compare on dot-separated numeric segments; returns
 * >0 if a>b, <0 if a<b. Ignores leading 'v' and pre-release suffixes. */
function compareVersions(a, b) {
	const pa = String(a).replace(/^v/i, '').split(/[.\-+]/);
	const pb = String(b).replace(/^v/i, '').split(/[.\-+]/);
	for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
		const na = parseInt(pa[i] ?? '0', 10) || 0;
		const nb = parseInt(pb[i] ?? '0', 10) || 0;
		if (na !== nb) return na - nb;
	}
	return 0;
}

let state = {
	current: APP_VERSION,
	latest: null,
	updateAvailable: false,
	releaseUrl: null,
	asset: null, // { name, url, size, digest }
	checkedAt: null, // epoch ms of last successful fetch
	lastError: null,
	checking: false,
	canApply: CAN_APPLY,
	disabled: DISABLED,
};

function httpsJson(url, redirectsLeft = 3) {
	return new Promise((resolve, reject) => {
		const req = https.get(url, {
			headers: {
				'User-Agent': `DynamicBoard/${APP_VERSION}`,
				Accept: 'application/vnd.github+json',
			},
			timeout: FETCH_TIMEOUT_MS,
		});
		req.on('error', reject);
		req.on('timeout', () => {
			req.destroy();
			reject(new Error('github timeout'));
		});
		req.on('response', res => {
			if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
				res.resume();
				if (redirectsLeft <= 0) return reject(new Error('too many redirects'));
				return resolve(httpsJson(res.headers.location, redirectsLeft - 1));
			}
			let buf = '';
			res.on('data', d => (buf += d));
			res.on('end', () => {
				if (res.statusCode !== 200)
					return reject(new Error(`github HTTP ${res.statusCode}`));
				try {
					resolve(JSON.parse(buf));
				} catch (e) {
					reject(new Error('invalid github JSON'));
				}
			});
		});
	});
}

// Pick the asset matching this platform from a release payload.
function chooseAsset(release) {
	const target =
		os.platform() === 'linux'
			? 'DynamicBoard-linux-x64'
			: os.platform() === 'darwin'
				? 'DynamicBoard-macos-x64'
				: 'DynamicBoard-windows-x64.exe';
	const assets = Array.isArray(release?.assets) ? release.assets : [];
	const hit = assets.find(a => a.name === target);
	return hit
		? {
				name: hit.name,
				apiUrl: hit.url,
				downloadUrl: hit.browser_download_url || null,
				size: hit.size,
				digest: hit.digest || null,
			}
		: null;
}

async function checkForUpdate() {
	if (DISABLED) return state;
	if (state.checking) return state;
	state.checking = true;
	try {
		const release = await httpsJson(LATEST_URL);
		const tag = String(release.tag_name || '');
		const parsed = tag.match(/v?(\d+\.\d+\.\d+(?:[-.\w]*)?)/);
		state.latest = parsed ? parsed[1] : tag || null;
		state.updateAvailable =
			Boolean(state.latest) && compareVersions(state.latest, APP_VERSION) > 0;
		state.releaseUrl = release.html_url || null;
		state.asset = chooseAsset(release);
		// The public asset list omits the digest; fetch it per-asset so the
		// download can be verified (sha256:<hex>), best-effort.
		if (state.asset) {
			// The digest is inlined on the release payload's asset entries
			// (GitHub API >=2022-11); fall back to fetching the single-asset
			// endpoint only if it's absent.
			if (!state.asset.digest) {
				try {
					const full = await httpsJson(state.asset.apiUrl);
					state.asset.digest = full.digest || null; // "sha256:..."
				} catch {
					state.asset.digest = null;
				}
			}
			if (!state.asset.downloadUrl) state.asset.downloadUrl = state.asset.apiUrl;
		}
		state.checkedAt = Date.now();
		state.lastError = null;
		logInfo('Update check complete', {
			current: APP_VERSION,
			latest: state.latest,
			available: state.updateAvailable,
		});
	} catch (err) {
		state.lastError = String(err?.message || err);
		logWarn('Update check failed', { error: state.lastError });
	} finally {
		state.checking = false;
	}
	return state;
}

function getUpdateStatus() {
	return {
		current: state.current,
		latest: state.latest,
		updateAvailable: state.updateAvailable,
		releaseUrl: state.releaseUrl,
		assetName: state.asset?.name || null,
		checkedAt: state.checkedAt,
		lastError: state.lastError,
		checking: state.checking,
		canApply: CAN_APPLY,
		disabled: DISABLED,
		stale: state.checkedAt === null,
	};
}

function downloadFile(url, destPath, expectedSize) {
	return new Promise((resolve, reject) => {
		const go = (u, redirectsLeft) => {
			const req = https.get(u, {
				headers: {
					'User-Agent': `DynamicBoard/${APP_VERSION}`,
					// Asset API URL without this header returns JSON metadata
					// instead of bytes; with it, GitHub 302s to the CDN.
					Accept: 'application/octet-stream',
				},
				timeout: DOWNLOAD_TIMEOUT_MS,
			});
			req.on('error', reject);
			req.on('timeout', () => {
				req.destroy();
				reject(new Error('download timeout'));
			});
			req.on('response', res => {
				if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
					res.resume();
					if (redirectsLeft <= 0) return reject(new Error('too many redirects'));
					return go(res.headers.location, redirectsLeft - 1);
				}
				if (res.statusCode !== 200) {
					res.resume();
					return reject(new Error(`download HTTP ${res.statusCode}`));
				}
				const out = fs.createWriteStream(destPath);
				const hash = crypto.createHash('sha256');
				let got = 0;
				res.on('data', d => {
					got += d.length;
					hash.update(d);
				});
				res.on('error', err => {
					out.destroy();
					reject(err);
				});
				out.on('error', reject);
				out.on('finish', () => {
					if (expectedSize && got !== expectedSize)
						return reject(
							new Error(`size mismatch: got ${got}, expected ${expectedSize}`),
						);
					resolve({ bytes: got, sha256: hash.digest('hex') });
				});
				res.pipe(out);
			});
		};
		go(url, 5);
	});
}

// Full apply: re-check (so the asset metadata is fresh), download next to
// the target binary (same filesystem => atomic rename), verify, swap, exit.
// Throws Error with a user-safe message on any problem; on success the
// process exits 0 and this never returns.
async function applyUpdate() {
	if (!CAN_APPLY) throw new Error('Self-update is not available for this install');
	await checkForUpdate();
	if (!state.updateAvailable || !state.asset)
		throw new Error('No update is available');
	if (!state.asset.digest)
		throw new Error('Release asset has no digest — refusing to swap');

	const target = process.execPath; // the running pkg binary
	const dir = path.dirname(target);
	let writable = true;
	try {
		fs.accessSync(dir, fs.constants.W_OK);
	} catch {
		writable = false;
	}
	if (!writable)
		throw new Error('The binary directory is not writable by the server process');

	const tmp = path.join(dir, `.DynamicBoard-update-${process.pid}`);
	logInfo('Update download starting', {
		from: APP_VERSION,
		to: state.latest,
		asset: state.asset.name,
		target,
	});
	try {
		const { sha256 } = await downloadFile(
			state.asset.downloadUrl || state.asset.apiUrl,
			tmp,
			state.asset.size,
		);
		const want = state.asset.digest.replace(/^sha256:/, '').toLowerCase();
		if (sha256.toLowerCase() !== want)
			throw new Error('SHA-256 mismatch on the downloaded binary');
		fs.chmodSync(tmp, 0o755);
		// Drop .old-* files from previous swaps (the running process holds
		// its own inode; unlinking names is safe on POSIX).
		for (const f of fs.readdirSync(dir)) {
			if (f.startsWith(path.basename(target) + '.old-')) {
				try {
					fs.unlinkSync(path.join(dir, f));
				} catch {}
			}
		}
		fs.renameSync(target, `${target}.old-${Date.now()}`);
		fs.renameSync(tmp, target);
		logInfo('Binary swapped; exiting for restart', { to: state.latest });
	} finally {
		try {
			fs.existsSync(tmp) && fs.unlinkSync(tmp);
		} catch {}
	}
	// Exit so the supervisor (systemd/pm2/manual) starts the new binary.
	process.exit(0);
}

let timer = null;
function startUpdateLoop() {
	if (DISABLED) return;
	setTimeout(() => checkForUpdate(), FIRST_CHECK_DELAY_MS).unref?.();
	timer = setInterval(() => checkForUpdate(), CHECK_INTERVAL_MS);
	timer.unref?.();
}

module.exports = {
	checkForUpdate,
	getUpdateStatus,
	applyUpdate,
	startUpdateLoop,
	compareVersions,
	chooseAsset,
	downloadFile,
	APP_VERSION,
	// test hooks
	__setStateForTests(next) {
		state = { ...state, ...next };
	},
	__getStateForTests: () => state,
};

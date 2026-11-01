// Dynamicboard client entry. Loads config, renders messages, wires the UI.
import {
	log,
	readServerError,
	consumePendingToast,
	showToast,
	formatDate,
	openModal,
	closeModal,
	withBusy,
} from './ui.js';
import {
	setCodex,
	convertData,
	createGrid,
	clearGrid,
	displayMessage,
	findUnsupportedChars,
	isGridEmpty,
} from './grid.js';
import {
	eventDataDefualt,
	eventData,
	syncScheduleStateFromInputs,
	updateScheduleSummary,
	setScheduleControlsEnabled,
	applySchedulePreset,
	clearScheduleSettings,
	openScheduleModal,
	closeScheduleModal,
	applyScheduleSettings,
	validateScheduleForSubmit,
	setStartNowIfRequested,
	setScheduleRangeToAllDay,
} from './schedule.js';

const messagesList = document.getElementById('messages');
const apiBase = window.location.origin;

let configData = {};
// Prevents double-submit when Ctrl+Enter is mashed (button clicks are
// already serialized by withBusy; the shortcut calls submitData directly).
let submitting = false;

window.addEventListener('error', evt => {
	// iOS Safari can fail silently; surface errors as a toast.
	const msg = evt?.error?.message || evt?.message || 'Unknown error';
	log('error', 'Window error', msg);
	showToast(`Error: ${msg}`, 'danger');
});

window.addEventListener('unhandledrejection', evt => {
	const msg =
		evt?.reason?.message ||
		(typeof evt?.reason === 'string' ? evt.reason : 'Unhandled promise error');
	log('error', 'Unhandled rejection', msg);
	showToast(`Error: ${msg}`, 'danger');
});

function registerServiceWorker() {
	if (!('serviceWorker' in navigator)) {
		log('warn', 'Service workers are not supported in this browser');
		return;
	}

	window.addEventListener('load', () => {
		navigator.serviceWorker
			.register('/service-worker.js')
			.then(registration => {
				log('info', 'Service worker registered', {
					scope: registration.scope,
				});

				// Offer a one-tap refresh instead of asking the user to reload manually.
				const offerRefresh = () =>
					showToast('New version available.', 'info', {
						duration: 0,
						actionLabel: 'Refresh',
						onAction: async () => {
							try {
								const keys = await caches.keys();
								await Promise.all(
									keys.map(key =>
										key.startsWith('DynamicBoard') ? caches.delete(key) : Promise.resolve(),
									),
								);
							} finally {
								// No skipWaiting in the SW: tell the waiting worker to take
								// over, and reload once the new controller is actually in
								// charge (controllerchange below) so the refresh can't
								// reload against the old worker.
								registration.waiting?.postMessage('SKIP_WAITING');
								window.location.reload();
							}
						},
					});

				if (registration.waiting && navigator.serviceWorker.controller) {
					offerRefresh();
				}

				registration.addEventListener('updatefound', () => {
					const installingWorker = registration.installing;
					if (!installingWorker) return;

					installingWorker.addEventListener('statechange', () => {
						if (
							installingWorker.state === 'installed' &&
							navigator.serviceWorker.controller
						) {
							offerRefresh();
						}
					});
				});
			})
			.catch(err => {
				log('warn', 'Service worker registration failed', err);
			});
	});
}

// Load the character code table used to encode grid payloads.
(async function () {
	try {
		const response = await fetch(`${apiBase}/CharCode.json`, {
			cache: 'no-store',
		});
		if (!response.ok) {
			const errorMessage = await readServerError(response);
			log('error', 'Failed to load CharCode.json', errorMessage);
			showToast(`Failed to load character data: ${errorMessage}`, 'danger');
			return;
		}
		setCodex(await response.json());
	} catch (err) {
		log('error', 'Failed to load CharCode.json', err);
		showToast(
			`Failed to load character data: ${err?.message || err}`,
			'danger',
		);
	}
})();

// #region Data
async function pushData(data) {
	try {
		const res = await fetch(`${apiBase}/api`, {
			headers: { 'Content-Type': 'application/json' },
			method: 'PUT',
			body: JSON.stringify(data),
		});
		if (!res.ok) {
			const errorMessage = await readServerError(res);
			log('error', 'pushData failed', { status: res.status, errorMessage });
			return { ok: false, errorMessage };
		}
		return { ok: true };
	} catch (err) {
		log('error', 'pushData failed', err);
		return { ok: false, errorMessage: err?.message || err };
	}
}

function renderMessages() {
	// FLIP: remember where each message card currently sits, then after the
	// list rebuilds, glide survivors from their old slot to the new one.
	// This is the one authored motion of the list: deletes and undos show
	// the rotation queue physically closing ranks.
	const prevRects = new Map();
	if (!prefersReducedMotion()) {
		for (const el of messagesList.children) {
			const id = el.dataset?.msgId;
			if (id) prevRects.set(id, el.getBoundingClientRect());
		}
	}

	messagesList.replaceChildren();

	if (!Array.isArray(configData.messages) || configData.messages.length === 0) {
		const empty = document.createElement('p');
		empty.className = 'has-text-grey';
		empty.textContent =
			'No saved messages yet. Submit text or use the grid above.';
		messagesList.appendChild(empty);
		return;
	}

	configData.messages.forEach(createCard);

	if (prevRects.size) {
		for (const el of messagesList.children) {
			const id = el.dataset?.msgId;
			const before = prevRects.get(id);
			if (!before) continue;
			const after = el.getBoundingClientRect();
			const dx = before.left - after.left;
			const dy = before.top - after.top;
			if (!dx && !dy) continue;
			el.animate(
				[
					{ transform: `translate(${dx}px, ${dy}px)` },
					{ transform: 'translate(0, 0)' },
				],
				{ duration: 320, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
			);
		}
	}
}

function loadData(array) {
	const checkboxInput = document.getElementById('isEnabled');
	checkboxInput.checked = !!array.isEnabled;
	checkboxInput.onclick = async function () {
		const previous = configData.isEnabled;
		configData.isEnabled = checkboxInput.checked;
		const result = await pushData(configData);
		if (!result.ok) {
			configData.isEnabled = previous;
			checkboxInput.checked = !!previous;
			showToast(`Failed to update setting: ${result.errorMessage}`, 'danger');
		}
	};

	const timerInput = document.getElementById('timerInput');
	const timerBtn = document.getElementById('timerInput-btn');
	timerInput.value = configData.timer / 60000;
	timerBtn.onclick = async function () {
		await withBusy(timerBtn, async () => {
			const minutes = Number(timerInput.value);
			if (
				!Number.isFinite(minutes) ||
				minutes <= 0 ||
				minutes * 60000 > 24 * 60 * 60 * 1000
			) {
				showToast('Please enter a valid number of minutes (1-1440)', 'warning');
				return;
			}
			const previous = configData.timer;
			configData.timer = minutes * 60000;
			const result = await pushData(configData);
			if (result.ok) showToast('Time interval updated');
			else {
				// Restore, or every later save re-sends the rejected value.
				configData.timer = previous;
				timerInput.value = previous / 60000;
				showToast(
					`Failed to update time interval: ${result.errorMessage}`,
					'danger',
				);
			}
		});
	};
	timerInput.addEventListener('keydown', evt => {
		if (evt.key === 'Enter') {
			evt.preventDefault();
			timerBtn.click();
		}
	});

	const timezoneInput = document.getElementById('timezone-input');
	const timezoneBtn = document.getElementById('timezone-save-btn');
	if (timezoneInput && timezoneBtn) {
		timezoneInput.value = configData.timezone || '';
		timezoneInput.placeholder =
			'Use server time (' +
			(Intl.DateTimeFormat().resolvedOptions().timeZone || 'system') +
			')';
		timezoneBtn.onclick = async function () {
			await withBusy(timezoneBtn, async () => {
				const value = timezoneInput.value.trim();
				const previous = configData.timezone;
				configData.timezone = value || null;
				const result = await pushData(configData);
				if (result.ok) {
					showToast(value ? 'Time zone updated' : 'Using server time zone');
				} else {
					configData.timezone = previous;
					showToast(
						`Failed to update time zone: ${result.errorMessage}`,
						'danger',
					);
				}
			});
		};
	}

	renderMessages();
}

async function getData() {
	try {
		const res = await fetch(`${apiBase}/api`, { cache: 'no-store' });
		if (!res.ok) {
			const errorMessage = await readServerError(res);
			log('error', 'Failed to load config', {
				status: res.status,
				errorMessage,
			});
			showToast(`Failed to load config: ${errorMessage}`, 'danger');
			return;
		}
		configData = await res.json();
		checkConfig(configData);
		loadData(configData);
	} catch (err) {
		log('error', 'Failed to load config', err);
		showToast(`Failed to load config: ${err?.message || err}`, 'danger');
	}
}

function checkConfig(cfg) {
	// GET /api redacts the key; the client sees hasApiKey instead of apiWriteKey.
	const warning = document.getElementById('api-key-warning');
	const warningText = document.getElementById('api-key-warning-text');
	const warningBtn = document.getElementById('api-key-banner-btn');
	const localMode = cfg.transport === 'local';
	if (localMode) {
		// In local mode the cloud key is irrelevant: warn only when the
		// board or its local key is missing, in local-terms.
		warning.style.display =
			!cfg.localBoard?.address || !cfg.localBoard?.hasApiKey ? 'block' : 'none';
		if (warningText) {
			warningText.textContent = !cfg.localBoard?.address
				? 'Local mode needs a board: scan for boards and select one in Board Connection below.'
				: 'The board\u2019s Local API is not enabled yet: enter the token Vestaboard emailed you in Board Connection below.';
		}
		if (warningBtn) warningBtn.textContent = 'Set Up Local Board';
	} else {
		warning.style.display = !cfg.hasApiKey || cfg.isValidKey === false ? 'block' : 'none';
		if (warningText) warningText.textContent = 'Your API key seems to be invalid or missing.';
		if (warningBtn) warningBtn.textContent = 'Enter API Key';
	}
	renderConnectionBox(cfg);
}

// #region Board connection (cloud / local LAN)
let discoverState = { scanning: false, boards: [] };

function renderConnectionBox(cfg) {
	const cloudRadio = document.getElementById('transport-cloud');
	const localRadio = document.getElementById('transport-local');
	const controls = document.getElementById('local-board-controls');
	const addrInput = document.getElementById('local-board-address');
	const statusEl = document.getElementById('local-board-status');
	if (!cloudRadio || !localRadio || !controls) return;
	const transport = cfg.transport === 'local' ? 'local' : 'cloud';
	cloudRadio.checked = transport === 'cloud';
	localRadio.checked = transport === 'local';
	controls.style.display = transport === 'local' ? '' : 'none';
	if (document.activeElement !== addrInput) {
		addrInput.value = cfg.localBoard?.address || '';
	}
	const hasBoard = Boolean(cfg.localBoard?.address);
	const hasKey = Boolean(cfg.localBoard?.hasApiKey);
	statusEl.textContent = !hasBoard
		? 'No board selected — use Scan for boards, then Enable with your token.'
		: !hasKey
			? `Board ${cfg.localBoard.address} found, but its Local API is not enabled yet. Enter the token Vestaboard emailed you, then press Enable.`
			: `Connected directly to ${cfg.localBoard.address}. Messages skip the cloud entirely.`;
	document.getElementById('local-enable-row').style.display =
		hasBoard && !hasKey ? '' : 'none';
}

function renderDiscoverResults() {
	const box = document.getElementById('discover-results');
	if (!box) return;
	box.replaceChildren();
	if (discoverState.scanning) {
		const p = document.createElement('p');
		p.className = 'help is-info';
		p.textContent = 'Scanning the network…';
		box.appendChild(p);
		return;
	}
	if (!discoverState.boards.length) {
		const p = document.createElement('p');
		p.className = 'help';
		p.textContent = 'No Vestaboards found on this network.';
		box.appendChild(p);
		return;
	}
	for (const b of discoverState.boards) {
		const row = document.createElement('div');
		row.className = 'field has-addons mb-2';
		const info = document.createElement('div');
		info.className = 'control is-expanded';
		const label = document.createElement('span');
		label.className = 'button is-small is-static is-fullwidth';
		label.textContent = `${b.address} — firmware ${b.firmware || '?'}`;
		info.appendChild(label);
		const pick = document.createElement('div');
		pick.className = 'control';
		const btn = document.createElement('button');
		btn.className = 'button is-small is-primary';
		btn.type = 'button';
		btn.textContent = 'Use this board';
		btn.onclick = () => selectBoard(b.address);
		pick.appendChild(btn);
		row.append(info, pick);
		box.appendChild(row);
	}
}

async function selectBoard(address) {
	const previous = JSON.parse(JSON.stringify(configData.localBoard || {}));
	configData.localBoard = { address, apiKey: undefined };
	const result = await pushData(configData);
	if (result.ok) {
		configData.localBoard = { ...previous, address };
		await getData();
		showToast(`Board set to ${address}`);
	} else {
		configData.localBoard = previous;
		showToast(`Failed to select board: ${result.errorMessage}`, 'danger');
	}
}

async function scanForBoards(button) {
	if (discoverState.scanning) return;
	discoverState.scanning = true;
	renderDiscoverResults();
	await withBusy(button, async () => {
		try {
			const res = await fetch(`${apiBase}/api/discover`, {
				headers: { 'Content-Type': 'application/json' },
				method: 'POST',
				body: JSON.stringify({}),
			});
			const body = await res.json();
			if (!res.ok) {
				showToast(`Scan failed: ${body.error || res.status}`, 'danger');
			} else {
				discoverState.boards = body.boards || [];
				if (discoverState.boards.length === 1) {
					await selectBoard(discoverState.boards[0].address);
				}
			}
		} catch (err) {
			showToast(`Scan failed: ${err?.message || err}`, 'danger');
		} finally {
			discoverState.scanning = false;
			renderDiscoverResults();
		}
	});
}

async function enableLocalBoard(button) {
	const tokenInput = document.getElementById('local-enable-token');
	const token = (tokenInput?.value || '').trim();
	const address = configData.localBoard?.address;
	if (!address) {
		showToast('Select a board first (scan or type its address)', 'warning');
		return;
	}
	if (!token) {
		showToast('Paste the enablement token from the Vestaboard email', 'warning');
		return;
	}
	await withBusy(button, async () => {
		try {
			const res = await fetch(`${apiBase}/api/local/enable`, {
				headers: { 'Content-Type': 'application/json' },
				method: 'POST',
				body: JSON.stringify({ address, token }),
			});
			const body = await res.json();
			if (!res.ok) {
				showToast(body.error || `Enable failed (${res.status})`, 'danger');
				return;
			}
			tokenInput.value = '';
			await getData();
			showToast('Local API enabled — board key saved');
		} catch (err) {
			showToast(`Enable failed: ${err?.message || err}`, 'danger');
		}
	});
}

function wireConnectionBox() {
	for (const [id, transport] of [
		['transport-cloud', 'cloud'],
		['transport-local', 'local'],
	]) {
		const el = document.getElementById(id);
		if (!el) continue;
		el.onchange = async () => {
			const previous = configData.transport;
			configData.transport = transport;
			const result = await pushData(configData);
			if (result.ok) {
				await getData();
				showToast(
					transport === 'local'
						? 'Sending directly to the board on your LAN'
						: 'Sending via Vestaboard Cloud',
				);
			} else {
				configData.transport = previous;
				renderConnectionBox(configData);
				showToast(`Failed to switch: ${result.errorMessage}`, 'danger');
			}
		};
	}
	document.getElementById('discover-btn').onclick = () =>
		scanForBoards(document.getElementById('discover-btn'));
	document.getElementById('local-enable-btn').onclick = () =>
		enableLocalBoard(document.getElementById('local-enable-btn'));
	const addrInput = document.getElementById('local-board-address');
	if (addrInput) {
		addrInput.onchange = () => {
			const value = addrInput.value.trim();
			if (value && value !== configData.localBoard?.address) selectBoard(value);
		};
	}
}

// #endregion

// #region Updates
let updateState = null;

function renderUpdateBox() {
	const statusEl = document.getElementById('update-status');
	const applyBtn = document.getElementById('update-apply-btn');
	const link = document.getElementById('update-release-link');
	if (!statusEl || !applyBtn || !link || !updateState) return;
	const u = updateState;
	const v = u.current;
	if (u.disabled) {
		statusEl.textContent = `Version ${v} — update checks disabled on this install.`;
		applyBtn.style.display = 'none';
		link.style.display = 'none';
		return;
	}
	if (u.checking) {
		statusEl.textContent = `Version ${v} — checking GitHub…`;
	} else if (u.lastError && u.stale) {
		statusEl.textContent = `Version ${v} — could not reach GitHub (${u.lastError}).`;
	} else if (u.updateAvailable) {
		statusEl.textContent = `Version ${v} — update available: v${u.latest}.`;
	} else if (u.latest) {
		statusEl.textContent = `Version ${v} — up to date.`;
	} else {
		statusEl.textContent = `Version ${v} — no releases found yet.`;
	}
	if (u.lastError && !u.stale) statusEl.textContent += ` (last check error: ${u.lastError})`;
	applyBtn.style.display =
		u.updateAvailable && u.canApply ? '' : 'none';
	link.style.display = u.updateAvailable && u.releaseUrl ? '' : 'none';
	if (u.releaseUrl) link.href = u.releaseUrl;
}

async function refreshUpdateStatus() {
	try {
		const res = await fetch(`${apiBase}/api/update`, { cache: 'no-store' });
		if (res.ok) {
			updateState = await res.json();
			renderUpdateBox();
		}
	} catch {}
}

function wireUpdateBox() {
	const checkBtn = document.getElementById('update-check-btn');
	const applyBtn = document.getElementById('update-apply-btn');
	if (checkBtn) {
		checkBtn.onclick = () =>
			withBusy(checkBtn, async () => {
				try {
					const res = await fetch(`${apiBase}/api/update/check`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: '{}',
					});
					updateState = await res.json();
					renderUpdateBox();
					if (!res.ok)
						showToast(updateState.error || 'Update check failed', 'danger');
					else if (updateState.updateAvailable)
						showToast(`v${updateState.latest} is available`, 'info');
					else showToast('You are on the latest version', 'info');
				} catch (err) {
					showToast(`Update check failed: ${err?.message || err}`, 'danger');
				}
			});
	}
	if (applyBtn) {
		applyBtn.onclick = () =>
			withBusy(applyBtn, async () => {
				showToast('Downloading update… the board pauses for a moment', 'info');
				try {
					await fetch(`${apiBase}/api/update/apply`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: '{}',
					});
				} catch {}
				// Server exits during the swap: poll until a NEW build answers
				// (its reported current version equals the target).
				const target = updateState?.latest;
				let ok = false;
				for (let i = 0; i < 60 && !ok; i++) {
					await new Promise(r => setTimeout(r, 1000));
					try {
						const res = await fetch(`${apiBase}/api/update`, { cache: 'no-store' });
						if (res.ok) {
							const st = await res.json();
							if (st.current === target) ok = true;
						}
					} catch {}
				}
				await refreshUpdateStatus();
				await getData();
				showToast(
					ok ? 'Updated and restarted' : 'Restart not confirmed — check the server log',
					ok ? 'success' : 'warning',
				);
			});
	}
}
// #endregion

// #region Submit
function updateTextLength() {
	const textInput = document.getElementById('textData');
	const textLength = document.getElementById('text-length');
	if (!textInput || !textLength) return;
	textLength.textContent = `${textInput.value.length} chars`;
}

async function submitData(type) {
	if (submitting) return;
	submitting = true;
	try {
		if (!configData || !Array.isArray(configData.messages)) {
			showToast('Still loading… try again in a second', 'warning');
			return;
		}

		let msg, data;
		if (type === 'grid') {
			if (isGridEmpty()) {
				showToast('The grid is empty — type a character first', 'warning');
				return;
			}
			const unsupported = findUnsupportedChars();
			if (unsupported.length) {
				showToast(
					`Unsupported characters for the board: ${unsupported.join(' ')}`,
					'danger',
				);
				return;
			}
			msg = displayMessage();
			data = JSON.stringify(convertData());
		} else if (type === 'text') {
			const textInputData = document.getElementById('textData');
			msg = textInputData.value;
			data = textInputData.value;
			if (!msg.trim()) {
				showToast('Enter some text first', 'warning');
				return;
			}
		} else {
			log('error', 'Invalid type for submitData', type);
			return;
		}

		syncScheduleStateFromInputs();
		if (!validateScheduleForSubmit()) return;

		configData.messages.push({
			id: Date.now() + Math.floor(Math.random() * 1000),
			type,
			msg,
			data,
			eventData: { ...eventData },
		});

		const result = await pushData(configData);
		if (result.ok) {
			// Only clear the inputs once the save actually landed.
			if (type === 'grid') clearGrid();
			else document.getElementById('textData').value = '';
			updateTextLength();
			clearScheduleSettings(false);
			renderMessages();
			showToast('Saved message');
		} else {
			configData.messages.pop();
			showToast(`Save failed: ${result.errorMessage}`, 'danger');
		}
	} catch (err) {
		log('error', 'submitData failed', err);
		showToast(`Save failed: ${err?.message || err}`, 'danger');
	} finally {
		submitting = false;
	}
}

// #endregion

// #region Message Section
async function deleteEntry(id, button) {
	try {
		const index = configData.messages.findIndex(message => message.id == id);
		if (index === -1) return;
		const [removed] = configData.messages.splice(index, 1);

		await withBusy(button, async () => {
			const result = await pushData(configData);
			if (!result.ok) {
				configData.messages.splice(index, 0, removed);
				renderMessages();
				showToast(`Delete failed: ${result.errorMessage}`, 'danger');
				return;
			}

			renderMessages();
			showToast('Message deleted', 'info', {
				duration: 6000,
				actionLabel: 'Undo',
				onAction: async () => {
					configData.messages.splice(
						Math.min(index, configData.messages.length),
						0,
						removed,
					);
					const undoResult = await pushData(configData);
					if (!undoResult.ok) {
						configData.messages.splice(
							Math.min(index, configData.messages.length - 1),
							1,
						);
						showToast(
							`Undo failed: ${undoResult.errorMessage}`,
							'danger',
						);
					}
					renderMessages();
				},
			});
		});
	} catch (error) {
		log('error', 'deleteEntry failed', error);
		showToast('Delete failed', 'danger');
	}
}

async function sendEntry(data, button, cardEl) {
	await withBusy(button, async () => {
		// Start the flap choreography immediately, in parallel with the
		// request: the card's own text flips to what the board is receiving.
		const flap =
			cardEl && data.type === 'text' ? playSendFlap(cardEl, String(data.data ?? data.msg ?? '')) : null;
		try {
			const response = await fetch(`${apiBase}/api/send`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(data),
			});
			if (response.ok) {
				if (flap) await flap.settle;
				if (cardEl) pulseCard(cardEl);
				showToast('Sent to board');
			} else {
				if (flap) flap.cancel();
				const errorMessage = await readServerError(response);
				log('error', 'Send failed', { status: response.status, errorMessage });
				showToast(`Send failed: ${errorMessage}`, 'danger');
			}
		} catch (err) {
			if (flap) flap.cancel();
			log('error', 'Send failed', err);
			showToast(`Send failed: ${err?.message || err}`, 'danger');
		}
	});
}

// --- Split-flap send choreography -------------------------------------
// The physical board IS the product, so "Send" makes the card echo it:
// every glyph column tumbles through random characters and settles on the
// real one, left-to-right stagger, spring easing. Skipped under
// prefers-reduced-motion; a failed send snaps the text straight back.
function prefersReducedMotion() {
	return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

const FLAP_GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,:;!?-';

// Success beat after the flaps land (or immediately for grid sends):
// a short, soft breath — not a bounce.
function pulseCard(cardEl) {
	if (prefersReducedMotion()) return;
	cardEl.animate(
		[
			{ transform: 'scale(1)', boxShadow: '0 10px 24px rgba(0,0,0,0.35)' },
			{ transform: 'scale(1.012)', boxShadow: '0 14px 32px rgba(0,0,0,0.45)', offset: 0.4 },
			{ transform: 'scale(1)', boxShadow: '0 10px 24px rgba(0,0,0,0.35)' },
		],
		{ duration: 420, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
	);
}

function playSendFlap(cardEl, text) {
	const title = cardEl?.querySelector('.flap-title');
	if (!title || prefersReducedMotion()) return null;

	const finalChars = [...title.textContent];
	title.textContent = '';
	const spans = finalChars.map(ch => {
		const s = document.createElement('span');
		s.className = 'flap-glyph';
		s.textContent = ch === ' ' ? '\u00a0' : ch;
		title.appendChild(s);
		return s;
	});

	const timers = [];
	const anims = [];
	let cancelled = false;
	spans.forEach((s, i) => {
		const final = finalChars[i];
		if (final === ' ') return; // blank flaps don't move
		// tumble: brief random glyphs, then settle with a spring flip
		const startDelay = 60 + i * 26;
		const tumble = setInterval(() => {
			s.textContent =
				FLAP_GLYPHS[Math.floor(Math.random() * FLAP_GLYPHS.length)];
		}, 45);
		timers.push(tumble);
		setTimeout(() => {
			clearInterval(tumble);
			if (cancelled) return;
			s.textContent = final === ' ' ? '\u00a0' : final;
			// settle flip: scaleY of a flipping flap, spring overshoot
			anims.push(
				s.animate(
					[
						{ transform: 'scaleY(0.05)', opacity: 0.4 },
						{ transform: 'scaleY(1.12)', opacity: 1, offset: 0.62 },
						{ transform: 'scaleY(1)' },
					],
					{ duration: 260, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
				),
			);
		}, startDelay + 130 + Math.random() * 90);
	});

	const total = 60 + spans.length * 26 + 480;
	const settle = new Promise(resolve => setTimeout(resolve, Math.min(total, 2400)));
	return {
		settle,
		cancel() {
			cancelled = true;
			timers.forEach(clearInterval);
			anims.forEach(a => a.cancel());
			title.textContent = finalChars.join('');
		},
	};
}

function createCard(messageData) {
	// Messages written by older builds or hand-edited configs may lack
	// eventData; a missing field must not abort the whole list render.
	const eventData = messageData.eventData ?? {};
	const card = document.createElement('div');
	card.className = eventData.isEvent
		? 'card has-background-warning'
		: 'card';
	card.dataset.msgId = String(messageData.id);

	const cardContent = document.createElement('div');
	cardContent.className = 'card-content container is-fluid';
	cardContent.style.margin = '10px';

	const text = document.createElement('p');

	text.className = 'title flap-title';
	text.innerText =
		messageData.type === 'grid'
			? 'Grid layout'
			: messageData.msg;
	cardContent.appendChild(text);

	if (eventData.isEvent) {
		const dateRangeText = document.createElement('p');
		const dateRangeSubText = document.createElement('p');

		dateRangeText.className = 'subtitle is-6 has-text-grey-dark';
		dateRangeText.innerHTML = `
			<span class="tag is-warning is-light has-text-weight-semibold" style="margin-right: 5px;">Date Range</span>
			<span class="has-text-weight-semibold">${formatDate(
				eventData.startDate,
			)}</span>
			<span class="has-text-grey-dark">-</span>
			<span class="has-text-weight-semibold">${formatDate(
				eventData.endDate,
			)}</span>
		`;

		dateRangeSubText.className = 'is-size-7 has-text-grey';
		dateRangeSubText.innerHTML = `<span class="tag is-info is-light" style="margin-left: 5px;">Repeat Every Year: ${eventData.repeatEveryYear}</span>`;

		cardContent.appendChild(dateRangeText);
		cardContent.appendChild(dateRangeSubText);
	}

	const footer = document.createElement('footer');
	footer.className = 'card-footer';

	const del = document.createElement('button');
	del.type = 'button';
	del.className =
		'button card-footer-item has-background-danger has-text-white';
	del.innerText = 'Delete';
	del.onclick = function () {
		deleteEntry(messageData.id, del);
	};

	const send = document.createElement('button');
	send.type = 'button';
	send.className =
		'button card-footer-item has-background-primary has-text-white';
	send.innerText = 'Send to Board';
	send.onclick = function () {
		sendEntry(messageData, send, card);
	};

	footer.append(send, del);
	card.append(cardContent, footer);
	messagesList.appendChild(card);
}
// #endregion

// #region API key
function openApiKeyModal() {
	const input = document.getElementById('api-key-input');
	if (input) {
		input.value = '';
		input.type = 'password';
	}
	const toggle = document.getElementById('api-key-toggle-btn');
	if (toggle) {
		toggle.textContent = 'Show';
		toggle.setAttribute('aria-pressed', 'false');
	}
	openModal('api-key-modal');
	const nameInput = document.getElementById('api-key-input');
	if (nameInput) nameInput.focus();
}

function closeApiKeyModal() {
	closeModal('api-key-modal');
}

async function saveApiKey(button) {
	const input = document.getElementById('api-key-input');
	const apiKey = (input?.value || '').trim();
	if (!apiKey) {
		showToast('Please enter an API key', 'warning');
		return;
	}
	await withBusy(button, async () => {
		const previousKey = configData.apiWriteKey;
		const previousValid = configData.isValidKey;
		configData.apiWriteKey = apiKey;
		// Let the server decide validity (it probes on the first send).
		configData.isValidKey = undefined;
		const result = await pushData(configData);
		if (result.ok) {
			configData.hasApiKey = true;
			closeApiKeyModal();
			document.getElementById('api-key-warning').style.display = 'none';
			showToast('API key saved');
		} else {
			configData.apiWriteKey = previousKey;
			configData.isValidKey = previousValid;
			showToast(`Failed to save API key: ${result.errorMessage}`, 'danger');
		}
	});
}

async function resetApiKey(button) {
	await withBusy(button, async () => {
		const previous = configData.apiWriteKey;
		configData.apiWriteKey = '';
		const result = await pushData(configData);
		if (result.ok) {
			configData.hasApiKey = false;
			showToast('API key reset');
			// In local mode the cloud key is irrelevant — don't nag with the
			// cloud banner/modal after a reset.
			if (configData.transport !== 'local') {
				document.getElementById('api-key-warning').style.display = 'block';
				openApiKeyModal();
			}
		} else {
			// Restore: an empty apiWriteKey in the next unrelated save (e.g.
			// adding a message) would silently wipe the stored server key.
			configData.apiWriteKey = previous;
			showToast(`Failed to reset API key: ${result.errorMessage}`, 'danger');
		}
	});
}
// #endregion

// #region Modals
function openBirthdayModal() {
	openModal('birthday-modal');

	const nameInput = document.getElementById('birthday-name');
	if (nameInput) nameInput.focus();
}

function closeBirthdayModal() {
	closeModal('birthday-modal');
}

function clearBirthdayForm() {
	const ids = [
		'birthday-name',
		'birthday-month',
		'birthday-day',
		'birthday-year',
		'birthday-days-to-text',
		'birthday-day-of-text',
	];

	ids.forEach(id => {
		const input = document.getElementById(id);
		if (input) input.value = '';
	});

	const daysAheadInput = document.getElementById('birthday-days-ahead');
	if (daysAheadInput) daysAheadInput.value = '30';
}

async function addBirthdayMessage(button) {
	if (!configData || !Array.isArray(configData.messages)) {
		showToast('Still loading... try again in a second', 'warning');
		return;
	}

	const name = (document.getElementById('birthday-name')?.value || '').trim();
	const month = Number(document.getElementById('birthday-month')?.value);
	const day = Number(document.getElementById('birthday-day')?.value);
	const year = Number(document.getElementById('birthday-year')?.value);
	const daysAheadRaw =
		document.getElementById('birthday-days-ahead')?.value || '30';
	const daysAhead = Number(daysAheadRaw);
	const daysToText = (
		document.getElementById('birthday-days-to-text')?.value || ''
	).trim();
	const dayOfText = (
		document.getElementById('birthday-day-of-text')?.value || ''
	).trim();

	if (!name) {
		showToast('Please enter a name', 'warning');
		return;
	}

	if (
		![month, day, year, daysAhead].every(Number.isFinite) ||
		month < 1 ||
		month > 12 ||
		day < 1 ||
		day > 31 ||
		year < 1900 ||
		daysAhead < 0
	) {
		showToast('Please enter valid birthday values', 'warning');
		return;
	}

	const escapeArg = value =>
		String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
	const escapedName = escapeArg(name);
	const escapedDaysToText = escapeArg(daysToText);
	const escapedDayOfText = escapeArg(dayOfText);

	const args = [`"${escapedName}"`, month, day, year, daysAhead];

	if (daysToText || dayOfText) {
		args.push(`"${escapedDaysToText}"`);
		args.push(`"${escapedDayOfText}"`);
	}

	const birthdayTemplate = `{birthday(${args.join(',')})}`;

	configData.messages.push({
		id: Date.now() + Math.floor(Math.random() * 1000),
		type: 'text',
		msg: birthdayTemplate,
		data: birthdayTemplate,
		eventData: { ...eventDataDefualt },
	});

	await withBusy(button, async () => {
		const result = await pushData(configData);
		if (result.ok) {
			clearBirthdayForm();
			closeBirthdayModal();
			renderMessages();
			showToast('Birthday message added');
		} else {
			configData.messages.pop();
			showToast(`Save failed: ${result.errorMessage}`, 'danger');
		}
	});
}
// #endregion

document.getElementById('legend-toggle-btn').onclick = () =>
	openModal('legend-modal');

document.addEventListener('DOMContentLoaded', () => {
	updateScheduleSummary();
	consumePendingToast();
	updateTextLength();

	const submitGridBtn = document.getElementById('submit-grid-btn');
	submitGridBtn.onclick = () => withBusy(submitGridBtn, () => submitData('grid'));

	document.getElementById('clear-grid-btn').onclick = () => clearGrid();

	const submitTextBtn = document.getElementById('submit-text-btn');
	submitTextBtn.onclick = () => withBusy(submitTextBtn, () => submitData('text'));

	const textInput = document.getElementById('textData');
	if (textInput) {
		textInput.addEventListener('input', updateTextLength);
		textInput.addEventListener('keydown', evt => {
			if ((evt.ctrlKey || evt.metaKey) && evt.key === 'Enter') {
				evt.preventDefault();
				submitData('text');
			}
		});
	}

	const gridEl = document.getElementById('grid');
	if (gridEl) {
		gridEl.addEventListener('keydown', evt => {
			if ((evt.ctrlKey || evt.metaKey) && evt.key === 'Enter') {
				evt.preventDefault();
				submitData('grid');
			}
		});
	}

	const addBirthdayBtn = document.getElementById('add-birthday-btn');
	if (addBirthdayBtn) {
		addBirthdayBtn.addEventListener('click', openBirthdayModal);
	}

	const birthdayModalBg = document.getElementById('birthday-modal-bg');
	if (birthdayModalBg) {
		birthdayModalBg.addEventListener('click', closeBirthdayModal);
	}

	const birthdayCloseHeadBtn = document.getElementById(
		'birthday-close-head-btn',
	);
	if (birthdayCloseHeadBtn) {
		birthdayCloseHeadBtn.addEventListener('click', closeBirthdayModal);
	}

	const birthdayCancelBtn = document.getElementById('birthday-cancel-btn');
	if (birthdayCancelBtn) {
		birthdayCancelBtn.addEventListener('click', closeBirthdayModal);
	}

	const birthdaySaveBtn = document.getElementById('birthday-save-btn');
	if (birthdaySaveBtn) {
		birthdaySaveBtn.addEventListener('click', () =>
			addBirthdayMessage(birthdaySaveBtn),
		);
	}

	const scheduleBtn = document.getElementById('schedule-btn');
	if (scheduleBtn) {
		scheduleBtn.addEventListener('click', openScheduleModal);
	}

	const scheduleModalBg = document.getElementById('schedule-modal-bg');
	if (scheduleModalBg) {
		scheduleModalBg.addEventListener('click', closeScheduleModal);
	}

	const scheduleCloseHeadBtn = document.getElementById(
		'schedule-close-head-btn',
	);
	if (scheduleCloseHeadBtn) {
		scheduleCloseHeadBtn.addEventListener('click', closeScheduleModal);
	}

	const scheduleCancelBtn = document.getElementById('schedule-cancel-btn');
	if (scheduleCancelBtn) {
		scheduleCancelBtn.addEventListener('click', closeScheduleModal);
	}

	const scheduleApplyBtn = document.getElementById('schedule-apply-btn');
	if (scheduleApplyBtn) {
		scheduleApplyBtn.addEventListener('click', applyScheduleSettings);
	}

	const scheduleClearBtn = document.getElementById('schedule-clear-btn');
	if (scheduleClearBtn) {
		scheduleClearBtn.addEventListener('click', () =>
			clearScheduleSettings(true),
		);
	}

	const legendModalBg = document.getElementById('legend-modal-bg');
	if (legendModalBg) {
		legendModalBg.addEventListener('click', () => closeModal('legend-modal'));
	}

	const legendCloseBtn = document.getElementById('legend-close-btn');
	if (legendCloseBtn) {
		legendCloseBtn.addEventListener('click', () => closeModal('legend-modal'));
	}

	const apiKeyBannerBtn = document.getElementById('api-key-banner-btn');
	if (apiKeyBannerBtn) {
		apiKeyBannerBtn.addEventListener('click', () => {
			// Local mode: the fix lives in the Board Connection box, not the
			// cloud-key modal.
			if (configData.transport === 'local') {
				document
					.getElementById('connection-box')
					?.scrollIntoView({ behavior: 'smooth', block: 'center' });
				return;
			}
			openApiKeyModal();
		});
	}

	const apiKeyModalBg = document.getElementById('api-key-modal-bg');
	if (apiKeyModalBg) {
		apiKeyModalBg.addEventListener('click', closeApiKeyModal);
	}

	const apiKeyCloseHeadBtn = document.getElementById('api-key-close-head-btn');
	if (apiKeyCloseHeadBtn) {
		apiKeyCloseHeadBtn.addEventListener('click', closeApiKeyModal);
	}

	const apiKeyCancelBtn = document.getElementById('api-key-cancel-btn');
	if (apiKeyCancelBtn) {
		apiKeyCancelBtn.addEventListener('click', closeApiKeyModal);
	}

	const apiKeyInput = document.getElementById('api-key-input');
	const apiKeyToggleBtn = document.getElementById('api-key-toggle-btn');
	if (apiKeyInput && apiKeyToggleBtn) {
		apiKeyToggleBtn.addEventListener('click', () => {
			const shown = apiKeyInput.type === 'text';
			apiKeyInput.type = shown ? 'password' : 'text';
			apiKeyToggleBtn.textContent = shown ? 'Show' : 'Hide';
			apiKeyToggleBtn.setAttribute('aria-pressed', String(!shown));
		});
		apiKeyInput.addEventListener('keydown', evt => {
			if (evt.key === 'Enter') {
				evt.preventDefault();
				apiKeySaveBtn.click();
			}
		});
	}

	const apiKeySaveBtn = document.getElementById('api-key-save-btn');
	if (apiKeySaveBtn) {
		apiKeySaveBtn.addEventListener('click', () => saveApiKey(apiKeySaveBtn));
	}

	const resetApiKeyBtn = document.getElementById('reset-api-key-btn');
	if (resetApiKeyBtn) {
		resetApiKeyBtn.addEventListener('click', () =>
			resetApiKey(resetApiKeyBtn),
		);
	}

	const scheduleInputs = [
		document.getElementById('toggleDateRange'),
		document.getElementById('repeatEveryYear'),
		document.getElementById('startDateText'),
		document.getElementById('endDateText'),
	];
	scheduleInputs.forEach(input => {
		if (!input) return;
		input.addEventListener('change', () => {
			syncScheduleStateFromInputs();
			setScheduleControlsEnabled(eventData.isEvent);
			if (eventData.isEvent) setStartNowIfRequested();
			updateScheduleSummary();
		});
	});

	const allDayInput = document.getElementById('schedule-all-day');
	if (allDayInput) {
		allDayInput.addEventListener('change', () => {
			setScheduleRangeToAllDay();
			updateScheduleSummary();
		});
	}

	const preset24hBtn = document.getElementById('schedule-preset-24h');
	if (preset24hBtn) {
		preset24hBtn.addEventListener('click', () => applySchedulePreset('24h'));
	}

	const preset7dBtn = document.getElementById('schedule-preset-7d');
	if (preset7dBtn) {
		preset7dBtn.addEventListener('click', () => applySchedulePreset('7d'));
	}

	const presetWeekendBtn = document.getElementById('schedule-preset-weekend');
	if (presetWeekendBtn) {
		presetWeekendBtn.addEventListener('click', () =>
			applySchedulePreset('weekend'),
		);
	}

	const startNowInput = document.getElementById('schedule-start-now');
	if (startNowInput) {
		startNowInput.addEventListener('change', () => {
			setStartNowIfRequested();
			updateScheduleSummary();
		});
	}

	setScheduleControlsEnabled(eventData.isEvent);
});

function main() {
	registerServiceWorker();
	createGrid();
	wireConnectionBox();
	wireUpdateBox();
	getData();
	refreshUpdateStatus();
}

main();

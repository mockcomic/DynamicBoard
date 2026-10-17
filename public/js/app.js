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
			if (!minutes || minutes <= 0) {
				showToast('Please enter a valid number of minutes', 'warning');
				return;
			}
			configData.timer = minutes * 60000;
			const result = await pushData(configData);
			if (result.ok) showToast('Time interval updated');
			else
				showToast(
					`Failed to update time interval: ${result.errorMessage}`,
					'danger',
				);
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
	if (!cfg.hasApiKey || cfg.isValidKey === false) {
		warning.style.display = 'block';
	} else {
		warning.style.display = 'none';
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

async function sendEntry(data, button) {
	await withBusy(button, async () => {
		try {
			const response = await fetch(`${apiBase}/api/send`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(data),
			});
			if (response.ok) {
				showToast('Sent to board');
			} else {
				const errorMessage = await readServerError(response);
				log('error', 'Send failed', { status: response.status, errorMessage });
				showToast(`Send failed: ${errorMessage}`, 'danger');
			}
		} catch (err) {
			log('error', 'Send failed', err);
			showToast(`Send failed: ${err?.message || err}`, 'danger');
		}
	});
}

function createCard(messageData) {
	const card = document.createElement('div');
	card.className = messageData.eventData.isEvent
		? 'card has-background-warning'
		: 'card';

	const cardContent = document.createElement('div');
	cardContent.className = 'card-content container is-fluid';
	cardContent.style.margin = '10px';

	const text = document.createElement('p');

	text.className = 'title';
	text.innerText = messageData.msg;
	cardContent.appendChild(text);

	if (messageData.eventData.isEvent) {
		const dateRangeText = document.createElement('p');
		const dateRangeSubText = document.createElement('p');

		dateRangeText.className = 'subtitle is-6 has-text-grey-dark';
		dateRangeText.innerHTML = `
			<span class="tag is-warning is-light has-text-weight-semibold" style="margin-right: 5px;">Date Range</span>
			<span class="has-text-weight-semibold">${formatDate(
				messageData.eventData.startDate,
			)}</span>
			<span class="has-text-grey-dark">-</span>
			<span class="has-text-weight-semibold">${formatDate(
				messageData.eventData.endDate,
			)}</span>
		`;

		dateRangeSubText.className = 'is-size-7 has-text-grey';
		dateRangeSubText.innerHTML = `<span class="tag is-info is-light" style="margin-left: 5px;">Repeat Every Year: ${messageData.eventData.repeatEveryYear}</span>`;

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
		sendEntry(messageData, send);
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
		configData.apiWriteKey = apiKey;
		configData.isValidKey = true;
		const result = await pushData(configData);
		if (result.ok) {
			closeApiKeyModal();
			document.getElementById('api-key-warning').style.display = 'none';
			showToast('API key saved');
		} else {
			configData.apiWriteKey = undefined;
			configData.isValidKey = false;
			showToast(`Failed to save API key: ${result.errorMessage}`, 'danger');
		}
	});
}

async function resetApiKey(button) {
	await withBusy(button, async () => {
		configData.apiWriteKey = '';
		configData.isValidKey = false;
		const result = await pushData(configData);
		if (result.ok) {
			showToast('API key reset');
			document.getElementById('api-key-warning').style.display = 'block';
			openApiKeyModal();
		} else {
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
		apiKeyBannerBtn.addEventListener('click', openApiKeyModal);
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
	getData();
}

main();

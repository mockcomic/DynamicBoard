const messagesList = document.getElementById('messages');
const apiBase = window.location.origin;

function consumePendingToast() {
	try {
		const raw = sessionStorage.getItem('pendingToast');
		if (!raw) return;
		sessionStorage.removeItem('pendingToast');
		const t = JSON.parse(raw);
		if (t && t.message) showToast(t.message, t.type || 'success');
	} catch (err) {
		// If toast parsing fails, don't break the page.
		console.log(err);
	}
}

window.addEventListener('error', evt => {
	// iOS Safari can fail silently; surface errors as a toast.
	const msg = evt?.error?.message || evt?.message || 'Unknown error';
	showToast(`Error: ${msg}`, 'danger');
});

window.addEventListener('unhandledrejection', evt => {
	const msg =
		evt?.reason?.message ||
		(typeof evt?.reason === 'string' ? evt.reason : 'Unhandled promise error');
	showToast(`Error: ${msg}`, 'danger');
});

const gridX = 22;
const gridY = 6;
const gridData = Array.from({ length: gridY }, () => Array(gridX).fill(''));

const eventDataDefualt = {
	isEvent: false,
	startDate: '',
	endDate: '',
	repeatEveryYear: false,
};

let eventData = {
	isEvent: false,
	startDate: '',
	endDate: '',
	repeatEveryYear: false,
};

let configData = {};
let codex = {};

(async function () {
	const response = await fetch('../CharCode.json');
	codex = await response.json();
})();

// #region Data
async function pushData(data) {
	try {
		const res = await fetch(`${apiBase}/api`, {
			headers: { 'Content-Type': 'application/json' },
			method: 'PUT',
			body: JSON.stringify(data),
		});
		return res.ok;
	} catch (err) {
		console.log(err);
		return false;
	}
}

function loadData(array) {
	messagesList.replaceChildren();

	const checkboxInput = document.getElementById('isEnabled');
	checkboxInput.checked = !!array.isEnabled;
	checkboxInput.onclick = function () {
		configData.isEnabled = !configData.isEnabled;
		pushData(configData);
	};

	const timerInput = document.getElementById('timerInput');
	const timerBtn = document.getElementById('timerInput-btn');
	timerInput.value = configData.timer / 60000;
	timerBtn.onclick = async function () {
		const minutes = Number(timerInput.value);
		if (!minutes || minutes <= 0) {
			showToast('Please enter a valid number of minutes', 'warning');
			return;
		}
		configData.timer = minutes * 60000;
		const saved = await pushData(configData);
		if (saved) showToast('Time interval updated');
		else showToast('Failed to update time interval', 'danger');
	};

	array.messages.forEach(createCard);
}

async function getData() {
	const res = await fetch(`${apiBase}/api`, { cache: 'no-store' });
	configData = await res.json();
	checkConfig(configData);
	loadData(configData);
}

function convertData() {
	return gridData.map(function (row) {
		return row.map(function (cell) {
			return codex[cell.toUpperCase()];
		});
	});
}

function checkConfig(configData) {
	if (!configData.apiWriteKey || configData.isValidKey == false) {
		document.getElementById('api-key-warning').style.display = 'block';
	}
	pushData(configData);
}

// #endregion

// #region Grid/Text
function createGrid() {
	const grid = document.getElementById('grid');
	for (let i = 0; i < gridY; i++) {
		for (let j = 0; j < gridX; j++) {
			grid.appendChild(createInput(i, j));
		}
	}
}

function createInput(i, j) {
	const input = document.createElement('input');
	input.className = 'grid-item';
	input.id = `${j},${i}`;

	input.addEventListener('keydown', function (evt) {
		function move(ni, nj) {
			const el = document.getElementById(`${nj},${ni}`);
			if (el) el.focus();
		}
		switch (evt.key) {
			case 'Backspace':
				input.value = '';
				gridData[i][j] = '';
				if (j === 0 && i === 0) move(0, 0);
				else if (j === 0) move(i - 1, gridX - 1);
				else move(i, j - 1);
				break;
			case 'ArrowRight':
				if (j >= gridX - 1 && i >= gridY - 1) move(0, 0);
				else if (j >= gridX - 1) move(i + 1, 0);
				else move(i, j + 1);
				break;
			case 'ArrowLeft':
				if (j === 0 && i === 0) move(0, 0);
				else if (j === 0) move(i - 1, gridX - 1);
				else move(i, j - 1);
				break;
			case 'ArrowUp':
				move(i === 0 ? 0 : i - 1, j);
				break;
			case 'ArrowDown':
				move(i === gridY - 1 ? i : i + 1, j);
				break;
		}
	});

	input.addEventListener('input', function (evt) {
		if (evt.data == null) return;
		if (evt.data !== ' ') gridData[i][j] = evt.data;
		var next =
			j >= gridX - 1 ? (i >= gridY - 1 ? [0, 0] : [i + 1, 0]) : [i, j + 1];
		var nextInput = document.getElementById(`${next[1]},${next[0]}`);
		if (nextInput) {
			nextInput.value = '';
			nextInput.focus();
		}
	});
	return input;
}

function clearGrid() {
	for (let i = 0; i < gridY; i++) {
		for (let j = 0; j < gridX; j++) {
			gridData[i][j] = '';
			const input = document.getElementById(`${j},${i}`);
			if (input) input.value = '';
		}
	}
}

function displayMessage() {
	let message = '';
	for (let i = 0; i < gridY; i++) {
		let row = '';
		for (let j = 0; j < gridX; j++) {
			row += gridData[i][j] || ' ';
		}
		message += row + '\n';
	}
	return message;
}

async function submitData(type) {
	try {
		if (!configData || !Array.isArray(configData.messages)) {
			showToast('Still loading… try again in a second', 'warning');
			return;
		}

		let msg, data;
		if (type === 'grid') {
			msg = displayMessage();
			data = JSON.stringify(convertData());
			clearGrid();
		} else if (type === 'text') {
			const textInputData = document.getElementById('textData');
			msg = textInputData.value;
			data = textInputData.value;
			textInputData.value = '';
		} else {
			console.error('Invalid type for submitData');
			return;
		}

		const { startDate, endDate } = getDateRange();

		//! Check if vaild date range
		if (
			eventData.isEvent &&
			(endDate < startDate || !endDate || !startDate)
		) {
			console.log('Invalid date range');
			showCustomAlert(
				'Invliad date range. Please enter a vaild date or uncheck "Show Date Range".'
			);
			return;
		}

		eventData.startDate = startDate;
		eventData.endDate = endDate;

		configData.messages.push({
			id: Date.now() + Math.floor(Math.random() * 1000),
			type,
			msg,
			data,
			eventData: eventData,
		});

		// Reset to a fresh object (avoids accidentally mutating the shared default)
		eventData = { ...eventDataDefualt };

		const saved = await pushData(configData);
		if (saved) {
			// Show the success toast after reload (iOS can be finicky about toasts
			// right before navigation).
			sessionStorage.setItem(
				'pendingToast',
				JSON.stringify({ message: 'Saved message', type: 'success' })
			);
			window.location.reload();
		} else {
			showToast('Save failed', 'danger');
		}
	} catch (err) {
		console.log(err);
		showToast(`Save failed: ${err?.message || err}`, 'danger');
	}
}

function getDateRange() {
	const startEl = document.getElementById('startDateText');
	const endEl = document.getElementById('endDateText');

	const startDate = startEl ? startEl.value : '';
	const endDate = endEl ? endEl.value : '';

	// Clearing via .value is more compatible than valueAsNumber on iOS.
	if (startEl) startEl.value = '';
	if (endEl) endEl.value = '';

	return { startDate, endDate };
}

// #endregion

// #region Message Section
async function deleteEntry(id) {
	try {
		const filteredData = (configData.messages = configData.messages.filter(
			message => {
				return message.id != id;
			}
		));
		configData.messages = filteredData;
		const saved = await pushData(configData);
		if (saved) showToast('Deleted message');
		else showToast('Delete failed', 'danger');
		loadData(configData);
	} catch (error) {
		console.log(error);
		showToast('Delete failed', 'danger');
	}
}

async function sendEntry(data) {
	try {
		const response = await fetch(`${apiBase}/api/send`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(data),
		});
		if (response.ok) showToast('Sent to board');
		else showToast('Send failed', 'danger');
	} catch (err) {
		console.log(err);
		showToast('Send failed', 'danger');
	}
}

function formatDate(dateStr) {
	if (!dateStr) return '';
	const date = new Date(dateStr);
	if (isNaN(date)) return dateStr;
	return date.toLocaleString('en-US', { hour12: true });
}

function createCard(messageData) {
	const card = document.createElement('div');
	card.className = messageData.eventData.isEvent
		? 'card has-background-warning'
		: 'card';

	const cardContent = document.createElement('div');
	cardContent.className = 'card-content container is-fluid ';
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
				messageData.eventData.startDate
			)}</span>
			<span class="has-text-grey-dark">-</span>
			<span class="has-text-weight-semibold">${formatDate(
				messageData.eventData.endDate
			)}</span>
		`;

		dateRangeSubText.className = 'is-size-7 has-text-grey';
		dateRangeSubText.innerHTML = `<span class="tag is-info is-light" style="margin-left: 5px;">Repeat Every Year: ${messageData.eventData.repeatEveryYear}</span>`;

		cardContent.appendChild(dateRangeText);
		cardContent.appendChild(dateRangeSubText);
	}

	const footer = document.createElement('footer');
	footer.className = 'card-footer';

	const del = document.createElement('a');
	del.className = 'card-footer-item has-background-danger has-text-white';
	del.innerText = 'Delete';
	del.onclick = function () {
		deleteEntry(messageData.id);
	};

	const send = document.createElement('a');
	send.className = 'card-footer-item has-background-primary has-text-white';
	send.innerText = 'Send to Board';
	send.onclick = function () {
		sendEntry(messageData);
	};

	footer.append(send, del);
	card.append(cardContent, footer);
	messagesList.appendChild(card);
}
// #endregion

// #region DOM

async function setApiKey() {
	const apiKey = await window.prompt('Please enter API key');
	if (!apiKey) return;
	configData.apiWriteKey = apiKey.trim();
	configData.isValidKey = true;
	await pushData(configData);
	window.location.reload();
}

async function resetApiKey() {
	configData.apiWriteKey = '';
	configData.isValidKey = false;
	const saved = await pushData(configData);
	if (saved) {
		showToast('API key reset');
		document.getElementById('api-key-warning').style.display = 'block';
		setTimeout(() => setApiKey(), 250);
	} else {
		showToast('Failed to reset API key', 'danger');
	}
}

function showCustomAlert(message) {
	const notification = document.createElement('div');
	notification.className = 'notification is-danger';
	notification.style.position = 'fixed';
	notification.style.top = '20px';
	notification.style.right = '20px';
	notification.style.zIndex = '9999';
	notification.innerHTML = `
        <button class="delete" onclick="this.parentElement.remove()"></button>
        ${message}
    `;

	document.body.appendChild(notification);

	setTimeout(() => {
		if (notification.parentElement) {
			notification.remove();
		}
	}, 5000);
}

function showToast(message, type = 'success') {
	const toast = document.createElement('div');
	toast.className = `notification is-${type}`;
	toast.style.position = 'fixed';
	toast.style.top = '20px';
	toast.style.right = '20px';
	toast.style.zIndex = '9999';
	toast.style.opacity = '0';
	toast.style.transition = 'opacity 0.2s ease';
	toast.innerHTML = `
        <button class="delete" onclick="this.parentElement.remove()"></button>
        ${message}
    `;

	document.body.appendChild(toast);

	requestAnimationFrame(() => {
		toast.style.opacity = '1';
	});

	setTimeout(() => {
		if (toast.parentElement) {
			toast.style.opacity = '0';
			setTimeout(() => toast.remove(), 200);
		}
	}, 2500);
}

document.getElementById('legend-toggle-btn').onclick = () =>
	document.getElementById('legend-modal').classList.add('is-active');

function closeEventModal() {
	document.getElementById('legend-modal').classList.remove('is-active');
}

function toggleDateRangeVisibility() {
	eventData.isEvent = document.getElementById('toggleDateRange').checked;
	document.getElementById('dateRangeText').style.display = eventData.isEvent
		? 'inline-block'
		: 'none';
}

function toggleRepeatEveryYear() {
	eventData.repeatEveryYear =
		document.getElementById('repeatEveryYear').checked;
}

document.addEventListener('DOMContentLoaded', () => {
	toggleDateRangeVisibility();
	consumePendingToast();
});

// #endregion

function main() {
	createGrid();
	getData();
}

main();

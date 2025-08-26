const messagesList = document.getElementById('messages');
const ipAddress = document.URL;

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
		await fetch(`${ipAddress}api/`, {
			headers: { 'Content-Type': 'application/json' },
			method: 'PUT',
			body: JSON.stringify(data),
		});
	} catch (err) {
		console.log(err);
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
	timerBtn.onclick = function () {
		configData.timer = timerInput.value * 60000;
		pushData(configData);
	};

	array.messages.forEach(createCard);
}

async function getData() {
	const res = await fetch(`${ipAddress}api/`);
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
	if (eventData.isEvent && (endDate < startDate || !endDate || !startDate)) {
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

	eventData = eventDataDefualt;

	window.location.reload();

	pushData(configData);
	loadData(configData);
}

function getDateRange() {
	startDate = document.getElementById('startDateText').value;
	endDate = document.getElementById('endDateText').value;

	document.getElementById('startDateText').valueAsNumber = NaN;
	document.getElementById('endDateText').valueAsNumber = NaN;

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
		pushData(configData);
		loadData(configData);
	} catch (error) {
		console.log(error);
	}
}

async function sendEntry(data) {
	try {
		const response = await fetch(`${ipAddress}api/send`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(data),
		});
		console.log(
			response.ok ? 'Entry sent successfully' : 'Failed to send entry'
		);
	} catch (err) {
		console.log(err);
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

async function promptApiKey() {
	const apiKey = await window.prompt('Please enter API key');
	configData.apiWriteKey = apiKey.trim();
	configData.isValidKey = true;
	if (apiKey) {
		await pushData(configData);
		window.location.reload();
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
});

// #endregion

function main() {
	createGrid();
	getData();
}

main();

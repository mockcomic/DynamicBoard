const dataList = document.getElementById('messages');
const ipAddress = document.URL;
const gridX = 22,
	gridY = 6;
const gridData = Array.from({ length: gridY }, () => Array(gridX).fill(''));
let isConnected = false;

let eventData = {
	isEvent: false,
	startDate: false,
	endDate: false,
	deleteAfterRange: false,
	repeatEveryYear: false,
};

let configData = {};
let codex = {};

(async function () {
	const response = await fetch('../CharCode.json');
	codex = await response.json();
})();

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

async function deleteEntry(index) {
	try {
		configData.messages.splice(index, 1);
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

function createCard(element, index) {
	console.log({ element, index });
	const card = document.createElement('div');
	card.className = 'card';

	const cardContent = document.createElement('div');
	cardContent.className = 'card-content container is-fluid';
	cardContent.style.margin = '10px';

	const title = document.createElement('p');
	title.className = 'title whiteText';
	title.innerText = element.msg;
	cardContent.appendChild(title);

	const footer = document.createElement('footer');
	footer.className = 'card-footer';

	const del = document.createElement('a');
	del.className = 'card-footer-item has-background-danger has-text-white';
	del.innerText = 'Delete';
	del.onclick = function () {
		deleteEntry(index);
	};

	const send = document.createElement('a');
	send.className = 'card-footer-item has-background-primary has-text-white';
	send.innerText = 'Send to Board';
	send.onclick = function () {
		sendEntry(element);
	};

	footer.append(send, del);
	card.append(cardContent, footer);
	dataList.appendChild(card);
}

function loadData(array) {
	dataList.replaceChildren();

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
	loadData(configData);
}

function convertData() {
	return gridData.map(function (row) {
		return row.map(function (cell) {
			return codex[cell.toUpperCase()];
		});
	});
}

async function submitGridData() {
	const vestaMsg = displayMessage();
	const vestaData = convertData();
	const parsedData = JSON.stringify(vestaData);

	configData.messages.push({
		type: 'grid',
		msg: vestaMsg,
		data: parsedData,
		eventData: eventData,
	});
	pushData(configData);
	loadData(configData);
	clearGrid();
}

async function submitTextData() {
	const textInputData = document.getElementById('textData');
	configData.messages.push({
		type: 'text',
		msg: textInputData.value,
		data: textInputData.value,
		eventData: eventData,
	});
	textInputData.value = '';
	pushData(configData);
	loadData(configData);
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

function createGrid() {
	const grid = document.getElementById('grid');
	for (let i = 0; i < gridY; i++) {
		for (let j = 0; j < gridX; j++) {
			grid.appendChild(createInput(i, j));
		}
	}
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

// Legend Modal
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

function toggleDeleteAfterRange() {
	eventData.deleteAfterRange =
		document.getElementById('deleteAfterRange').checked;
}

function toggleRepeatEveryYear() {
	eventData.deleteAfterRange =
		document.getElementById('repeatEveryYear').checked;
}

document.addEventListener('DOMContentLoaded', () => {
	toggleDateRangeVisibility();
});

createGrid();
getData();

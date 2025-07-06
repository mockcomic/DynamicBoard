const dataList = document.getElementById('messages');

const ipAddress = document.URL;

const gridX = 22;
const gridY = 6;
const gridData = [];

let isConnected = false;

let deleteAfterRange = false;
let repeatEveryYear = false;

let data = {};
let codex = {};

(async () => {
	const response = await fetch('../CharCode.json');
	codex = await response.json();
})();

const pushData = async data => {
	try {
		fetch(`${ipAddress}api/`, {
			headers: {
				'Content-Type': 'application/json',
			},
			method: 'PUT',
			body: JSON.stringify(data),
		});
	} catch (err) {
		console.log(err);
	}
};

const deleteEntry = index => {
	try {
		const left = data.messages.slice(0, index);
		const right = data.messages.slice(index + 1, data.messages.length);
		data.messages = left.concat(right);
		pushData(data);
		loadData(data);
	} catch (error) {
		console.log(error);
	}
};

const sendEntry = async data => {
	try {
		const response = await fetch(`${ipAddress}api/send`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(data),
		});
		if (response.ok) {
			console.log('Entry sent successfully');
		} else {
			console.log('Failed to send entry');
		}
	} catch (err) {
		console.log(err);
	}
};

const createCard = (element, index) => {
	const card = document.createElement('div');
	card.classList.add('card');

	const cardContent = document.createElement('div');
	cardContent.classList.add('card-content');

	cardContent.classList.add('container');
	cardContent.classList.add('is-fluid');
	cardContent.style = 'margin: 10px';

	const title = document.createElement('p');
	title.classList.add('title');
	title.classList.add('whiteText');

	title.innerText = `${element.msg}`;

	cardContent.appendChild(title);

	const footer = document.createElement('footer');
	footer.classList.add('card-footer');

	const del = document.createElement('a');
	del.classList.add('card-footer-item');
	del.classList.add('has-background-danger');
	del.classList.add('has-text-white');
	del.innerText = 'Delete';
	del.onclick = () => deleteEntry(index);

	const send = document.createElement('a');
	send.classList.add('card-footer-item');
	send.classList.add('has-background-primary');
	send.classList.add('has-text-white');
	send.innerText = 'Send to Board';
	send.onclick = () => sendEntry(element);

	footer.appendChild(send);

	footer.appendChild(del);

	card.appendChild(cardContent);
	card.appendChild(footer);

	dataList.appendChild(card);
};

const loadData = array => {
	dataList.replaceChildren();

	//*Checkbox --------------------------------------------------------------------------------------
	const checkboxInput = document.getElementById('isEnabled');

	if (array.isEnabled) checkboxInput.checked = true;
	checkboxInput.onclick = () => {
		if (data.isEnabled) {
			data.isEnabled = false;
		} else if (!data.isEnabled) {
			data.isEnabled = true;
		} else {
			//* If dirty data
			data.isEnabled = true;
		}
		pushData(data);
	};

	//*editTimeInput ----------------------------------------------------------------------------------
	const timerInput = document.getElementById('timerInput');
	const timerBtn = document.getElementById('timerInput-btn');

	timerInput.value = data.timer / 60000;

	timerBtn.onclick = () => {
		data.timer = timerInput.value * 60000;
		pushData(data);
	};

	array.messages.forEach((element, index) => {
		createCard(element, index);
	});
};

const getData = async () => {
	const res = await fetch(`${ipAddress}api/`);
	const resData = await res.json();
	data = await resData;
	await loadData(data);
};

const convertData = () => {
	const newArray = [];

	for (let i = 0; i < gridData.length; i++) {
		newArray[i] = gridData[i];
	}

	for (let i = 0; i < gridY; i++) {
		for (let j = 0; j < gridX; j++) {
			const value = newArray[i][j].toUpperCase();
			newArray[i][j] = codex[value];
		}
	}
	return newArray;
};

const submitGridData = async () => {
	const vestaMsg = await displayMessage();
	const vestaData = await convertData();
	const parsedData = JSON.stringify(vestaData);

	data.messages.push({
		type: 'grid',
		msg: vestaMsg,
		data: parsedData,
		isEvent: false,
	});

	pushData(data);
	loadData(data);
	clearGrid();
};

const submitTextData = async () => {
	const textInputData = document.getElementById('textData');

	data.messages.push({
		type: 'text',
		msg: textInputData.value,
		data: textInputData.value,
	});
	textInputData.value = '';

	pushData(data);
	loadData(data);
};

const createInput = (i, j) => {
	const input = document.createElement('input');

	input.classList.add('grid-item');

	//* emoji are more then 1 char long
	// input.maxLength = '1';

	input.id = `${j},${i}`;

	input.addEventListener('keydown', evt => {
		switch (evt.key) {
			case 'Backspace':
				document.getElementById(`${j},${i}`).value = '';
				gridData[i][j] = '';
				if (j == 0 && i == 0) {
					document.getElementById(`${0},${0}`).focus();
					return;
				}
				j == 0
					? document.getElementById(`${gridX - 1},${i - 1}`).focus()
					: document.getElementById(`${j - 1},${i}`).focus();
				break;

			case 'ArrowRight':
				if (j >= gridX - 1 && i >= gridY - 1) {
					document.getElementById(`${0},${0}`).focus();
					return;
				}
				j >= gridX - 1
					? document.getElementById(`${0},${i + 1}`).focus()
					: document.getElementById(`${j + 1},${i}`).focus();
				break;

			case 'ArrowLeft':
				if (j == 0 && i == 0) {
					document.getElementById(`${0},${0}`).focus();
					return;
				}
				j == 0
					? document.getElementById(`${gridX - 1},${i - 1}`).focus()
					: document.getElementById(`${j - 1},${i}`).focus();
				break;

			case 'ArrowUp':
				i == 0
					? document.getElementById(`${j},${i}`).focus()
					: document.getElementById(`${j},${i - 1}`).focus();
				break;

			case 'ArrowDown':
				i == gridY - 1
					? document.getElementById(`${j},${i}`).focus()
					: document.getElementById(`${j},${i + 1}`).focus();
				break;
		}
	});

	input.addEventListener('input', evt => {
		if (evt.data == null) return;
		if (evt.data !== ' ') gridData[i][j] = evt.data;

		if (j >= gridX - 1 && i >= gridY - 1) {
			document.getElementById(`${0},${0}`).value = '';
			document.getElementById(`${0},${0}`).focus();
			return;
		} else if (j >= gridX - 1) {
			document.getElementById(`${0},${i + 1}`).value = '';
			document.getElementById(`${0},${i + 1}`).focus();
		} else {
			document.getElementById(`${j + 1},${i}`).value = '';
			document.getElementById(`${j + 1},${i}`).focus();
		}
	});

	return input;
};

const createGrid = () => {
	const grid = document.getElementById('grid');
	for (let i = 0; i < gridY; i++) {
		gridData[i] = new Array(gridX).fill('');
		for (let j = 0; j < gridX; j++) {
			grid.appendChild(createInput(i, j));
		}
	}
};

const clearGrid = () => {
	for (let i = 0; i < gridY; i++) {
		for (let j = 0; j < gridX; j++) {
			gridData[i][j] = '';
			document.getElementById(`${j},${i}`).value = '';
		}
	}
};

//TODO find a solution to have whitespace in the message
const displayMessage = () => {
	let message = '';
	let padding = 0;
	for (let i = 0; i < gridY; i++) {
		for (let j = 0; j < gridX; j++) {
			if (gridData[i][j] == '') {
				console.log('empty');
				padding++;
			}

			message = message + gridData[i][j];
		}
		console.log('padding', padding);
		message = message.padStart(padding, ' ') + '\n';
		padding = 0;
	}
	return message;
};

// Legend Modal

document.getElementById('legend-toggle-btn').onclick = function () {
	document.getElementById('legend-modal').classList.add('is-active');
};

document.getElementById('close-legend-btn').onclick = function () {
	document.getElementById('legend-modal').classList.remove('is-active');
};

const toggleDateRangeVisibility = () => {
	const isChecked = document.getElementById('toggleDateRange').checked;
	const dateRangeInputs = document.getElementById('dateRangeText');
	dateRangeInputs.style.display = isChecked ? 'inline-block' : 'none';
};

const toggleRepeatEveryYear = () => {
	const isChecked = document.getElementById('repeatEveryYear').checked;
};

const toggleDeleteAfterRange = () => {
	const isChecked = document.getElementById('deleteAfterRange').checked;
};

document.addEventListener('DOMContentLoaded', () => {
	toggleDateRangeVisibility(); // Initialize visibility
});

createGrid();
getData();

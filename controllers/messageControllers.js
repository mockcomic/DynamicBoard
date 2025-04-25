const fs = require('fs');

let apiWriteKey = null;

let isLooping = false;
let data = null;
let intervalId = null;
let lastMsg = null;

const FC = require('./functionCalls');

const configCheck = () => {
	const filePath = './config.json';
	const defaultConfig = {
		isEnabled: true,
		timer: 120000,
		apiWriteKey: null,
		messages: [],
	};

	if (!fs.existsSync(filePath)) {
		console.log('config.json does not exist, creating it...');
		fs.writeFileSync(filePath, JSON.stringify(defaultConfig, null, 2));
		console.log(`Successfully created ${filePath}`);
	} else {
		console.log('config.json already exists.');
	}

	const config = JSON.parse(fs.readFileSync(filePath));
	apiWriteKey = config.apiWriteKey || null;

	if (!apiWriteKey) {
		console.error('No API key found in config.json. Please add it.');
	}
};

const checkVariable = string => {
	console.log(string);
	const indexStart = string.indexOf('{');
	const indexEnd = string.indexOf('}');

	if (indexStart === -1 || indexEnd === -1) return string;

	const left = string.slice(0, indexStart);
	const right = string.slice(indexEnd + 1);

	const command = string.slice(indexStart + 1, indexEnd);
	const paramStart = command.indexOf('(');
	const paramEnd = command.indexOf(')');

	const param = command.slice(paramStart + 1, paramEnd).split(',');
	const functionName = command.slice(0, paramStart);

	switch (functionName) {
		case 'tillDate':
			return left + `${FC.tillDate(param)}` + right;
		case 'date':
			return left + `${FC.date(param)}` + right;
		default:
			return string;
	}
};

const getCurrentMessage = async () => {
	await fetch('https://rw.vestaboard.com/', {
		headers: {
			'Content-Type': 'application/json',
			'X-Vestaboard-Read-Write-Key': apiWriteKey,
		},
		method: 'GET',
	}).then(res => res.json());
};

const writeGridVestaBoard = data => {
	fetch('https://rw.vestaboard.com/', {
		body: data,
		headers: {
			'Content-Type': 'application/json',
			'X-Vestaboard-Read-Write-Key': apiWriteKey,
		},
		method: 'POST',
	}).then(res => {
		console.log(`${res.status} ${res.statusText}`);
	});
};

const writeTextVestaBoard = data => {
	fetch('https://rw.vestaboard.com/', {
		body: JSON.stringify({
			text: data,
		}),
		headers: {
			'Content-Type': 'application/json',
			'X-Vestaboard-Read-Write-Key': apiWriteKey,
		},
		method: 'POST',
	}).then(res => {
		console.log(`${res.status} ${res.statusText}`);
	});
};

const processMessages = async () => {
	let index;

	if (!data.isEnabled) {
		isLooping = false;
		return;
	}

	if (lastMsg === null) {
		index = 0;
	} else {
		index = lastMsg + 1 > data.messages.length - 1 ? 0 : lastMsg + 1;
	}

	if (data.messages.length > 0) {
		console.log(data.timer);

		if (data.messages[index].type === 'grid') {
			writeGridVestaBoard(data.messages[index].data);
		}
		if (data.messages[index].type === 'text') {
			const msg = checkVariable(data.messages[index].data);
			writeTextVestaBoard(msg);
		}
	}

	lastMsg = index;
};

const loopMessages = () => {
	if (isLooping) return;

	isLooping = true;

	const loop = async () => {
		await processMessages();

		if (data && data.isEnabled) {
			// Schedule next loop using the updated timer
			intervalId = setTimeout(loop, data.timer);
		} else {
			isLooping = false;
			clearTimeout(intervalId);
		}
	};

	loop();
};

const update = () => {
	configCheck();

	setInterval(() => {
		fs.readFile('config.json', (err, file) => {
			if (err) throw err;

			const newData = JSON.parse(file);

			const wasEnabled = data?.isEnabled;
			const timerChanged = data?.timer !== newData.timer;

			data = newData;

			if (data.isEnabled) {
				if (!wasEnabled || timerChanged) {
					console.log(`Updating loop with new timer: ${data.timer}ms`);
					clearTimeout(intervalId);
					isLooping = false;
					loopMessages();
				}
			}
		});
	}, 5000);
};

update();

module.exports = {
	checkVariable,
	writeGridVestaBoard,
	writeTextVestaBoard,
};

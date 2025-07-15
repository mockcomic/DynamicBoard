const fs = require('fs');

let apiWriteKey = null;

let isLooping = false;
let data = null;
let intervalId = null;
let lastMsg = null;

const { functionCalls } = require('./functionCalls');

function configCheck() {
	const filePath = './config.json';

	if (!fs.existsSync(filePath)) {
		const defaultConfig = {
			isEnabled: true,
			timer: 120000,
			apiWriteKey: null,
			messages: [],
		};
		console.log('config.json does not exist, creating it...');
		fs.writeFileSync(filePath, JSON.stringify(defaultConfig, null, 2));
		console.log(`Successfully created ${filePath}`);
	} else {
		console.log('config.json already exists.');
	}

	const config = JSON.parse(fs.readFileSync(filePath));
	apiWriteKey = config.apiWriteKey || null;

	if (!apiWriteKey) {
		console.warn('No API key found in config.json. Please add it.');
	}
}

function checkVariable(string) {
	const match = string.match(/\{(.+?)\}/);
	if (!match) return string;

	const [placeholder, command] = match;
	const [functionName, params] = command.split(/\((.+)\)/).filter(Boolean);

	if (functionCalls[functionName]) {
		const result = functionCalls[functionName].callBack(params.split(','));
		console.log(string.replace(placeholder, result));
		return string.replace(placeholder, result);
	}

	return string;
}

module.exports = {
	checkVariable,
	writeGridVestaBoard,
	writeTextVestaBoard,
};

async function getCurrentMessage() {
	await fetch('https://rw.vestaboard.com/', {
		headers: {
			'Content-Type': 'application/json',
			'X-Vestaboard-Read-Write-Key': apiWriteKey,
		},
		method: 'GET',
	}).then(function (res) {
		return res.json();
	});
}

function writeGridVestaBoard(data) {
	fetch('https://rw.vestaboard.com/', {
		body: data,
		headers: {
			'Content-Type': 'application/json',
			'X-Vestaboard-Read-Write-Key': apiWriteKey,
		},
		method: 'POST',
	}).then(function (res) {
		console.log(res.status + ' ' + res.statusText);
	});
}

function writeTextVestaBoard(data) {
	fetch('https://rw.vestaboard.com/', {
		body: JSON.stringify({
			text: data,
		}),
		headers: {
			'Content-Type': 'application/json',
			'X-Vestaboard-Read-Write-Key': apiWriteKey,
		},
		method: 'POST',
	}).then(function (res) {
		console.log(res.status + ' ' + res.statusText);
	});
}

async function processMessages() {
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
}

function loopMessages() {
	if (isLooping) return;

	isLooping = true;

	const loop = async function () {
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
}

function update() {
	configCheck();

	setInterval(function () {
		fs.readFile('config.json', function (err, file) {
			if (err) throw err;

			const newData = JSON.parse(file);

			const wasEnabled = data?.isEnabled;
			const timerChanged = data?.timer !== newData.timer;

			data = newData;

			if (data.isEnabled) {
				if (!wasEnabled || timerChanged) {
					console.log('Updating loop with new timer: ' + data.timer + 'ms');
					clearTimeout(intervalId);
					isLooping = false;
					loopMessages();
				}
			}
		});
	}, 5000);
}

update();

// module.exports = {
// 	checkVariable: checkVariable,
// 	writeGridVestaBoard: writeGridVestaBoard,
// 	writeTextVestaBoard: writeTextVestaBoard,
// };

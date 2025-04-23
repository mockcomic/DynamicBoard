const fs = require('fs');

const apiWriteKey = process.env.writeKey || null;

let isLooping = false;
let data = null;
let lastMsg = null;

const FC = require('./functionCalls');

const configCheck = () => {
	const filePath = './config.json';

	fs.access(filePath, fs.constants.F_OK, err => {
		const defaultConfig = {
			isEnabled: true,
			timer: 120000, // default 2 minutes
			messages: [],
		};
		if (err) {
			console.log('config.json does not exist, creating it...');
			fs.writeFile(
				filePath,
				JSON.stringify(defaultConfig, null, 2),
				writeErr => {
					if (writeErr) {
						console.error(`Error writing to ${filePath}`, writeErr);
					} else {
						console.log(`Successfully created ${filePath}`);
					}
				}
			);
		} else {
			console.log('config.json already exists.');
		}
	});
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
	if (isLooping) return; // Prevent starting multiple loops

	isLooping = true;

	const loop = async () => {
		await processMessages();

		// Set the next loop after the configured timer
		if (data && data.isEnabled) {
			setTimeout(loop, data.timer);
		}
	};

	loop(); // Start the loop
};

const update = () => {
	configCheck();

	//* Check to see if any changes to the JSON file
	setInterval(() => {
		fs.readFile('config.json', (err, file) => {
			if (err) throw err;

			data = JSON.parse(file);

			if (data.isEnabled && !isLooping) {
				loopMessages();
			}
		});
	}, 5000); // Check for changes every 5 seconds
};

update();

module.exports = {
	checkVariable,
	writeGridVestaBoard,
	writeTextVestaBoard,
};

const fs = require('fs');

const apiWriteKey = process.env.writeKey || null;
const apiCloudKey = process.env.cloudKey || null;
const apiSecret = process.env.secret || null;
const subId = process.env.subId || null;

let isLooping = false;
let data = null;
let lastMsg = null;

const FC = require('./functionCalls');

const configCheck = () => {
	const filePath = './config.json';

	fs.access(filePath, fs.constants.F_OK, err => {
		const defaultConfig = {
			isEnabled: true,
			timer: 120000,
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

	if (indexStart == -1 || indexEnd == -1) return string;

	const left = string.slice(0, indexStart);
	const right = string.slice(indexEnd + 1);

	const command = string.slice(indexStart + 1, indexEnd);
	const paramStart = command.indexOf('(');
	const paramEnd = command.indexOf(')');

	const param = command.slice(paramStart + 1, paramEnd).split(',');
	const functionName = command.slice(0, paramStart);
	//todo need to return string with function removed

	switch (functionName) {
		case 'tillDate':
			return left + `${FC.tillDate(param)}` + right;
		case 'date':
			return left + `${FC.date(param)}` + right;
	}
};

const getAllMessages = async (req, res) => {
	fs.readFile('config.json', (err, data) => {
		if (err) {
			res.status(400);
		}
		res.status(200).json(JSON.parse(data));
	});
};

const updateMessage = (req, res) => {
	const msg = JSON.stringify(req.body);

	fs.writeFile('config.json', msg, err => {
		if (err) {
			res.status(400).json('Error updating JSON');
		}
		res.status(200).json('JSON data is saved.');
	});
};

const getCurrentMessage = async () => {
	await fetch('https://rw.vestaboard.com/', {
		headers: {
			'Content-Type': 'application/json',
			'X-Vestaboard-Read-Write-Key': apiWriteKey,
		},
		method: 'GET',
	}).then(res => {
		return res.json();
	});
};

const writeGridVestaBoard = async data => {
	await fetch('https://rw.vestaboard.com/', {
		body: JSON.stringify(data),
		headers: {
			'Content-Type': 'application/json',
			'X-Vestaboard-Read-Write-Key': apiWriteKey,
		},
		method: 'POST',
	}).then(res => {
		console.log(res);
		console.log(res.body);
	});
};

const writeTextVestaBoard = data => {
	fetch(`https://platform.vestaboard.com/subscriptions/${subId}/message`, {
		method: 'POST',
		body: JSON.stringify({
			text: data,
		}),
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			'X-Vestaboard-Api-Key': `${apiCloudKey}`,
			'X-Vestaboard-Api-Secret': `${apiSecret}`,
		},
	}).then(res => {
		console.log(res);
		console.log(res.body);
	});
};

const loopMessages = async () => {
	setInterval(async () => {
		let index;

		if (!data.isEnabled) {
			isLooping = false;
			return;
		}

		if (lastMsg == null) {
			index = 0;
		} else {
			index = lastMsg + 1 > data.messages.length - 1 ? 0 : lastMsg + 1;
		}

		if (!data.messages.length == 0) {
			console.log(data.messages[index].type);
			if (data.messages[index].type == 'grid') {
				writeGridVestaBoard(data.messages[index].data);
			}
			if (data.messages[index].type == 'text') {
				console.log(data.messages);
				console.log('index', index);
				const msg = checkVariable(data.messages[index].data);
				writeTextVestaBoard(msg);
			}
		}

		lastMsg = index;
	}, data.timer);
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

				isLooping = true;
			}
		});
	}, 5000);
};

update();

module.exports = {
	checkVariable,
	getAllMessages,
	updateMessage,
	writeGridVestaBoard,
	writeTextVestaBoard,
};

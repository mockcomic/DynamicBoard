const fs = require('fs');
const moment = require('moment');

let config = null;

let isLooping = false;
let data = null;
let intervalId = null;
let lastMsg = null;

const functionCalls = {
	tillDate: {
		name: 'tillDate',
		description:
			'Returns the difference in days between today and the given date.',
		callBack: arr => {
			const today = new Date();
			const yyyy = today.getFullYear();
			let mm = today.getMonth() + 1; // Months start at 0!
			let dd = today.getDate();

			let date1 = new Date(`$${mm}/${dd},${yyyy}`);
			let date2 = new Date(`${arr[0]}/${arr[1]}/${arr[2]}`);

			let Difference_In_Time = date2.getTime() - date1.getTime();
			let Difference_In_Days = Difference_In_Time / (1000 * 3600 * 24);

			return Difference_In_Days < 0
				? Math.round(Difference_In_Days) * -1
				: Math.round(Difference_In_Days);
		},
	},
	todayDate: {
		name: 'todayDate',
		description: 'Returns todays date.',
		callBack: () => {
			return new Date()
				.toISOString()
				.slice(0, 10)
				.split('-')
				.reverse()
				.join('/');
		},
	},
};

function updateConfig(data) {
	fs.writeFileSync('./config.json', JSON.stringify(data));
}

function configCheck() {
	const filePath = './config.json';

	if (!fs.existsSync(filePath)) {
		const defaultConfig = {
			isEnabled: true,
			timer: 120000,
			apiWriteKey: null,
			isValidKey: null,
			messages: [],
		};
		console.log('config.json does not exist, creating it...');
		updateConfig(defaultConfig);
		console.log(`Successfully created ${filePath}`);
	} else {
		console.log('config.json already exists.');
	}

	config = JSON.parse(fs.readFileSync(filePath));
	if (!config.apiWriteKey || null) {
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

async function sendToVestaboard(data, dataType) {
	console.log(data);
	try {
		const body =
			dataType === 'grid'
				? JSON.stringify(data)
				: JSON.stringify({ text: data });

		const res = await fetch('https://rw.vestaboard.com/', {
			body,
			headers: {
				'Content-Type': 'application/json',
				'X-Vestaboard-Read-Write-Key': config.apiWriteKey,
			},
			method: 'POST',
		});
		console.log(res.status + ' ' + res.statusText);
		if (res.status === 403) {
			console.log('Invalid apiWriteKey, isValidKey set to false');
			console.log(config.apiWriteKey);
			config.isValidKey = false;
			updateConfig(config);
		}
	} catch (error) {
		console.error('Error in sendToVestaboard:', error);
		updateConfig(config);
	}
}

function deleteMessage(id) {
	const filteredData = (data.messages = data.messages.filter(message => {
		console.log(message.id, id, message.id == id);
		return message.id != id;
	}));
	data.messages = filteredData;
	updateConfig(data);
}

async function proccessEvent(messageData) {
	const { eventData } = messageData;
	if (!eventData.startDate || !eventData.endDate) return;

	const isYearly = eventData.repeatEveryYear;
	const today = moment();
	const start = isYearly
		? moment(eventData.startDate).month(today.month()).date(today.date())
		: moment(eventData.startDate);
	const end = isYearly
		? moment(eventData.endDate).month(today.month()).date(today.date())
		: moment(eventData.endDate);

	console.log({ start, end });

	if (today.isBetween(start, end, null, '[]')) {
		console.log('Today is within the range!');
		return true;
	}

	if (!isYearly && start.isAfter(today) && eventData.deleteAfterRange) {
		console.log('Deleting message');
		await deleteMessage(messageData.id);
	}

	return false;
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
		const messageData = data.messages[index];
		console.log(data.timer);

		if (messageData.eventData.isEvent == true) {
			const validMessage = proccessEvent(messageData);

			if (!validMessage) {
				configCheck();
				processMessages();
				return;
			}
		}

		if (messageData.type === 'grid') {
			sendToVestaboard(data.messages[index].data, 'grid');
		} else if (messageData.type === 'text') {
			const msg = checkVariable(messageData.data);
			sendToVestaboard(msg, 'text');
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

function main() {
	configCheck();
	setInterval(function () {
		if (config.apiWriteKey) {
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
		}
	}, 5000);
}

main();

module.exports = {
	checkVariable: checkVariable,
	sendToVestaboard: sendToVestaboard,
};

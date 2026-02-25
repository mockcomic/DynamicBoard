const fs = require('fs');
const moment = require('moment');
const { logInfo, logWarn, logError } = require('../utils/logger');

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
			const [monthRaw, dayRaw, yearRaw] = arr;
			const month = Number(monthRaw);
			const day = Number(dayRaw);
			const year = Number(yearRaw);

			if (![month, day, year].every(Number.isFinite)) {
				logWarn('Invalid tillDate arguments', { args: arr });
				return NaN;
			}

			const targetDate = moment(
				`${year}-${month}-${day}`,
				'YYYY-M-D',
				true
			).startOf('day');

			if (!targetDate.isValid()) {
				logWarn('Invalid tillDate date', { args: arr });
				return NaN;
			}

			const today = moment().startOf('day');
			return Math.abs(targetDate.diff(today, 'days'));
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
	try {
		fs.writeFileSync('./config.json', JSON.stringify(data));
	} catch (error) {
		logError('Failed to write config.json', error);
	}
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
		logWarn('config.json does not exist, creating it...');
		updateConfig(defaultConfig);
		logInfo(`Successfully created ${filePath}`);
	}

	config = JSON.parse(fs.readFileSync(filePath));
	if (!config.apiWriteKey || null) {
		logWarn('No API key found in config.json. Please add it.');
	}
}

function checkVariable(string) {
	const match = string.match(/\{(.+?)\}/);
	if (!match) return string;

	const [placeholder, command] = match;
	const commandMatch = command.match(/^([a-zA-Z0-9_]+)(?:\((.*)\))?$/);
	if (!commandMatch) return string;

	const [, functionName, rawParams = ''] = commandMatch;
	const params =
		rawParams === ''
			? []
			: rawParams.split(',').map(param => param.trim());

	if (functionCalls[functionName]) {
		const result = functionCalls[functionName].callBack(params);
		logInfo('Template variable replaced', {
			placeholder,
			result,
		});
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
	logInfo('Sending to Vestaboard', { type: dataType });
	if (!config?.apiWriteKey) {
		logWarn('Missing apiWriteKey, cannot send to Vestaboard');
		return { ok: false, status: 400, statusText: 'missing_api_key' };
	}
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
		logInfo('Vestaboard response', {
			status: res.status,
			statusText: res.statusText,
		});
		if (res.status === 403) {
			logWarn('Invalid apiWriteKey, isValidKey set to false');
			config.isValidKey = false;
			updateConfig(config);
		}
		return { ok: res.ok, status: res.status, statusText: res.statusText };
	} catch (error) {
		logError('Error in sendToVestaboard', error);
		updateConfig(config);
		return { ok: false, status: 0, statusText: 'network_error' };
	}
}

function deleteMessage(id) {
	const filteredData = (data.messages = data.messages.filter(message => {
		logInfo('Evaluating message for delete', {
			messageId: message.id,
			targetId: id,
			match: message.id == id,
		});
		return message.id != id;
	}));
	data.messages = filteredData;
	updateConfig(data);
	logInfo('Deleted message from config', { id });
}

async function processEvent(messageData) {
	const { eventData } = messageData;
	if (!eventData.startDate || !eventData.endDate) return;

	const isYearly = eventData.repeatEveryYear;

	const now = moment();
	const startRaw = moment(eventData.startDate);
	const endRaw = moment(eventData.endDate);

	if (!startRaw.isValid() || !endRaw.isValid()) return false;

	let start = startRaw;
	let end = endRaw;

	if (isYearly) {
		// Repeat every year based on month/day/time, including ranges that span the year boundary.
		start = startRaw.clone().year(now.year());
		end = endRaw.clone().year(now.year());

		if (end.isBefore(start)) {
			// Example: Dec 1 - Feb 25 should wrap into the next year.
			if (now.isBefore(end)) {
				start = start.subtract(1, 'year');
			} else {
				end = end.add(1, 'year');
			}
		}
	} else if (end.isBefore(start)) {
		logWarn('Invalid date range on message', { id: messageData.id });
		return false;
	}

	logInfo('Event range check', {
		id: messageData.id,
		isYearly,
		start: start.toISOString(),
		end: end.toISOString(),
	});
	if (now.isBetween(start, end, undefined, '[]')) {
		logInfo('Event is within range', { id: messageData.id });
		return true;
	} else if (!isYearly && now.isAfter(end)) {
		logInfo('Deleting expired non-yearly message', { id: messageData.id });
		await deleteMessage(messageData.id);
	}

	return false;
}

async function processMessages() {
	if (!data?.isEnabled) {
		logInfo('Message loop disabled');
		isLooping = false;
		return;
	}

	const len = Array.isArray(data?.messages) ? data.messages.length : 0;
	if (len === 0) {
		logInfo('No messages to process');
		isLooping = false;
		return;
	}

	let idx = lastMsg == null ? 0 : (lastMsg + 1) % len;

	for (let attempts = 0; attempts < len; attempts++) {
		const messageData = data.messages[idx];

		if (messageData?.eventData?.isEvent === true) {
			const validMessage = await processEvent(messageData);
			if (!validMessage) {
				await configCheck();
				idx = (idx + 1) % len;
				continue;
			}
		}

		if (messageData?.type === 'grid') {
			await sendToVestaboard(messageData.data, 'grid');
		} else if (messageData?.type === 'text') {
			const msg = checkVariable(messageData.data);
			await sendToVestaboard(msg, 'text');
		}

		lastMsg = idx;
		logInfo('Processed message', { id: messageData.id, index: idx });
		return;
	}

	isLooping = false;
}

function loopMessages() {
	if (isLooping) return;

	isLooping = true;
	logInfo('Starting message loop');

	const loop = async function () {
		await processMessages();

		if (data && data.isEnabled) {
			// Schedule next loop using the updated timer
			intervalId = setTimeout(loop, data.timer);
		} else {
			isLooping = false;
			clearTimeout(intervalId);
			logInfo('Stopping message loop');
		}
	};

	loop();
}

function main() {
	setInterval(function () {
		configCheck();
		if (config.apiWriteKey) {
			fs.readFile('config.json', function (err, file) {
				if (err) {
					logError('Failed to read config.json', err);
					return;
				}

				const newData = JSON.parse(file);

				const wasEnabled = data?.isEnabled;
				const timerChanged = data?.timer !== newData.timer;

				data = newData;

				if (data.isEnabled) {
					if (!wasEnabled || timerChanged) {
						logInfo('Updating loop with new timer', { timer: data.timer });
						clearTimeout(intervalId);
						isLooping = false;
						loopMessages();
					}
				}
			});
		}
	}, 5000);
}

if (process.env.DYNAMICBOARD_DISABLE_MAIN !== '1') {
	main();
}

function __setConfigForTests(nextConfig) {
	config = nextConfig;
}

function __getConfigForTests() {
	return config;
}

function __resetStateForTests() {
	clearTimeout(intervalId);
	intervalId = null;
	config = null;
	data = null;
	lastMsg = null;
	isLooping = false;
}

module.exports = {
	checkVariable: checkVariable,
	sendToVestaboard: sendToVestaboard,
	__setConfigForTests,
	__getConfigForTests,
	__resetStateForTests,
};

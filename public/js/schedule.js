// Schedule ("event") modal: date range, presets, yearly repeat.
import { formatDate, showToast, log, openModal, closeModal } from './ui.js';

export const eventDataDefualt = {
	isEvent: false,
	startDate: '',
	endDate: '',
	repeatEveryYear: false,
};

export let eventData = { ...eventDataDefualt };

export function getDateRange() {
	const startEl = document.getElementById('startDateText');
	const endEl = document.getElementById('endDateText');

	const startDate = startEl ? startEl.value : '';
	const endDate = endEl ? endEl.value : '';

	return { startDate, endDate };
}

export function syncScheduleStateFromInputs() {
	const isEventInput = document.getElementById('toggleDateRange');
	const repeatInput = document.getElementById('repeatEveryYear');
	eventData.isEvent = !!isEventInput?.checked;
	eventData.repeatEveryYear = !!repeatInput?.checked;
}

export function updateScheduleSummary() {
	const summaryEl = document.getElementById('schedule-summary');
	if (!summaryEl) return;

	if (!eventData.isEvent) {
		summaryEl.textContent = 'No schedule set for next message.';
		return;
	}

	const { startDate, endDate } = getDateRange();
	if (!startDate || !endDate) {
		summaryEl.textContent =
			'Schedule enabled. Set both start and end before submitting.';
		return;
	}

	const repeatText = eventData.repeatEveryYear ? ' (yearly)' : '';
	summaryEl.textContent = `Scheduled: ${formatDate(startDate)} to ${formatDate(endDate)}${repeatText}`;
}

export function setScheduleRangeToAllDay() {
	const allDayInput = document.getElementById('schedule-all-day');
	if (!allDayInput?.checked) return;

	const startEl = document.getElementById('startDateText');
	const endEl = document.getElementById('endDateText');
	if (!startEl || !endEl || !startEl.value || !endEl.value) return;

	const startDate = new Date(startEl.value);
	const endDate = new Date(endEl.value);
	if (isNaN(startDate) || isNaN(endDate)) return;

	const toLocalInputValue = date => {
		const pad = n => String(n).padStart(2, '0');
		return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
			date.getDate(),
		)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
	};

	startDate.setHours(0, 0, 0, 0);
	endDate.setHours(23, 59, 0, 0);

	startEl.value = toLocalInputValue(startDate);
	endEl.value = toLocalInputValue(endDate);
}

export function formatLocalDatetimeInputValue(date) {
	const pad = n => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
		date.getDate(),
	)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function setStartNowIfRequested() {
	const startNowInput = document.getElementById('schedule-start-now');
	const startEl = document.getElementById('startDateText');
	if (!startNowInput?.checked || !startEl) return;
	startEl.value = formatLocalDatetimeInputValue(new Date());
}

export function setScheduleControlsEnabled(isEnabled) {
	const ids = [
		'startDateText',
		'endDateText',
		'repeatEveryYear',
		'schedule-all-day',
		'schedule-start-now',
		'schedule-preset-24h',
		'schedule-preset-7d',
		'schedule-preset-weekend',
	];

	ids.forEach(id => {
		const el = document.getElementById(id);
		if (!el) return;
		el.disabled = !isEnabled;
	});
}

export function applySchedulePreset(preset) {
	const toggle = document.getElementById('toggleDateRange');
	const startEl = document.getElementById('startDateText');
	const endEl = document.getElementById('endDateText');
	const repeatEl = document.getElementById('repeatEveryYear');
	if (!toggle || !startEl || !endEl || !repeatEl) return;

	toggle.checked = true;
	repeatEl.checked = false;

	const now = new Date();
	let start = new Date(now);
	let end = new Date(now);

	if (preset === '24h') {
		end.setHours(end.getHours() + 24);
	}

	if (preset === '7d') {
		end.setDate(end.getDate() + 7);
	}

	if (preset === 'weekend') {
		const day = now.getDay();
		const daysUntilSaturday = (6 - day + 7) % 7;
		start = new Date(now);
		start.setDate(now.getDate() + daysUntilSaturday);
		start.setHours(0, 0, 0, 0);
		end = new Date(start);
		end.setDate(start.getDate() + 1);
		end.setHours(23, 59, 0, 0);
	}

	startEl.value = formatLocalDatetimeInputValue(start);
	endEl.value = formatLocalDatetimeInputValue(end);

	syncScheduleStateFromInputs();
	setScheduleControlsEnabled(true);
	updateScheduleSummary();
}

export function clearScheduleSettings(showToastNotice = true) {
	const isEventInput = document.getElementById('toggleDateRange');
	const repeatInput = document.getElementById('repeatEveryYear');
	const allDayInput = document.getElementById('schedule-all-day');
	const startEl = document.getElementById('startDateText');
	const endEl = document.getElementById('endDateText');

	if (isEventInput) isEventInput.checked = false;
	if (repeatInput) repeatInput.checked = false;
	if (allDayInput) allDayInput.checked = false;
	if (startEl) startEl.value = '';
	if (endEl) endEl.value = '';

	eventData = { ...eventDataDefualt };
	setScheduleControlsEnabled(false);
	updateScheduleSummary();
	if (showToastNotice) showToast('Schedule cleared');
}

export function openScheduleModal() {
	const modal = document.getElementById('schedule-modal');
	if (!modal) return;

	const isEventInput = document.getElementById('toggleDateRange');
	const repeatInput = document.getElementById('repeatEveryYear');
	if (isEventInput) isEventInput.checked = eventData.isEvent;
	if (repeatInput) repeatInput.checked = eventData.repeatEveryYear;

	setScheduleControlsEnabled(eventData.isEvent);
	openModal('schedule-modal');
}

export function closeScheduleModal() {
	closeModal('schedule-modal');
}

export function applyScheduleSettings() {
	syncScheduleStateFromInputs();
	setStartNowIfRequested();
	setScheduleRangeToAllDay();

	if (!eventData.isEvent) {
		updateScheduleSummary();
		closeScheduleModal();
		showToast('Scheduling disabled for next message');
		return;
	}

	const { startDate, endDate } = getDateRange();
	const startVal = startDate ? new Date(startDate) : null;
	const endVal = endDate ? new Date(endDate) : null;
	const invalidOrder = startVal && endVal ? endVal < startVal : false;

	if (!startVal || !endVal || (!eventData.repeatEveryYear && invalidOrder)) {
		showToast('Please enter a valid schedule range', 'warning');
		return;
	}

	eventData.startDate = startDate;
	eventData.endDate = endDate;
	updateScheduleSummary();
	closeScheduleModal();
	showToast('Schedule applied');
}

// Validates the currently selected schedule; returns false and alerts on bad input.
export function validateScheduleForSubmit() {
	const { startDate, endDate } = getDateRange();
	const startVal = startDate ? new Date(startDate) : null;
	const endVal = endDate ? new Date(endDate) : null;
	const invalidOrder = startVal && endVal ? endVal < startVal : false;

	if (
		eventData.isEvent &&
		(!startVal || !endVal || (!eventData.repeatEveryYear && invalidOrder))
	) {
		log('warn', 'Invalid date range');
		showToast(
			'Invalid schedule range. Open Schedule and provide valid dates or disable scheduling.',
			'danger',
		);
		return false;
	}

	eventData.startDate = startDate;
	eventData.endDate = endDate;
	return true;
}

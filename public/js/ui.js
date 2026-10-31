// Shared UI helpers: console logging, API error extraction, toasts, modals.

export function log(level, message, meta) {
	const prefix = `[Dynamicboard] [${level.toUpperCase()}] ${message}`;
	const output = meta instanceof Error ? meta.message : meta;
	switch (level) {
		case 'error':
			output !== undefined
				? console.error(prefix, output)
				: console.error(prefix);
			break;
		case 'warn':
			output !== undefined
				? console.warn(prefix, output)
				: console.warn(prefix);
			break;
		default:
			output !== undefined ? console.log(prefix, output) : console.log(prefix);
			break;
	}
}

export async function readServerError(res) {
	try {
		const text = await res.text();
		if (!text) return res.statusText || `HTTP ${res.status}`;
		try {
			const json = JSON.parse(text);
			if (json.error && json.details) {
				return `${json.error}: ${json.details}`;
			}
			return json.error || json.message || text;
		} catch {
			return text;
		}
	} catch (err) {
		log('warn', 'Failed to read server error', err);
		return res.statusText || `HTTP ${res.status}`;
	}
}

export function consumePendingToast() {
	try {
		const raw = sessionStorage.getItem('pendingToast');
		if (!raw) return;
		sessionStorage.removeItem('pendingToast');
		const t = JSON.parse(raw);
		if (t && t.message) showToast(t.message, t.type || 'success');
	} catch (err) {
		// If toast parsing fails, don't break the page.
		log('warn', 'Failed to read pending toast', err);
	}
}

const TOAST_TYPE_CLASSES = {
	success: 'is-success',
	danger: 'is-danger',
	warning: 'is-warning',
	info: 'is-info',
	link: 'is-link',
	dark: 'is-dark',
};

function getToastContainer() {
	let container = document.getElementById('toast-container');
	if (!container) {
		container = document.createElement('div');
		container.id = 'toast-container';
		container.className = 'toast-container';
		container.setAttribute('role', 'status');
		container.setAttribute('aria-live', 'polite');
		document.body.appendChild(container);
	}
	return container;
}

function removeToast(toast) {
	if (!toast.isConnected) return;
	toast.classList.remove('is-visible');
	window.setTimeout(() => toast.remove(), 200);
}

/**
 * Shows a dismissible toast inside the shared stacking container.
 *
 * options:
 *   duration      – ms before auto-dismiss (0 keeps it until dismissed; default 2500)
 *   actionLabel   – label for an optional action button (e.g. "Undo", "Refresh")
 *   onAction      – callback fired when the action button is clicked
 *   actionClass   – Bulma color classes for the action button (default "is-light")
 *
 * Returns a dismiss function.
 */
export function showToast(message, type = 'success', options = {}) {
	const toast = document.createElement('div');
	toast.className = `notification ${TOAST_TYPE_CLASSES[type] || 'is-dark'}`;

	const text = document.createElement('span');
	text.className = 'toast-message';
	text.textContent = message;
	toast.appendChild(text);

	const dismiss = () => removeToast(toast);

	if (typeof options.onAction === 'function') {
		const action = document.createElement('button');
		action.type = 'button';
		action.className = `button is-small toast-action ${options.actionClass || 'is-light'}`;
		action.textContent = options.actionLabel || 'OK';
		action.onclick = () => {
			dismiss();
			options.onAction();
		};
		toast.appendChild(action);
	}

	const close = document.createElement('button');
	close.type = 'button';
	close.className = 'delete is-small';
	close.setAttribute('aria-label', 'Dismiss notification');
	close.onclick = dismiss;
	toast.appendChild(close);

	getToastContainer().appendChild(toast);
	requestAnimationFrame(() => toast.classList.add('is-visible'));

	const duration = typeof options.duration === 'number' ? options.duration : 2500;
	if (duration > 0) window.setTimeout(dismiss, duration);

	return dismiss;
}

/**
 * Disables a button (and shows Bulma's spinner) while an async action runs.
 */
export async function withBusy(button, run) {
	if (!button) return run();
	const wasDisabled = button.disabled;
	button.disabled = true;
	button.classList.add('is-loading');
	try {
		return await run();
	} finally {
		button.disabled = wasDisabled;
		button.classList.remove('is-loading');
	}
}

export function openModal(id) {
	const modal = document.getElementById(id);
	if (!modal) return;
	modal.classList.add('is-active');
	document.documentElement.classList.add('is-clipped');
}

export function closeModal(id) {
	const modal = document.getElementById(id);
	if (!modal) return;
	modal.classList.remove('is-active');
	if (!document.querySelector('.modal.is-active')) {
		document.documentElement.classList.remove('is-clipped');
	}
}

// Escape closes the topmost open modal, mirroring the close buttons.
document.addEventListener('keydown', evt => {
	if (evt.key !== 'Escape') return;
	const active = [...document.querySelectorAll('.modal.is-active')].pop();
	if (!active) return;
	closeModal(active.id);
});

export function formatDate(dateStr) {
	if (!dateStr) return '';
	const date = new Date(dateStr);
	if (isNaN(date)) return dateStr;
	return date.toLocaleString('en-US', { hour12: true });
}

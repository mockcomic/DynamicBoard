// 22x6 Vestaboard grid editor.

const gridX = 22;
const gridY = 6;
const gridData = Array.from({ length: gridY }, () => Array(gridX).fill(''));

let codex = {};

export { gridX, gridY, gridData };

export function setCodex(nextCodex) {
	codex = nextCodex && typeof nextCodex === 'object' ? nextCodex : {};
}

export function convertData() {
	return gridData.map(function (row) {
		return row.map(function (cell) {
			return codex[cell.toUpperCase()];
		});
	});
}

// Characters typed into the grid that the Vestaboard code table cannot encode.
export function findUnsupportedChars() {
	const unsupported = new Set();
	gridData.forEach(row =>
		row.forEach(cell => {
			if (cell && codex[cell.toUpperCase()] === undefined) {
				unsupported.add(cell);
			}
		}),
	);
	return [...unsupported];
}

export function isGridEmpty() {
	return gridData.every(row => row.every(cell => !cell));
}

function createInput(i, j) {
	const input = document.createElement('input');
	input.className = 'grid-item';
	input.id = `${j},${i}`;
	input.type = 'text';
	input.maxLength = 1;
	input.autocomplete = 'off';
	input.autocapitalize = 'characters';
	input.spellcheck = false;
	const updateLabel = () =>
		input.setAttribute(
			'aria-label',
			`Row ${i + 1} of ${gridY}, column ${j + 1} of ${gridX}${
				gridData[i][j] ? `, ${gridData[i][j]}` : ', empty'
			}`,
		);
	updateLabel();

	input.addEventListener('keydown', function (evt) {
		function move(ni, nj) {
			const el = document.getElementById(`${nj},${ni}`);
			if (el) el.focus();
		}
		switch (evt.key) {
			case 'Backspace':
				input.value = '';
				gridData[i][j] = '';
				updateLabel();
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
		// Paste fires once with the whole string. Walk it grapheme-aware
		// (flags and emoji are multiple code points): the first grapheme
		// fills this cell, then the remainder spills forward into the next
		// cells with the same auto-advance, so nothing silently vanishes.
		const graphemes = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(evt.data)];
		// A pasted newline can't live in a one-character cell (it would
		// corrupt the row joins in displayMessage): it wraps to the next
		// row's start instead, so pasted multi-line text keeps its shape.
		let chars = graphemes.map(g => g.segment);
		const newline = c => c === '\n' || c === '\r';
		let i0 = i;
		let j0 = j;
		let ch = chars.shift();
		while (newline(ch) && chars.length) ch = chars.shift();
		if (ch == null) return;
		if (newline(ch)) {
			input.value = ''; // paste was only newlines: keep the cell clean
			return;
		}
		setCell(i0, j0, ch);
		let pendingWrap = false;
		while (chars.length) {
			// advance one cell (wrap row-end -> next row start); a pasted
			// newline arms pendingWrap so the next char lands at col 0.
			if (pendingWrap) pendingWrap = false;
			else {
				j0 += 1;
				if (j0 >= gridX) {
					j0 = 0;
					i0 += 1;
				}
			}
			if (i0 >= gridY) break; // past the board: stop, keep the rest typed
			const c = chars.shift();
			if (c === '\r' && chars[0] === '\n') chars.shift(); // CRLF = one wrap
			if (newline(c)) {
				if (j0 !== 0) {
					i0 += 1;
					j0 = 0;
				}
				if (i0 >= gridY) break;
				pendingWrap = true; // next char takes this row's first cell
				continue;
			}
			setCell(i0, j0, c);
		}
		const next =
			j0 >= gridX - 1 ? (i0 >= gridY - 1 ? [0, 0] : [i0 + 1, 0]) : [i0, j0 + 1];
		updateLabel();
		var nextInput = document.getElementById(`${next[1]},${next[0]}`);
		if (nextInput) {
			nextInput.value = '';
			nextInput.focus();
		}
	});
	return input;
}

export function createGrid() {
	const grid = document.getElementById('grid');
	for (let i = 0; i < gridY; i++) {
		for (let j = 0; j < gridX; j++) {
			grid.appendChild(createInput(i, j));
		}
	}
}

export function clearGrid() {
	for (let i = 0; i < gridY; i++) {
		for (let j = 0; j < gridX; j++) setCell(i, j, '');
	}
}

// Snapshot/restore so "Clear Grid" can be undone.
export function snapshotGrid() {
	return gridData.map(row => [...row]);
}

// One writer for a cell's three truths: model, input value, and
// screen-reader label. Hand-updating only some of these is how Clear
// Grid used to leave "X" in the aria-label of an emptied cell.
function setCell(i, j, ch) {
	gridData[i][j] = ch === ' ' ? '' : ch;
	const el = document.getElementById(`${j},${i}`);
	if (el) {
		el.value = gridData[i][j];
		el.setAttribute(
			'aria-label',
			`Row ${i + 1} of ${gridY}, column ${j + 1} of ${gridX}${
				gridData[i][j] ? `, ${gridData[i][j]}` : ', empty'
			}`,
		);
	}
}

// Load a saved grid message's text back into the composer cells.
// Rows shorter than the board width are fine (blanks pad the rest);
// a single space per cell round-trips as empty.
export function setGridFromText(text) {
	const rows = String(text ?? '').split('\n');
	for (let i = 0; i < gridY; i++) {
		const row = rows[i] ?? '';
		for (let j = 0; j < gridX; j++) {
			setCell(i, j, j < row.length ? row[j] : '');
		}
	}
}

export function restoreGrid(snapshot) {
	for (let i = 0; i < gridY; i++) {
		for (let j = 0; j < gridX; j++) setCell(i, j, snapshot[i]?.[j] ?? '');
	}
}

export function displayMessage() {
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

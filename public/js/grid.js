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
	input.setAttribute(
		'aria-label',
		`Row ${i + 1}, column ${j + 1} of ${gridY}, ${gridX}`,
	);

	input.addEventListener('keydown', function (evt) {
		function move(ni, nj) {
			const el = document.getElementById(`${nj},${ni}`);
			if (el) el.focus();
		}
		switch (evt.key) {
			case 'Backspace':
				input.value = '';
				gridData[i][j] = '';
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
		if (evt.data !== ' ') gridData[i][j] = evt.data;
		var next =
			j >= gridX - 1 ? (i >= gridY - 1 ? [0, 0] : [i + 1, 0]) : [i, j + 1];
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
		for (let j = 0; j < gridX; j++) {
			gridData[i][j] = '';
			const input = document.getElementById(`${j},${i}`);
			if (input) input.value = '';
		}
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

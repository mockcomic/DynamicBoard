import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	discover,
	textToVbml,
} from '../backend/services/vestaboard-local.js';

const CODEX_BLANK = 0;
const A = 1, Z = 26, SPACE = 0, EXCL = 37, QUESTION = 60;

// Render the grid back to visible text rows (blank -> space), trimmed,
// for centering-friendly assertions.
const renderRows = grid =>
	grid
		.map(r =>
			r
				.map(c =>
					c === CODEX_BLANK ? ' ' : c <= 26 ? String.fromCharCode(64 + c) : '?',
				)
				.join('')
				.trim(),
		)
		.filter(Boolean);

test('textToVbml: plain text maps to codex grid, centered', () => {
	const { grid, truncated } = textToVbml('AB');
	assert.equal(truncated, false);
	assert.equal(grid.length, 6);
	assert.equal(grid[0].length, 22);
	// one line of 2 chars: horizontal pad 10, vertical top pad 2
	assert.deepEqual(grid[2].slice(10, 12), [A, 2]);
	assert.equal(grid[2][9], CODEX_BLANK);
	assert.deepEqual(renderRows(grid), ['AB']);
});

test('textToVbml: lowercases are upper-mapped', () => {
	const { grid } = textToVbml('hi');
	assert.deepEqual(renderRows(grid), ['HI']);
});

test('textToVbml: word-wraps greedily at 22 cols', () => {
	const { grid } = textToVbml('HELLO WORLD FOO BAR BAZ LONGER WORDS HERE');
	const rows = renderRows(grid);
	assert.equal(rows[0], 'HELLO WORLD FOO BAR');
	assert.equal(rows[1], 'BAZ LONGER WORDS HERE');
});

test('textToVbml: over-long word breaks mid-word', () => {
	const long = 'A'.repeat(30); // 22 + 8
	const { grid } = textToVbml(long);
	const rows = renderRows(grid);
	assert.equal(rows[0], 'A'.repeat(22));
	assert.equal(rows[1], 'A'.repeat(8));
});

test('textToVbml: unsupported chars throw with the char list', () => {
	assert.throws(() => textToVbml('caf\u00e9 \u{1F389}'), err => {
		assert.match(err.message, /Unsupported characters/);
		assert.match(err.message, /\u{1F389}/u);
		assert.equal(err.statusCode, 400);
		return true;
	});
});

test('textToVbml: overflow past 6 rows reports truncated', () => {
	const { truncated } = textToVbml(Array(40).fill('ALPHABET').join(' '));
	assert.equal(truncated, true);
});

test('textToVbml: punctuation maps through the codex', () => {
	const { grid } = textToVbml('A! Z?');
	// centered block: single line lands on row index 2
	const row = grid[2];
	assert.ok(row.includes(EXCL));
	assert.ok(row.includes(QUESTION));
	assert.equal(row[row.indexOf(A) + 1], EXCL);
	assert.equal(row[row.indexOf(Z) + 1], QUESTION);
});

test('discover: rejects a malformed subnet', async () => {
	await assert.rejects(() => discover('999.999.999.999.999'), { statusCode: 400 });
	await assert.rejects(() => discover(''), { statusCode: 400 });
});

test('discover: scans and classifies against real servers', async () => {
	// Nothing on this test subnet port 7000 is guaranteed to be a
	// Vestaboard; the call must simply resolve with the documented shape.
	const result = await discover('192.0.2'); // TEST-NET-1, guaranteed unrouted
	assert.equal(result.subnet, '192.0.2.1-254');
	assert.ok(Array.isArray(result.boards));
	assert.ok(Array.isArray(result.others));
	for (const b of result.boards) {
		assert.ok(b.address && b.ip);
	}
});

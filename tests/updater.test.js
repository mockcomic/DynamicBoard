const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

process.env.DYNAMICBOARD_DISABLE_MAIN = '1';
const {
	compareVersions,
	chooseAsset,
	getUpdateStatus,
} = require('../backend/services/updater');

test('compareVersions: numeric dot compare, v-prefix and padding', () => {
	assert.ok(compareVersions('1.2.0', '1.1.9') > 0);
	assert.ok(compareVersions('v1.2.0', '1.2.0') === 0);
	assert.ok(compareVersions('1.10.0', '1.9.0') > 0);
	assert.ok(compareVersions('2.0.0', '2.0.1') < 0);
	assert.ok(compareVersions('1.2', '1.2.0') === 0);
	// a release tag must never be "newer" than itself
	assert.ok(compareVersions('1.2.0', '1.2.0') === 0);
});

test('chooseAsset: picks the linux asset for a linux host', t => {
	const release = {
		tag_name: 'v9.9.9',
		assets: [
			{
				name: 'dynamicboard-v9.9.9-docker-amd64.tar',
				url: 'https://api.github.com/…/assets/1',
				browser_download_url: 'https://github.com/…/download.tar',
				size: 64000000,
			},
			{
				name: 'DynamicBoard-linux-x64',
				url: 'https://api.github.com/…/assets/2',
				browser_download_url: 'https://github.com/…/download-linux',
				size: 78000000,
			},
			{
				name: 'DynamicBoard-windows-x64.exe',
				url: 'https://api.github.com/…/assets/3',
				browser_download_url: 'https://github.com/…/download-win',
				size: 61000000,
			},
		],
	};
	const hit = chooseAsset(release);
	// This suite runs on Linux on the target rig; guard anyway.
	const target = process.platform === 'linux' ? 'DynamicBoard-linux-x64'
		: process.platform === 'darwin' ? 'DynamicBoard-macos-x64'
		: 'DynamicBoard-windows-x64.exe';
	assert.equal(hit?.name, target);
	assert.ok(hit.downloadUrl.includes('download'));
});

test('chooseAsset: returns null when no platform asset exists', () => {
	assert.equal(chooseAsset({ assets: [] }), null);
	assert.equal(chooseAsset({}), null);
});

test('getUpdateStatus: shape and defaults before any check', () => {
	const s = getUpdateStatus();
	assert.equal(typeof s.current, 'string');
	assert.match(s.current, /^\d+\.\d+\.\d+$/);
	assert.equal(s.latest, null);
	assert.equal(s.updateAvailable, false);
	assert.equal(s.checkedAt, null);
	assert.equal(s.stale, true);
	// Test runs are plain node (not pkg): in-place apply must be refused.
	assert.equal(s.canApply, false);
});

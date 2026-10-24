'use strict';

const assert = require('node:assert/strict');
const { isVisibleApp, validId } = require('../services/com.soar.tv.launcher.service/catalog-filter');
let passed = 0;

function test(name, check) {
  check();
  passed++;
  process.stdout.write('PASS ' + name + '\n');
}

function app(id, title, extra) {
  return Object.assign({ id, title, type: 'web', visible: true, systemApp: false }, extra);
}

test('Visible media, game and assistant apps are not excluded by personal preferences', () => {
  for (const [id, title] of [
    ['com.spotify.lg', 'Spotify'], ['com.espn.app', 'ESPN Sports'],
    ['com.apple.applemusic', 'Apple Music'], ['com.mercadoplay.tv', 'Mercado Play'],
    ['com.games.8ball', '8Ball Pool'], ['com.amazon.alexa', 'Amazon Alexa'],
    ['com.microsoft.copilot', 'Copilot']
  ]) assert.equal(isVisibleApp(app(id, title)), true, title);
});

test('Sports and transport names do not match LG component exclusions', () => {
  for (const [id, title] of [
    ['com.example.sports', 'Live Sports'], ['com.example.transport', 'Transporter'],
    ['com.example.sportsalert', 'Sports alerts'], ['sportsalarm.clock', 'Sports alarm clock']
  ]) assert.equal(isVisibleApp(app(id, title)), true, title);
});

test('Exact LG sports component IDs remain excluded', () => {
  for (const id of ['sportsalarm', 'com.webos.service.sportsalert', 'com.webos.app.sportsteamsettings']) {
    assert.equal(isVisibleApp(app(id, 'LG component')), false, id);
  }
});

test('Hidden apps remain hidden, including approved utilities', () => {
  for (const extra of [{ hidden: true }, { hidden: 'true' }, { class: { hidden: true } }]) {
    assert.equal(isVisibleApp(app('com.example.app', 'App', extra)), false);
    assert.equal(isVisibleApp(app('com.webos.app.livetv', 'TV ao vivo', extra)), false);
  }
});

test('Stubs and service entries never become launcher destinations', () => {
  for (const type of ['stub', 'service']) {
    assert.equal(isVisibleApp(app('com.example.app', 'App', { type })), false);
    assert.equal(isVisibleApp(app('com.webos.app.browser', 'Browser', { type })), false);
  }
});

test('Ads, development components, screensavers and store demos remain excluded', () => {
  for (const id of [
    'com.webos.admanager', 'com.webos.app.adoverlay', 'com.webos.app.adoverlayex',
    'com.palmdts.devmode', 'com.example.developer', 'com.webos.app.screensaver',
    'com.webos.app.store-demo', 'com.webos.app.retail', 'com.webos.service.example',
    'com.webos.exampleapp'
  ]) assert.equal(isVisibleApp(app(id, 'Platform component')), false, id);
});

test('Ordinary invisible and system apps remain excluded', () => {
  assert.equal(isVisibleApp(app('com.example.app', 'App', { visible: false })), false);
  assert.equal(isVisibleApp(app('com.webos.app.unlisted', 'System app', { systemApp: true })), false);
});

test('Approved utilities remain eligible with native system visibility flags', () => {
  for (const id of [
    'com.webos.app.livetv', 'com.webos.app.browser', 'com.webos.app.mediadiscovery',
    'com.webos.app.discovery', 'com.webos.app.homeconnect', 'com.webos.app.camera',
    'org.webosbrew.hbchannel'
  ]) assert.equal(isVisibleApp(app(id, 'Utility', { visible: false, systemApp: true })), true, id);
});

test('Casa cannot list itself', () => {
  assert.equal(isVisibleApp(app('com.soar.tv.launcher', 'Casa')), false);
});

test('Malformed entries and path-like IDs are refused', () => {
  for (const value of [null, undefined, {}, [], 'app', { id: '../app' }, { id: 'app/id' }, { id: '' }]) {
    assert.equal(isVisibleApp(value), false);
  }
});

test('The shared ID validator keeps the existing length and character limits', () => {
  assert.equal(validId('com.Example-app_1'), true);
  assert.equal(validId('a'.repeat(180)), true);
  for (const id of ['a'.repeat(181), 'app with space', 'app\0', '应用', null, 42]) assert.equal(validId(id), false);
});

test('Filtering does not change native inventory objects', () => {
  const value = app('com.espn.app', 'ESPN Sports');
  const before = JSON.parse(JSON.stringify(value));
  isVisibleApp(value);
  assert.deepEqual(value, before);
});

process.stdout.write('Catalog filter: ' + passed + ' checks passed.\n');

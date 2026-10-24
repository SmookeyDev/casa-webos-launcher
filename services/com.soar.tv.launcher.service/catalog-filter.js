'use strict';

const OWNER = 'com.soar.tv.launcher';
const UTILITIES = new Set([
  'com.webos.app.livetv', 'com.webos.app.browser',
  'com.webos.app.mediadiscovery', 'com.webos.app.discovery',
  'com.webos.app.homeconnect', 'com.webos.app.camera',
  'org.webosbrew.hbchannel'
]);

// These are LG notification/settings components, not sports content apps.
const LG_SPORTS_COMPONENTS = new Set([
  'sportsalarm',
  'com.webos.service.sportsalert',
  'com.webos.app.sportsteamsettings'
]);
const COMPONENT_PATTERN = /admanager|devmode|developer|screensaver|store.?demo|retail|(^|[.])service([.]|$)|com\.webos\.app\.ad|com\.webos\.exampleapp/i;

function validId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9._-]{1,180}$/.test(id);
}

function isVisibleApp(app) {
  if (!app || !validId(app.id) || app.id === OWNER) return false;
  if (LG_SPORTS_COMPONENTS.has(app.id) || COMPONENT_PATTERN.test(app.id + ' ' + (app.title || ''))) return false;
  if (app.hidden === true || app.hidden === 'true' || app.class && app.class.hidden) return false;
  if (app.type === 'stub' || app.type === 'service') return false;
  if (UTILITIES.has(app.id)) return true;
  return app.visible !== false && !app.systemApp;
}

module.exports = { isVisibleApp, validId };

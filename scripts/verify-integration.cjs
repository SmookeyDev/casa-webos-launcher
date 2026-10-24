const { chromium } = require('./dependencies.cjs')('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Browser-only checks. Bridge fixtures are installed before app.js runs.
// Neither this script nor its fixtures contacts the television.
const origin = process.env.CASA_PREVIEW_URL || 'http://127.0.0.1:4187';
const storageKey = 'casa.launcher.v1';
const tests = [];
const errors = [];
const passed = (message) => { tests.push(message); process.stdout.write('PASS ' + message + '\n'); };
const focus = (page) => page.evaluate(() => document.activeElement.id);
const state = (page) => page.evaluate(() => window.CasaLauncher.getState());

async function makePage(browser, saved) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.setDefaultTimeout(8000);
  page.setDefaultNavigationTimeout(10000);
  page.on('pageerror', (error) => errors.push(error.message));
  if (saved) {
    await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
      key: storageKey, value: typeof saved === 'string' ? saved : JSON.stringify(saved)
    });
  }
  return page;
}

async function openPreview(page) {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.CasaLauncher));
}

async function installCatalogFixture(page, fixtureApps, delayed, source = 'live') {
  await page.route('**/js/webos-bridge.js', async (route) => {
    const bridge = fs.readFileSync(path.join(__dirname, '../app/js/webos-bridge.js'), 'utf8');
    const override = `
      (function () {
        var apps = ${JSON.stringify(fixtureApps)};
        var previousStatus = window.TVBridge.getStatus;
        window.__fixtureListCalls = 0;
        window.TVBridge.isTV = true;
        window.TVBridge.getStatus = function () {
          return Object.assign({}, previousStatus(), { appsSource: ${JSON.stringify(source)} });
        };
        window.TVBridge.listApps = function () {
          window.__fixtureListCalls++;
          if (${Boolean(delayed)}) {
            return new Promise(function (resolve) {
              window.__resolveFixtureApps = function () { resolve(apps); };
            });
          }
          return Promise.resolve(apps);
        };
      }());
    `;
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: bridge + '\n' + override });
  });
}

async function checkPreview(browser) {
  const page = await makePage(browser);
  await openPreview(page);
  assert.equal(await focus(page), 'favorite-youtube.leanback.v4');
  passed('Initial focus starts on the first favorite');

  for (let index = 0; index < 5; index++) await page.keyboard.press('ArrowRight');
  const edge = await focus(page);
  await page.keyboard.press('ArrowRight');
  assert.equal(await focus(page), edge);
  passed('Right edge stays on the favorites row');

  await page.keyboard.press('ArrowLeft');
  await page.keyboard.down('Enter');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.up('Enter');
  assert.equal(await page.locator('#toast').innerText(), '');
  passed('Moving while holding OK never launches the previous app');

  await page.keyboard.down('Enter');
  await page.waitForFunction(() => window.CasaLauncher.getState().dialog === 'organize-dialog');
  await page.keyboard.up('Enter');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Escape');
  assert.equal((await state(page)).dialog, null);
  assert.match(await focus(page), /^favorite-/);
  passed('Long OK opens organization and Back restores app focus');

  await page.locator('[data-view="apps"]').click();
  assert.equal((await state(page)).view, 'apps');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#toast').innerText.startsWith('Prévia:'));
  passed('Browser app launches stay in preview mode');
  await page.locator('#toast.is-visible').waitFor({ state: 'hidden' });

  await page.locator('#settings-button').click();
  assert.equal((await state(page)).dialog, 'control-dialog');
  assert.equal(await page.evaluate(() => document.querySelector('#control-dialog').contains(document.activeElement)), true);
  for (const selector of ['#volume-down', '#volume-up', '#mute-button']) {
    assert.equal(await page.locator(selector).isDisabled(), true, selector + ' must be inert in preview');
  }
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.querySelector('#control-dialog').contains(document.activeElement)), true);
  assert.equal(await page.evaluate(() => document.activeElement.disabled), false);
  await page.screenshot({ path: path.join(__dirname, '../design/control-panel-integration.png') });
  passed('Quick panel traps navigation and keeps preview audio controls disabled');

  await page.locator('#casa-preferences').click();
  assert.equal((await state(page)).dialog, 'settings-dialog');
  const beforeMotion = (await state(page)).reducedMotion;
  await page.locator('#reduce-motion').click();
  assert.equal((await state(page)).reducedMotion, !beforeMotion);
  await page.keyboard.press('Escape');
  await page.reload();
  await page.waitForFunction(() => Boolean(window.CasaLauncher));
  assert.equal((await state(page)).reducedMotion, !beforeMotion);
  assert.equal((await state(page)).view, 'apps');
  passed('Preferences and active view persist across reload');

  await page.locator('[data-view="inputs"]').click();
  assert.equal(await page.locator('.input-card').count(), 3);
  await page.locator('.input-card').first().click();
  await page.waitForFunction(() => /Prévia:.*HDMI/.test(document.querySelector('#toast').textContent));
  passed('Three HDMI inputs stay available and browser selection remains a preview');

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.locator('#settings-button').click();
  for (const id of ['control-dialog', 'settings-dialog']) {
    if (id === 'settings-dialog') await page.locator('#casa-preferences').click();
    const bounds = await page.locator('#' + id + ' .dialog-panel').boundingBox();
    assert(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 1281 && bounds.y + bounds.height <= 721, id + ' must fit 720p');
  }
  passed('Quick controls and preferences fit a scaled 720p screen');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.locator('[data-view="home"]').click();
  await page.locator('#toast.is-visible').waitFor({ state: 'hidden' });
  await page.screenshot({ path: path.join(__dirname, '../design/home-integration.png') });
  await page.close();
}

async function checkDynamicCatalog(browser) {
  const fixtureApps = Array.from({ length: 25 }, (_, index) => ({
    id: index === 0 ? 'fixture.external.favorite' : 'fixture.app.' + String(index + 1).padStart(2, '0'),
    title: 'Fixture ' + String(index + 1).padStart(2, '0'), icon: '', color: '#202b3b'
  }));
  const page = await makePage(browser, {
    revision: 2, view: 'apps', appPage: 0,
    favorites: ['fixture.external.favorite', 'netflix'],
    reducedMotion: true, labels: true, lastFocus: {}
  });
  await installCatalogFixture(page, fixtureApps, true);
  await openPreview(page);
  await page.waitForFunction(() => typeof window.__resolveFixtureApps === 'function');
  assert.equal((await state(page)).favorites.includes('fixture.external.favorite'), true);
  passed('A saved favorite outside the bundled catalog survives pending native discovery');

  await page.evaluate(() => window.__resolveFixtureApps());
  await page.waitForFunction(() => window.CasaLauncher.getState().appCount === 25);
  assert.equal((await state(page)).favorites.includes('fixture.external.favorite'), true);
  assert.equal((await state(page)).favorites.includes('netflix'), false);
  assert.equal(await page.locator('#apps-grid .app-tile').count(), 12);
  assert.equal(await page.locator('#apps-prev').isDisabled(), true);
  assert.equal(await page.locator('#apps-next').isDisabled(), false);
  passed('Authoritative discovery keeps a real external favorite and removes an absent app');

  const initialTiles = page.locator('#apps-grid .app-tile');
  const lastFirstPageId = await initialTiles.nth(11).getAttribute('id');
  await initialTiles.nth(11).focus();
  await page.keyboard.press('ArrowDown');
  assert.equal((await state(page)).appPage, 1);
  assert.equal(await focus(page), await page.locator('#apps-grid .app-tile').nth(5).getAttribute('id'));
  await page.keyboard.press('ArrowUp');
  assert.equal((await state(page)).appPage, 0);
  assert.equal(await focus(page), lastFirstPageId);
  passed('Directional navigation crosses app pages and restores the same column');

  const firstLabel = await page.locator('#apps-page-label').innerText();
  await page.locator('#apps-next').click();
  assert.equal(await page.locator('#apps-grid .app-tile').count(), 12);
  assert.notEqual(await page.locator('#apps-page-label').innerText(), firstLabel);
  await page.locator('#apps-next').click();
  assert.equal(await page.locator('#apps-grid .app-tile').count(), 1);
  assert.equal(await page.locator('#apps-next').isDisabled(), true);
  assert.equal(await page.locator('#apps-prev').isDisabled(), false);
  const lastPage = (await state(page)).appPage;
  assert.equal(Number.isInteger(lastPage), true);
  passed('A 25-app catalog uses three bounded pages with correct edge controls');

  const persisted = await page.evaluate((key) => localStorage.getItem(key), storageKey);
  const reloadPage = await makePage(browser, persisted);
  await installCatalogFixture(reloadPage, fixtureApps, false);
  await openPreview(reloadPage);
  await reloadPage.waitForFunction(() => window.CasaLauncher.getState().appCount === 25);
  assert.equal((await state(reloadPage)).view, 'apps');
  assert.equal((await state(reloadPage)).appPage, lastPage);
  assert.equal(await reloadPage.locator('#apps-grid .app-tile').count(), 1);
  passed('An app page survives a fresh app instance before and after live reconciliation');

  const beforeRefresh = await reloadPage.evaluate(() => window.__fixtureListCalls);
  await reloadPage.evaluate(() => {
    // Advance only Date.now past the refresh cooldown, without a real wait or
    // changing timer scheduling. A rapid duplicate lifecycle event may coalesce.
    const now = Date.now;
    Date.now = () => now() + 11000;
    document.dispatchEvent(new Event('webOSRelaunch'));
  });
  await reloadPage.waitForFunction((calls) => window.__fixtureListCalls > calls, beforeRefresh);
  passed('Relaunch refreshes a stale native catalog after the refresh cooldown');

  await reloadPage.locator('#apps-grid .app-tile').first().click();
  await reloadPage.waitForFunction(() => window.CasaLauncher.getState().recent.length > 0);
  await reloadPage.evaluate(() => document.dispatchEvent(new Event('webOSRelaunch')));
  await reloadPage.locator('[data-view="home"]').click();
  await reloadPage.locator('#recents-grid .recent-tile').waitFor({ state: 'visible' });
  assert.equal(await reloadPage.locator('#recents-grid .recent-tile').count(), 1);
  const favoriteIds = (await state(reloadPage)).favorites;
  const recentId = await reloadPage.locator('#recents-grid .recent-tile').getAttribute('data-app');
  assert.equal(favoriteIds.includes(recentId), false);
  passed('A fast return displays recent launches without duplicating favorites');
  await reloadPage.close();
  await page.close();
}

async function checkIncompleteRow(browser) {
  const page = await makePage(browser);
  const fixtureApps = Array.from({ length: 9 }, (_, index) => ({
    id: 'fixture.grid.' + index, title: 'Grid ' + index, icon: '', color: '#202b3b'
  }));
  await installCatalogFixture(page, fixtureApps, false);
  await openPreview(page);
  await page.waitForFunction(() => window.CasaLauncher.getState().appCount === 9);
  await page.locator('[data-view="apps"]').click();
  const tiles = page.locator('#apps-grid .app-tile');
  await tiles.nth(5).focus();
  await page.keyboard.press('ArrowDown');
  assert.equal(await focus(page), await tiles.nth(8).getAttribute('id'));
  const lastFocus = await focus(page);
  await page.keyboard.press('ArrowDown');
  assert.equal(await focus(page), lastFocus);
  await page.keyboard.press('ArrowUp');
  assert.equal(await focus(page), await tiles.nth(2).getAttribute('id'));
  passed('Down clamps into an incomplete lower row and Up returns to its column');
  await page.close();
}

async function checkAsyncInputs(browser) {
  const page = await makePage(browser, {
    revision: 2, view: 'inputs', appPage: 0, favorites: ['netflix'],
    reducedMotion: true, labels: true, lastFocus: { inputs: 'input-HDMI_2' }
  });
  await page.route('**/js/webos-bridge.js', async (route) => {
    const bridge = fs.readFileSync(path.join(__dirname, '../app/js/webos-bridge.js'), 'utf8');
    const override = `
      window.__fixtureInputCalls = 0;
      window.TVBridge.listInputs = function () {
        window.__fixtureInputCalls++;
        return new Promise(function (resolve) {
          setTimeout(function () {
            resolve([1, 2, 3].map(function (port) {
              return { id: 'HDMI_' + port, title: 'HDMI ' + port,
                appId: 'com.webos.app.hdmi' + port, connected: port === 2 };
            }));
          }, 400);
        });
      };
    `;
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: bridge + '\n' + override });
  });
  await openPreview(page);
  assert.equal((await state(page)).view, 'inputs');
  await page.waitForFunction(() => document.querySelectorAll('#inputs-grid .input-card').length === 3);
  assert.equal(await focus(page), 'input-HDMI_2');
  assert.equal(await page.evaluate(() => window.__fixtureInputCalls), 1);
  passed('An initial Inputs view restores its saved HDMI focus after a delayed 400ms response');
  await page.close();
}

async function checkPartialCatalog(browser) {
  const cachedApps = [
    { id: 'netflix', title: 'Netflix', icon: '', color: '#202b3b' },
    { id: 'fixture.cached.favorite', title: 'Cached favorite', icon: '', color: '#202b3b' }
  ];
  const page = await makePage(browser, {
    revision: 2, view: 'home', appPage: 0,
    favorites: cachedApps.map((app) => app.id), reducedMotion: true, labels: true,
    lastFocus: { home: 'favorite-fixture.cached.favorite' }
  });
  await page.addInitScript((cached) => localStorage.setItem('casa.catalog.v1', JSON.stringify(cached)), cachedApps);
  await installCatalogFixture(page, [
    { id: 'fixture.partial.found', title: 'Newly found app', icon: '', color: '#202b3b' }
  ], false, 'native-partial');
  await openPreview(page);
  await page.waitForFunction(() => window.CasaLauncher.getState().appCount === 3);
  assert.deepEqual((await state(page)).favorites, cachedApps.map((app) => app.id));
  assert.equal(await page.locator('#favorites-grid .app-tile').count(), 2);
  assert.equal(await focus(page), 'favorite-fixture.cached.favorite');
  const retainedCache = await page.evaluate(() => JSON.parse(localStorage.getItem('casa.catalog.v1')));
  assert.deepEqual(retainedCache.map((app) => app.id), cachedApps.map((app) => app.id));
  passed('A partial native catalog preserves omitted cached favorites, focus and the last complete snapshot');
  await page.close();
}

(async () => {
  const browser = await chromium.launch(require('./browser-options.cjs')());
  try {
    await checkPreview(browser);
    await checkIncompleteRow(browser);
    await checkDynamicCatalog(browser);
    await checkAsyncInputs(browser);
    await checkPartialCatalog(browser);
    assert.deepEqual(errors, []);
    passed('No uncaught browser errors across preview and native fixtures');
    fs.writeFileSync(path.join(__dirname, '../design/browser-integration-verification.json'), JSON.stringify({ tests, passed: tests.length, errors }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => { process.stderr.write(error.stack + '\n'); process.exit(1); });

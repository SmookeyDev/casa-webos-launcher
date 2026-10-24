(function () {
  'use strict';

  var STORAGE_KEY = 'casa.launcher.v1';
  var CATALOG_KEY = 'casa.catalog.v1';
  var PAGE_SIZE = 12;
  var DEFAULT_FAVORITES = ['youtube.leanback.v4', 'netflix', 'amazon', 'io.strem.tv', 'globoplaywebos', 'com.disney.disneyplus-prod'];
  var bridge = window.TVBridge;
  var saved = readStorage();
  var apps = (window.LauncherCatalog || []).slice();
  try {
    var cachedApps = JSON.parse(window.localStorage.getItem(CATALOG_KEY));
    if (Array.isArray(cachedApps) && cachedApps.length && cachedApps.length < 200) apps = cachedApps.filter(function (app) { return app && typeof app.id === 'string' && typeof app.title === 'string'; });
  } catch (_) { /* The bundled catalog is always available offline. */ }
  var state = {
    view: ['home', 'apps', 'inputs'].indexOf(saved.view) >= 0 ? saved.view : 'home',
    appPage: Number.isInteger(saved.appPage) && saved.appPage >= 0 ? saved.appPage : 0,
    recent: Array.isArray(saved.recent) ? saved.recent.filter(function (id) { return typeof id === 'string'; }).slice(0, 8) : [],
    favorites: Array.isArray(saved.favorites) ? saved.favorites.filter(function (id, i, all) { return typeof id === 'string' && all.indexOf(id) === i; }).slice(0, 6) : DEFAULT_FAVORITES.slice(),
    labels: saved.labels !== false,
    reducedMotion: bridge.isTV && saved.revision !== 2 ? true : typeof saved.reducedMotion === 'boolean' ? saved.reducedMotion : window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    lastFocus: saved.lastFocus && typeof saved.lastFocus === 'object' ? saved.lastFocus : {},
    dialog: null,
    launching: false
  };
  var toastTimer;
  var clockTimer;
  var persistTimer;
  var lastFocusedButton;
  var okTimer;
  var heldOK = false;
  var okTarget = null;
  var dialogReturnFocus = null;
  var inputs = [];
  var inputRefresh = null;
  var appRefresh = null;
  var catalogReady = false;
  var lastRefresh = 0;
  var audioBusy = false;
  var volumeWatchStop;
  var lastAudioUpdatedAt = 0;
  var screen = document.getElementById('screen');

  function readStorage() {
    try { return JSON.parse(window.localStorage.getItem(STORAGE_KEY)) || {}; }
    catch (_) { return {}; }
  }

  function persist() {
    window.clearTimeout(persistTimer);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        revision: 2, favorites: state.favorites, labels: state.labels,
        reducedMotion: state.reducedMotion, lastFocus: state.lastFocus,
        view: state.view, appPage: state.appPage, recent: state.recent
      }));
    } catch (_) { /* A full settings store must never prevent opening an app. */ }
  }

  function persistSoon() {
    window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(persist, 350);
  }

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function findApp(id) {
    return apps.filter(function (app) { return app.id === id; })[0];
  }

  function toast(message) {
    var node = document.getElementById('toast');
    window.clearTimeout(toastTimer);
    node.textContent = message;
    node.classList.add('is-visible');
    toastTimer = window.setTimeout(function () { node.classList.remove('is-visible'); }, 3500);
  }

  function fitScreen() {
    var scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    document.documentElement.style.setProperty('--screen-scale', scale);
  }

  function updateClock() {
    window.clearTimeout(clockTimer);
    var now = new Date();
    document.getElementById('clock').textContent = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    document.getElementById('date').textContent = now.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
    clockTimer = window.setTimeout(updateClock, 60000 - now.getSeconds() * 1000 - now.getMilliseconds() + 50);
  }

  function updatePreferences() {
    document.body.classList.toggle('labels-hidden', !state.labels);
    document.body.classList.toggle('reduced-motion', state.reducedMotion);
    [['reduce-motion', state.reducedMotion], ['show-labels', state.labels]].forEach(function (entry) {
      var button = document.getElementById(entry[0]);
      button.setAttribute('aria-checked', String(entry[1]));
      var value = button.querySelector('.setting-value, .state-text');
      if (value) value.textContent = entry[1] ? 'Ativado' : 'Desativado';
    });
  }

  function makeAppTile(app, area) {
    var button = element('button', 'app-tile');
    button.type = 'button';
    button.id = area + '-' + app.id;
    button.dataset.app = app.id;
    button.dataset.focus = '';
    button.setAttribute('aria-label', 'Abrir ' + app.title);
    button.style.setProperty('--tile-bg', app.color || '#26303c');
    var art = element('span', 'tile-art');
    if (app.icon) {
      var image = element('img');
      image.src = app.icon;
      image.alt = '';
      image.draggable = false;
      image.decoding = 'async';
      image.addEventListener('error', function () {
        image.remove();
        art.appendChild(element('span', 'tile-fallback', app.title.slice(0, 2)));
      }, { once: true });
      art.appendChild(image);
    } else art.appendChild(element('span', 'tile-fallback', app.title.slice(0, 2)));
    button.appendChild(art);
    button.appendChild(element('span', 'tile-label', app.title));
    button.addEventListener('click', function () { launch(app); });
    return button;
  }

  function renderApps() {
    var focusedId = document.activeElement && document.activeElement.id;
    var favorites = state.favorites.map(findApp).filter(Boolean);
    if (!state.favorites.length) {
      state.favorites = apps.slice(0, 6).map(function (app) { return app.id; });
      favorites = state.favorites.map(findApp).filter(Boolean);
    }
    persist();
    var favoritesGrid = document.getElementById('favorites-grid');
    var appsGrid = document.getElementById('apps-grid');
    favoritesGrid.replaceChildren();
    appsGrid.replaceChildren();
    favorites.forEach(function (app) { favoritesGrid.appendChild(makeAppTile(app, 'favorite')); });
    var visiblePage = Math.min(state.appPage, Math.max(0, Math.ceil(apps.length / PAGE_SIZE) - 1));
    if (catalogReady) state.appPage = visiblePage;
    apps.slice(visiblePage * PAGE_SIZE, (visiblePage + 1) * PAGE_SIZE).forEach(function (app) { appsGrid.appendChild(makeAppTile(app, 'app')); });
    var count = document.getElementById('apps-count');
    if (count) count.textContent = apps.length + ' aplicativos';
    var pages = Math.ceil(apps.length / PAGE_SIZE);
    document.getElementById('apps-pager').hidden = pages <= 1;
    document.getElementById('apps-prev').disabled = visiblePage === 0;
    document.getElementById('apps-next').disabled = visiblePage >= pages - 1;
    document.getElementById('apps-page-label').textContent = (visiblePage + 1) + ' / ' + pages;
    var recent = state.recent.filter(function (id) { return state.favorites.indexOf(id) < 0; }).map(findApp).filter(Boolean).slice(0, 4);
    var recentGrid = document.getElementById('recents-grid');
    recentGrid.replaceChildren();
    recent.forEach(function (app) { var tile = makeAppTile(app, 'recent'); tile.classList.add('recent-tile'); recentGrid.appendChild(tile); });
    document.getElementById('recents-section').hidden = !recent.length;
    document.getElementById('home-view').classList.toggle('has-recents', Boolean(recent.length));
    if (focusedId && document.getElementById(focusedId)) document.getElementById(focusedId).focus({ preventScroll: true });
    else if (focusedId && /^(app|favorite|recent)-/.test(focusedId) && !state.dialog) focusCurrentContent();
  }

  function changePage(delta, index) {
    var next = Math.min(state.appPage, Math.max(0, Math.ceil(apps.length / PAGE_SIZE) - 1)) + delta;
    if (next < 0 || next >= Math.ceil(apps.length / PAGE_SIZE)) return;
    state.appPage = next;
    renderApps();
    var items = document.getElementById('apps-grid').children;
    if (items.length) items[Math.min(index || 0, items.length - 1)].focus({ preventScroll: true });
    persist();
  }

  function refreshApps() {
    if (appRefresh) return appRefresh;
    appRefresh = bridge.listApps().then(function (result) {
      if (!Array.isArray(result) || !result.length) return;
      catalogReady = true;
      var source = bridge.getStatus().appsSource;
      var authoritative = ['native', 'live', 'preview'].indexOf(source) >= 0;
      if (authoritative) {
        apps = result;
        state.favorites = state.favorites.filter(function (id) { return Boolean(findApp(id)); });
        state.recent = state.recent.filter(function (id) { return Boolean(findApp(id)); });
        try { window.localStorage.setItem(CATALOG_KEY, JSON.stringify(apps)); } catch (_) { /* Cache is optional. */ }
      } else {
        // A partial fallback must never erase favorites discovered by the native service.
        var knownIds = (window.LauncherCatalog || []).map(function (app) { return app.id; });
        var resultIds = result.map(function (app) { return app.id; });
        apps = result.concat(apps.filter(function (app) { return resultIds.indexOf(app.id) < 0 && (source === 'native-partial' || knownIds.indexOf(app.id) < 0); }));
      }
      renderApps();
      if (!state.dialog && document.activeElement === document.body) focusCurrentContent();
      persistSoon();
    }).catch(function () { /* The cached catalog remains immediately usable. */ }).finally(function () { appRefresh = null; });
    return appRefresh;
  }

  function renderInputs() {
    var grid = document.getElementById('inputs-grid');
    var focusedId = document.activeElement && document.activeElement.id;
    grid.replaceChildren();
    inputs.forEach(function (input, i) {
      var button = element('button', 'input-card');
      button.type = 'button';
      button.id = 'input-' + input.id;
      button.dataset.focus = '';
      button.setAttribute('aria-label', 'Abrir ' + input.title);
      var icon = element('span', 'input-icon');
      icon.innerHTML = '<svg viewBox="0 0 80 64" fill="none" aria-hidden="true"><rect x="6" y="5" width="68" height="43" rx="7" stroke="currentColor" stroke-width="3"/><path d="M29 59h22M40 49v10" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>';
      button.appendChild(icon);
      button.appendChild(element('span', 'input-title', input.title || 'HDMI ' + (i + 1)));
      button.appendChild(element('span', 'input-status', input.connected === true ? (input.deviceName || (input.signal === true ? 'Sinal disponível' : 'Dispositivo conectado')) : input.connected === false ? 'Sem dispositivo detectado' : 'Entrada da TV'));
      button.addEventListener('click', function () {
        performLaunch(function () { return bridge.openInput(input); }, input.title);
      });
      grid.appendChild(button);
    });
    if (focusedId && document.getElementById(focusedId)) document.getElementById(focusedId).focus({ preventScroll: true });
    else if (state.view === 'inputs' && !state.dialog && (document.activeElement === document.body || /^input-/.test(focusedId || ''))) focusCurrentContent();
  }

  function refreshInputs() {
    if (inputRefresh) return inputRefresh;
    inputRefresh = bridge.listInputs().then(function (result) {
      inputs = result;
      renderInputs();
    }).catch(function () { toast('Não foi possível consultar as entradas agora.'); }).finally(function () { inputRefresh = null; });
    return inputRefresh;
  }

  function changeView(view, focusContent) {
    state.view = view;
    document.querySelectorAll('.view').forEach(function (node) {
      var active = node.id === view + '-view';
      node.classList.toggle('active', active);
      node.hidden = !active;
    });
    document.querySelectorAll('[data-view]').forEach(function (button) {
      var active = button.dataset.view === view;
      button.classList.toggle('is-active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    if (view === 'inputs') refreshInputs();
    if (focusContent) focusCurrentContent();
    persist();
  }

  function focusCurrentContent() {
    var savedFocus = document.getElementById(state.lastFocus[state.view]);
    var view = document.getElementById(state.view + '-view');
    var contentFocus = savedFocus && (savedFocus.matches('.app-tile, .input-card')) && view.contains(savedFocus);
    var target = contentFocus ? savedFocus : view.querySelector('.app-tile, .input-card') || view.querySelector('[data-focus]');
    if (target) target.focus({ preventScroll: true });
  }

  function performLaunch(action, title) {
    if (state.launching) return;
    state.launching = true;
    persist();
    Promise.resolve().then(action).then(function (result) {
      if (result && result.preview) toast('Prévia: abrir ' + title);
    }).catch(function (error) {
      toast(error && error.message ? error.message : 'Não foi possível abrir. Tente novamente.');
    }).finally(function () { state.launching = false; });
  }

  function launch(app) {
    var previous = state.recent.slice();
    performLaunch(function () {
      if (bridge.isTV) { state.recent = [app.id].concat(state.recent.filter(function (id) { return id !== app.id; })).slice(0, 8); persist(); }
      return bridge.launchApp(app.id).catch(function (error) { state.recent = previous; persist(); throw error; });
    }, app.title);
  }

  function openDialog(id) {
    if (state.dialog) closeDialog();
    dialogReturnFocus = document.activeElement && document.activeElement.id;
    state.dialog = document.getElementById(id);
    if (id === 'organize-dialog') renderOrganizer();
    if (id === 'control-dialog') refreshTVStatus();
    state.dialog.showModal();
    if (id === 'control-dialog') startVolumeWatch();
    var first = state.dialog.querySelector('[data-pin], button:not([disabled]):not([data-close-dialog])');
    if (first) first.focus({ preventScroll: true });
  }

  function renderTVStatus(status) {
    var available = status && status.available;
    var network = status.network || {};
    var hasNetwork = typeof network.connected === 'boolean';
    document.getElementById('network-status').textContent = hasNetwork ? network.connected ? (network.type === 'wired' ? 'Cabo de rede' : network.type === 'wifi' ? 'Wi-Fi' : 'Conectada') : 'Desconectada' : 'Indisponível';
    document.getElementById('internet-status').textContent = typeof network.internet === 'boolean' ? (network.internet ? 'Internet disponível' : 'Sem acesso à internet') : '';
    var outputs = { tv_speaker: 'Alto-falantes da TV', bt_soundbar: 'Áudio Bluetooth', bt: 'Áudio Bluetooth', external_arc: 'HDMI ARC', external_optical: 'Saída óptica', lineout: 'Saída de áudio', headphone: 'Fones de ouvido', tv_external_speaker: 'TV + saída externa' };
    document.getElementById('sound-status').textContent = outputs[status.soundOutput] || (status.soundOutput ? 'Áudio externo' : 'Indisponível');
    document.getElementById('control-status-note').textContent = status.preview ? 'Prévia no computador' : available ? 'Configuração atual da TV' : 'Abra os ajustes da TV';
    renderAudioStatus(status);
  }

  function renderAudioStatus(status) {
    if (typeof status.updatedAt === 'number' && status.updatedAt < lastAudioUpdatedAt) return;
    if (typeof status.updatedAt === 'number') lastAudioUpdatedAt = status.updatedAt;
    var volume = typeof status.volume === 'number' ? Math.max(0, Math.min(100, status.volume)) : null;
    document.getElementById('volume-value').textContent = volume === null ? '—' : String(volume);
    document.getElementById('volume-level').style.width = (volume || 0) + '%';
    document.getElementById('mute-button').textContent = status.muted === true ? 'Ativar som' : 'Silenciar';
    document.getElementById('mute-button').setAttribute('aria-pressed', String(status.muted === true));
    var controls = status.capabilities || {};
    document.getElementById('volume-down').disabled = !bridge.isTV || !controls.volume;
    document.getElementById('volume-up').disabled = !bridge.isTV || !controls.volume;
    document.getElementById('mute-button').disabled = !bridge.isTV || !controls.mute;
  }

  function refreshTVStatus() {
    return bridge.getTVStatus().then(renderTVStatus).catch(function () { renderTVStatus({ available: false }); });
  }

  function stopVolumeWatch() {
    if (volumeWatchStop) volumeWatchStop();
    volumeWatchStop = null;
  }

  function startVolumeWatch() {
    stopVolumeWatch();
    volumeWatchStop = bridge.watchVolume(function (status) {
      status.capabilities = { volume: typeof status.volume === 'number', mute: typeof status.muted === 'boolean' };
      renderAudioStatus(status);
    });
  }

  function controlAudio(method) {
    if (audioBusy) return;
    audioBusy = true;
    bridge.controlAudio(method).then(refreshTVStatus).catch(function (error) { toast(error.message || 'Não foi possível ajustar o som.'); }).finally(function () { audioBusy = false; });
  }

  function closeDialog() {
    if (!state.dialog) return;
    var dialog = state.dialog;
    state.dialog = null;
    stopVolumeWatch();
    dialog.close();
    var target = document.getElementById(dialogReturnFocus);
    if (target) target.focus({ preventScroll: true });
    else focusCurrentContent();
  }

  function renderOrganizer(focusId) {
    var list = document.getElementById('organize-list');
    list.replaceChildren();
    var ordered = state.favorites.map(findApp).filter(Boolean).concat(apps.filter(function (app) { return state.favorites.indexOf(app.id) < 0; }));
    ordered.forEach(function (app) {
      var index = state.favorites.indexOf(app.id);
      var button = element('button', 'organize-item');
      button.type = 'button';
      button.id = 'organize-' + app.id;
      button.dataset.pin = app.id;
      button.dataset.focus = '';
      button.setAttribute('aria-pressed', String(index >= 0));
      button.appendChild(element('span', 'organize-number', index >= 0 ? String(index + 1).padStart(2, '0') : '+'));
      button.appendChild(element('span', 'organize-title', app.title));
      button.appendChild(element('span', 'organize-status', index >= 0 ? 'Favorito' : 'Adicionar'));
      button.addEventListener('click', function () {
        var position = state.favorites.indexOf(app.id);
        if (position >= 0) {
          if (state.favorites.length === 1) { toast('Mantenha pelo menos um favorito.'); return; }
          state.favorites.splice(position, 1);
        } else {
          if (state.favorites.length >= 6) { toast('Escolha até seis favoritos. Remova um para adicionar outro.'); return; }
          state.favorites.push(app.id);
        }
        persist();
        renderApps();
        renderOrganizer(app.id);
      });
      list.appendChild(button);
    });
    var focused = focusId && document.getElementById('organize-' + focusId);
    if (focused) focused.focus({ preventScroll: true });
  }

  function navigate(direction) {
    var current = document.activeElement;
    // Directional TV navigation uses grid positions, avoiding synchronous
    // geometry/layout reads for every button on every remote key press.
    if (!state.dialog && current.matches('.app-tile, .input-card')) {
      var items = current.parentElement.children;
      var index = Array.prototype.indexOf.call(items, current);
      var columns = current.matches('.input-card') ? 3 : current.matches('.recent-tile') ? 4 : 6;
      var column = index % columns;
      var nextIndex = -1;
      if (direction === 'left' && column > 0) nextIndex = index - 1;
      if (direction === 'right' && column < columns - 1 && index + 1 < items.length) nextIndex = index + 1;
      if (direction === 'down' && Math.floor(index / columns) < Math.floor((items.length - 1) / columns)) nextIndex = Math.min(index + columns, items.length - 1);
      if (direction === 'up' && index >= columns) nextIndex = index - columns;
      if (nextIndex >= 0) items[nextIndex].focus({ preventScroll: true });
      else if (state.view === 'apps' && direction === 'down' && state.appPage < Math.ceil(apps.length / PAGE_SIZE) - 1) {
        changePage(1, column);
      } else if (state.view === 'apps' && direction === 'up' && index < columns && state.appPage > 0) {
        changePage(-1, column + 6);
      } else if (state.view === 'home' && direction === 'down' && !current.matches('.recent-tile') && document.getElementById('recents-grid').children.length) {
        var recentItems = document.getElementById('recents-grid').children;
        recentItems[Math.min(column, recentItems.length - 1)].focus({ preventScroll: true });
      } else if (state.view === 'home' && direction === 'up' && current.matches('.recent-tile')) {
        var favoriteItems = document.getElementById('favorites-grid').children;
        if (favoriteItems.length) favoriteItems[Math.min(column, favoriteItems.length - 1)].focus({ preventScroll: true });
      } else if (direction === 'up' && index < columns) {
        var topTarget = state.view === 'home' && column >= 4 ? document.getElementById('edit-favorites') : document.querySelector('[data-view="' + state.view + '"]');
        if (topTarget) topTarget.focus({ preventScroll: true });
      }
      return;
    }
    if (!state.dialog && current.hasAttribute('data-view')) {
      var tabs = Array.from(document.querySelectorAll('[data-view]'));
      var tabIndex = tabs.indexOf(current);
      if (direction === 'down') changeView(current.dataset.view, true);
      else if (direction === 'left' && tabIndex > 0) tabs[tabIndex - 1].focus({ preventScroll: true });
      else if (direction === 'right') (tabs[tabIndex + 1] || document.getElementById('settings-button')).focus({ preventScroll: true });
      return;
    }
    var container = state.dialog || screen;
    var candidates = Array.from(container.querySelectorAll('button:not([disabled])')).filter(function (node) {
      var rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && !node.closest('[hidden]');
    });
    if (!candidates.length) return;
    if (candidates.indexOf(current) < 0) { candidates[0].focus({ preventScroll: true }); return; }
    var origin = current.getBoundingClientRect();
    var ox = origin.left + origin.width / 2;
    var oy = origin.top + origin.height / 2;
    var horizontal = direction === 'left' || direction === 'right';
    var sign = direction === 'left' || direction === 'up' ? -1 : 1;
    var best;
    var bestScore = Infinity;
    candidates.forEach(function (node) {
      if (node === current) return;
      var rect = node.getBoundingClientRect();
      var dx = rect.left + rect.width / 2 - ox;
      var dy = rect.top + rect.height / 2 - oy;
      var major = (horizontal ? dx : dy) * sign;
      var minor = Math.abs(horizontal ? dy : dx);
      if (major < 8) return;
      var aligned = horizontal ? Math.abs(dy) < Math.min(origin.height, rect.height) * 0.7 : Math.abs(dx) < Math.max(origin.width, rect.width) * 0.65;
      if (horizontal && !aligned) return;
      var score = major + minor * 2.3 + (aligned ? 0 : 600);
      if (score < bestScore) { bestScore = score; best = node; }
    });
    if (best) best.focus({ preventScroll: true });
  }

  function goBack() {
    if (state.dialog) closeDialog();
    else if (state.view !== 'home') changeView('home', true);
    else if (bridge.isTV) bridge.exit();
    else toast('Na TV, Voltar retorna à Home da LG.');
  }

  document.querySelectorAll('[data-view]').forEach(function (button) {
    button.addEventListener('click', function () { changeView(button.dataset.view, true); });
  });
  document.getElementById('settings-button').addEventListener('click', function () { openDialog('control-dialog'); });
  document.getElementById('casa-preferences').addEventListener('click', function () { openDialog('settings-dialog'); });
  document.getElementById('control-tv-settings').addEventListener('click', function () { performLaunch(function () { return bridge.openSettings(); }, 'Configurações da TV'); });
  document.getElementById('live-tv').addEventListener('click', function () { performLaunch(function () { return bridge.openLiveTV(); }, 'TV ao vivo'); });
  document.getElementById('volume-down').addEventListener('click', function () { controlAudio('volumeDown'); });
  document.getElementById('volume-up').addEventListener('click', function () { controlAudio('volumeUp'); });
  document.getElementById('mute-button').addEventListener('click', function () { controlAudio('toggleMute'); });
  document.getElementById('apps-prev').addEventListener('click', function () { changePage(-1); });
  document.getElementById('apps-next').addEventListener('click', function () { changePage(1); });
  document.getElementById('edit-favorites').addEventListener('click', function () { openDialog('organize-dialog'); });
  document.querySelectorAll('[data-close-dialog]').forEach(function (button) { button.addEventListener('click', closeDialog); });
  document.getElementById('reduce-motion').addEventListener('click', function () { state.reducedMotion = !state.reducedMotion; updatePreferences(); persist(); });
  document.getElementById('show-labels').addEventListener('click', function () { state.labels = !state.labels; updatePreferences(); persist(); });
  document.getElementById('reset-layout').addEventListener('click', function () { state.favorites = DEFAULT_FAVORITES.filter(findApp); renderApps(); persist(); toast('Favoritos restaurados.'); });
  var tvSettings = document.getElementById('tv-settings');
  if (tvSettings) tvSettings.addEventListener('click', function () { performLaunch(function () { return bridge.openSettings(); }, 'Configurações da TV'); });
  document.querySelectorAll('dialog').forEach(function (dialog) {
    dialog.addEventListener('cancel', function (event) { event.preventDefault(); closeDialog(); });
    dialog.addEventListener('click', function (event) { if (event.target === dialog) closeDialog(); });
  });
  document.addEventListener('focusin', function (event) {
    if (okTarget && event.target !== okTarget) { window.clearTimeout(okTimer); okTarget = null; }
    if (lastFocusedButton && lastFocusedButton !== event.target) lastFocusedButton.classList.remove('is-focused');
    if (event.target.matches('button')) { event.target.classList.add('is-focused'); lastFocusedButton = event.target; }
    if (state.dialog) {
      if (event.target.matches('[data-pin]')) event.target.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      return;
    }
    var view = document.getElementById(state.view + '-view');
    if (view.contains(event.target) && event.target.id) {
      state.lastFocus[state.view] = event.target.id;
      persistSoon();
    }
  });
  document.addEventListener('pointermove', function (event) {
    if (event.pointerType !== 'mouse') return;
    if (event.movementX === 0 && event.movementY === 0) return;
    var button = event.target.closest('button');
    if (button && (!state.dialog || state.dialog.contains(button))) button.focus({ preventScroll: true });
  });
  document.addEventListener('keydown', function (event) {
    var directions = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
    var direction = directions[event.key];
    if (direction) {
      event.preventDefault();
      window.clearTimeout(okTimer); okTarget = null; heldOK = false;
      var pin = document.activeElement && document.activeElement.dataset.pin;
      var index = state.favorites.indexOf(pin);
      if (state.dialog && state.dialog.id === 'organize-dialog' && index >= 0 && (direction === 'left' || direction === 'right')) {
        var next = index + (direction === 'left' ? -1 : 1);
        if (next >= 0 && next < state.favorites.length) {
          var swap = state.favorites[next]; state.favorites[next] = pin; state.favorites[index] = swap;
          persist(); renderApps(); renderOrganizer(pin);
        }
      } else navigate(direction);
      return;
    }
    if (event.key === 'Escape' || event.key === 'Backspace' || event.keyCode === 461) {
      window.clearTimeout(okTimer); okTarget = null; heldOK = false;
      event.preventDefault(); goBack(); return;
    }
    if (event.key === 'Enter' || event.keyCode === 13) {
      event.preventDefault();
      if (event.repeat || okTarget) return;
      okTarget = document.activeElement;
      heldOK = false;
      if (!state.dialog && okTarget && okTarget.dataset.app) {
        okTimer = window.setTimeout(function () { heldOK = true; openDialog('organize-dialog'); }, 650);
      }
    }
  });
  document.addEventListener('keyup', function (event) {
    if (event.key === 'Enter' || event.keyCode === 13) {
      event.preventDefault(); window.clearTimeout(okTimer);
      var target = okTarget; okTarget = null;
      if (!heldOK && target && target.isConnected) target.click();
      heldOK = false;
    }
  });
  window.addEventListener('blur', function () { window.clearTimeout(okTimer); okTarget = null; heldOK = false; });
  window.addEventListener('resize', fitScreen);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) resume();
    else { persist(); stopVolumeWatch(); window.clearTimeout(okTimer); okTarget = null; heldOK = false; }
  });
  document.addEventListener('webOSRelaunch', resume);

  function resume() {
    state.launching = false;
    updateClock();
    renderApps();
    if (!state.dialog) focusCurrentContent();
    if (Date.now() - lastRefresh > 10000) {
      lastRefresh = Date.now();
      refreshApps(); refreshInputs();
    }
    if (state.dialog && state.dialog.id === 'control-dialog') { refreshTVStatus(); startVolumeWatch(); }
  }

  var initialView = state.view;
  fitScreen(); updateClock(); updatePreferences(); renderApps(); changeView(initialView, true);
  lastRefresh = Date.now();
  refreshApps();
  refreshInputs();
  window.CasaLauncher = {
    getState: function () { return { view: state.view, appPage: state.appPage, favorites: state.favorites.slice(), recent: state.recent.slice(), dialog: state.dialog && state.dialog.id, reducedMotion: state.reducedMotion, labels: state.labels, appCount: apps.length, bridge: bridge.getStatus() }; }
  };
})();

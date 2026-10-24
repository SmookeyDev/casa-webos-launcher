'use strict';

const Service = require('webos-service');
const fs = require('fs');
const path = require('path').posix;
const { isVisibleApp: visibleApp, validId } = require('./catalog-filter');
const service = new Service('com.soar.tv.launcher.service');
const OWNER = 'com.soar.tv.launcher';
const CALL_TIMEOUT = 1800;
const CATALOG_TTL = 30000;
const STATUS_TTL = 1000;
const ICON_MAX_BYTES = 128 * 1024;
const ICON_TOTAL_BYTES = 1536 * 1024;
const MAX_APPS = 96;
const LOCAL_ICON_ROOT = path.join(__dirname, 'icons');
const APP_ROOTS = [
  '/usr/palm/applications',
  '/mnt/otncabi/usr/palm/applications',
  '/media/cryptofs/apps/usr/palm/applications',
  '/media/developer/apps/usr/palm/applications',
  '/media/system/apps/usr/palm/applications'
];
const URI = Object.freeze({
  apps: 'luna://com.webos.applicationManager/listApps',
  points: 'luna://com.webos.applicationManager/listLaunchPoints',
  volume: 'luna://com.webos.audio/getVolume',
  watchVolume: 'luna://com.webos.service.audio/master/getVolume',
  output: 'luna://com.webos.service.audio/getSoundOutput',
  settings: 'luna://com.webos.settingsservice/getSystemSettings',
  network: 'luna://com.webos.service.connectionmanager/getstatus',
  networkFallback: 'luna://com.palm.connectionmanager/getStatus',
  up: 'luna://com.webos.audio/volumeUp',
  down: 'luna://com.webos.audio/volumeDown',
  mute: 'luna://com.webos.audio/setMuted'
});

let catalogCache = null;
let catalogPending = null;
let localIconRootPending = null;
let statusCache = null;
let statusPending = null;
let statusEpoch = 0;
let audioBusy = false;
let lastAudioAction = 0;
const volumeWatchers = new Map();
const MAX_VOLUME_WATCHERS = 2;

function failure(code, text) {
  const error = new Error(text);
  error.code = code;
  return error;
}

function publicError(error) {
  return {
    code: error && error.code || 'NATIVE_ERROR',
    message: error && error.code === 'TIMEOUT' ? 'A TV demorou para responder.' :
      error && error.code === 'ACCESS_DENIED' ? 'A TV não autorizou este recurso.' :
        error && error.code === 'INVALID_RESPONSE' ? 'A TV retornou dados incompletos.' :
          'Não foi possível consultar este recurso da TV.'
  };
}

// The native call() implementation has no cancellable return value. A transport
// subscription without subscribe:true is cancelled after one reply or timeout.
function callNative(uri, payload) {
  return new Promise((resolve, reject) => {
    let request;
    let finished = false;
    const timer = setTimeout(() => finish(failure('TIMEOUT', 'Native timeout')), CALL_TIMEOUT);
    function finish(error, reply) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (request && typeof request.cancel === 'function') {
        try { request.cancel(); } catch (_) { /* The bus may have closed it. */ }
      }
      if (error) reject(error);
      else resolve(reply);
    }
    function receive(message) {
      const reply = message && message.payload;
      if (!reply || typeof reply !== 'object' || Array.isArray(reply)) {
        finish(failure('INVALID_RESPONSE', 'Missing native payload'));
      } else if (reply.returnValue === false) {
        const denied = /denied|permission|not permitted|not allowed|not authorized/i.test(reply.errorText || '');
        finish(failure(denied ? 'ACCESS_DENIED' : 'NATIVE_ERROR', 'Native request failed'));
      } else {
        finish(null, reply);
      }
    }
    try {
      request = service.subscribe(uri, payload || {});
      request.on('response', receive);
      request.on('cancel', message => {
        if (finished) return;
        if (message && message.payload) receive(message);
        else finish(failure('NATIVE_ERROR', 'Native request cancelled'));
      });
      request.on('error', () => finish(failure('NATIVE_ERROR', 'Native transport failed')));
    } catch (_) {
      finish(failure('NATIVE_ERROR', 'Native transport unavailable'));
    }
  });
}

function appDirectory(value, id) {
  if (typeof value !== 'string' || !validId(id)) return null;
  const normalized = path.normalize(value);
  return APP_ROOTS.some(root => normalized === root + '/' + id) ? normalized : null;
}

function directoryFromIcon(value, id) {
  if (typeof value !== 'string' || !validId(id)) return null;
  const clean = value.replace(/^file:\/\//, '');
  for (const root of APP_ROOTS) {
    const folder = root + '/' + id;
    if (clean.startsWith(folder + '/')) return folder;
  }
  return null;
}

function iconCandidates(app) {
  const folder = appDirectory(app.folderPath, app.id) ||
    directoryFromIcon(app.largeIcon, app.id) || directoryFromIcon(app.icon, app.id);
  if (!folder) return [];
  return [app.largeIcon, app.icon].filter(value => typeof value === 'string' && value.length < 1024).map(value => {
    const clean = value.replace(/^file:\/\//, '');
    if (/^[a-z]+:/i.test(clean) || clean.includes('\0') || clean.includes('\\')) return null;
    const candidate = clean.startsWith(folder + '/') ? path.normalize(clean) : path.join(folder, clean.replace(/^\/+/, ''));
    if (!candidate.startsWith(folder + '/') || !/\.(png|jpe?g|webp)$/i.test(candidate)) return null;
    return candidate;
  }).filter(Boolean);
}

function allowedImagePath(value, localRoot, localId) {
  if (localId) return validId(localId) && localRoot && value === path.join(localRoot, localId + '.png');
  return APP_ROOTS.some(root => value.startsWith(root + '/')) && /\.(png|jpe?g|webp)$/i.test(value);
}

function localIconRoot() {
  if (!localIconRootPending) {
    localIconRootPending = Promise.all([
      fs.promises.realpath(__dirname), fs.promises.realpath(LOCAL_ICON_ROOT)
    ]).then(([serviceRoot, iconRoot]) => {
      // A symlinked service directory is allowed; a redirected icons folder is
      // not. Every fallback must stay in this package's real icons directory.
      return iconRoot === path.join(serviceRoot, 'icons') ? iconRoot : null;
    }).catch(() => null);
  }
  return localIconRootPending;
}

function imageMime(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'image/jpeg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

async function readIcon(candidate, deadline, localId) {
  if (Date.now() >= deadline) return null;
  let handle;
  try {
    const localRoot = localId ? await localIconRoot() : null;
    if (localId && !localRoot) return null;
    const real = await fs.promises.realpath(candidate);
    if (!allowedImagePath(real, localRoot, localId) || Date.now() >= deadline) return null;
    handle = await fs.promises.open(real, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 8 || stat.size > ICON_MAX_BYTES || Date.now() >= deadline) return null;
    const data = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < data.length && Date.now() < deadline) {
      const read = await handle.read(data, offset, data.length - offset, offset);
      if (!read.bytesRead) return null;
      offset += read.bytesRead;
    }
    if (offset !== data.length || Date.now() >= deadline) return null;
    const mime = imageMime(data);
    return mime && (!localId || mime === 'image/png') ? { uri: 'data:' + mime + ';base64,' + data.toString('base64'), bytes: data.length } : null;
  } catch (_) {
    // Other apps' files may be inaccessible inside the ordinary service jail.
    return null;
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

function catalogList(reply, key) {
  const items = reply && reply[key];
  if (!Array.isArray(items)) throw failure('INVALID_RESPONSE', 'Missing app inventory');
  return items;
}

async function loadCatalog() {
  const replies = await Promise.allSettled([
    callNative(URI.apps, {}).then(reply => catalogList(reply, 'apps')),
    callNative(URI.points, {}).then(reply => catalogList(reply, 'launchPoints'))
  ]);
  const errors = {};
  const merged = new Map();
  replies.forEach((result, index) => {
    if (result.status !== 'fulfilled') {
      errors[index ? 'launchPoints' : 'apps'] = publicError(result.reason);
      return;
    }
    result.value.slice(0, 1200).forEach(app => {
      if (!app || !validId(app.id)) return;
      merged.set(app.id, Object.assign({}, merged.get(app.id) || {}, app));
    });
  });
  if (replies.every(result => result.status === 'rejected')) {
    return { returnValue: true, available: false, apps: [], partial: true, errors, updatedAt: Date.now() };
  }
  const selected = Array.from(merged.values()).filter(visibleApp).slice(0, MAX_APPS);
  const apps = selected.map(app => ({
    id: app.id,
    title: String(app.id === 'com.webos.app.livetv' ? 'TV ao vivo' : app.title || app.name || app.id).slice(0, 160),
    systemApp: Boolean(app.systemApp)
  }));
  let bytes = 0;
  let cursor = 0;
  const deadline = Date.now() + 1800;
  async function worker() {
    while (cursor < selected.length && Date.now() < deadline) {
      const index = cursor++;
      const app = selected[index];
      const candidates = iconCandidates(app).map(candidate => ({ path: candidate, localId: null }));
      // The ID originates in the filtered native inventory, never the caller.
      if (validId(app.id)) candidates.push({ path: path.join(LOCAL_ICON_ROOT, app.id + '.png'), localId: app.id });
      for (const candidate of candidates) {
        const image = await readIcon(candidate.path, deadline, candidate.localId);
        if (image && bytes + image.bytes <= ICON_TOTAL_BYTES) {
          bytes += image.bytes;
          apps[index].icon = image.uri;
          break;
        }
      }
    }
  }
  // Two readers and a fixed deadline bound work; no directory scanning occurs.
  let iconTimer;
  try {
    await Promise.race([
      Promise.all([worker(), worker()]),
      new Promise(resolve => { iconTimer = setTimeout(resolve, 1800); })
    ]);
  } finally {
    clearTimeout(iconTimer);
  }
  return { returnValue: true, available: true, apps, partial: Object.keys(errors).length > 0, errors, updatedAt: Date.now() };
}

function getCatalog() {
  if (catalogCache && Date.now() - catalogCache.updatedAt < CATALOG_TTL) return Promise.resolve(catalogCache);
  if (!catalogPending) {
    catalogPending = loadCatalog().then(reply => {
      catalogCache = reply;
      return reply;
    }).finally(() => { catalogPending = null; });
  }
  return catalogPending;
}

function volumeFields(reply) {
  const rawVolume = reply.volumeStatus || reply;
  const volume = Number.isFinite(rawVolume.volume) && rawVolume.volume >= 0 && rawVolume.volume <= 100 ? rawVolume.volume : null;
  const muted = typeof rawVolume.muteStatus === 'boolean' ? rawVolume.muteStatus :
    typeof rawVolume.muted === 'boolean' ? rawVolume.muted : null;
  if (volume === null && muted === null) throw failure('INVALID_RESPONSE', 'Missing volume');
  return { volume, muted };
}

async function soundOutput() {
  let reply;
  try { reply = await callNative(URI.output, {}); } catch (_) {
    reply = await callNative(URI.settings, { category: 'sound', keys: ['soundOutput'] });
  }
  const output = reply.soundOutput || reply.settings && reply.settings.soundOutput;
  if (typeof output !== 'string' || !/^[A-Za-z0-9_+.-]{1,64}$/.test(output)) throw failure('INVALID_RESPONSE', 'Missing audio output');
  return output;
}

async function connection() {
  let reply;
  try { reply = await callNative(URI.network, {}); } catch (_) {
    reply = await callNative(URI.networkFallback, {});
  }
  const wifi = reply.wifi && reply.wifi.state;
  const wired = reply.wired && reply.wired.state;
  const type = wired === 'connected' ? 'wired' : wifi === 'connected' ? 'wifi' : null;
  const hasState = typeof wifi === 'string' || typeof wired === 'string';
  if (!hasState && typeof reply.isInternetConnectionAvailable !== 'boolean') {
    throw failure('INVALID_RESPONSE', 'Missing connection state');
  }
  return {
    connected: type ? true : hasState ? false : null,
    type,
    internet: typeof reply.isInternetConnectionAvailable === 'boolean' ? reply.isInternetConnectionAvailable : null
  };
}

async function loadTVStatus() {
  const replies = await Promise.allSettled([
    callNative(URI.volume, {}).then(volumeFields), soundOutput(), connection()
  ]);
  const errors = {};
  ['volume', 'soundOutput', 'network'].forEach((key, index) => {
    if (replies[index].status === 'rejected') errors[key] = publicError(replies[index].reason);
  });
  const audio = replies[0].status === 'fulfilled' ? replies[0].value : { volume: null, muted: null };
  return {
    returnValue: true,
    available: replies.some(result => result.status === 'fulfilled'),
    volume: audio.volume,
    muted: audio.muted,
    soundOutput: replies[1].status === 'fulfilled' ? replies[1].value : null,
    network: replies[2].status === 'fulfilled' ? replies[2].value : { connected: null, type: null, internet: null },
    capabilities: { volume: audio.volume !== null, mute: audio.muted !== null },
    partial: Object.keys(errors).length > 0,
    errors,
    updatedAt: Date.now()
  };
}

function getTVStatus() {
  if (statusCache && Date.now() - statusCache.updatedAt < STATUS_TTL) return Promise.resolve(statusCache);
  if (!statusPending) {
    const epoch = statusEpoch;
    const operation = loadTVStatus().then(reply => {
      if (epoch === statusEpoch) statusCache = reply;
      return reply;
    }).finally(() => {
      if (statusPending === operation) statusPending = null;
    });
    statusPending = operation;
  }
  return statusPending;
}

async function controlAudio(action) {
  if (audioBusy || Date.now() - lastAudioAction < 120) throw failure('BUSY', 'Aguarde o ajuste anterior.');
  audioBusy = true;
  lastAudioAction = Date.now();
  try {
    if (action === 'toggleMute') {
      const current = volumeFields(await callNative(URI.volume, {}));
      if (current.muted === null) throw failure('INVALID_RESPONSE', 'Estado de mudo indisponível.');
      await callNative(URI.mute, { muted: !current.muted });
    } else {
      await callNative(action === 'volumeUp' ? URI.up : URI.down, {});
    }
    statusEpoch++;
    statusCache = null;
    statusPending = null;
    // Never repeat a successful action when its following status read fails.
    try {
      const current = volumeFields(await callNative(URI.volume, {}));
      return Object.assign({ returnValue: true, updatedAt: Date.now() }, current);
    } catch (error) {
      return { returnValue: true, volume: null, muted: null, partial: true, errors: { volume: publicError(error) }, updatedAt: Date.now() };
    }
  } finally {
    audioBusy = false;
  }
}

function endReply(message, reply) {
  // Registered cancellation handlers let webos-service release the activity even
  // when a subscription request is rejected before it starts native work.
  if (message.isSubscription === true && typeof message.cancel === 'function') message.cancel(reply);
  else message.respond(reply);
}

function stopVolumeWatch(token) {
  const watcher = volumeWatchers.get(token);
  if (!watcher || watcher.closed) return;
  watcher.closed = true;
  volumeWatchers.delete(token);
  clearTimeout(watcher.initialTimer);
  if (watcher.native) {
    try { watcher.native.cancel(); } catch (_) { /* Native bus already closed. */ }
  }
}

function watchVolume(message) {
  if (!message || message.sender !== OWNER) {
    if (message) endReply(message, { returnValue: false, errorCode: 'ACCESS_DENIED', errorText: 'Este recurso pertence ao Casa.' });
    return;
  }
  const payload = message.payload;
  if (message.isSubscription !== true || !payload || typeof payload !== 'object' || Array.isArray(payload) ||
    Object.keys(payload).length !== 1 || payload.subscribe !== true || typeof message.cancel !== 'function' ||
    typeof message.uniqueToken !== 'string' || !message.uniqueToken || message.uniqueToken.length > 512) {
    endReply(message, { returnValue: false, errorCode: 'INVALID_ARGUMENTS', errorText: 'Use somente {subscribe:true} como assinatura.' });
    return;
  }
  const token = message.uniqueToken;
  if (volumeWatchers.size >= MAX_VOLUME_WATCHERS || volumeWatchers.has(token)) {
    endReply(message, { returnValue: false, errorCode: 'LIMIT_REACHED', errorText: 'Já existem duas consultas de volume abertas.' });
    return;
  }
  const watcher = { native: null, initialTimer: null, closed: false };
  volumeWatchers.set(token, watcher);
  function fail(error) {
    if (watcher.closed) return;
    stopVolumeWatch(token);
    const friendly = publicError(error);
    try { endReply(message, { returnValue: false, errorCode: friendly.code, errorText: friendly.message }); } catch (_) { /* Client already closed. */ }
  }
  function receive(nativeMessage) {
    if (watcher.closed) return;
    const reply = nativeMessage && nativeMessage.payload;
    if (!reply || typeof reply !== 'object' || Array.isArray(reply)) {
      fail(failure('INVALID_RESPONSE', 'Missing native volume payload'));
      return;
    }
    if (reply.returnValue === false) {
      const denied = /denied|permission|not permitted|not allowed|not authorized/i.test(reply.errorText || '');
      fail(failure(denied ? 'ACCESS_DENIED' : 'NATIVE_ERROR', 'Native volume subscription failed'));
      return;
    }
    // master/getVolume emits real changes but omits "subscribed" from its
    // initial/update payloads on this firmware. An explicit false still ends it.
    if (reply.subscribed === false) {
      fail(failure('NATIVE_ERROR', 'Native volume subscription ended'));
      return;
    }
    let current;
    try { current = volumeFields(reply); } catch (error) { fail(error); return; }
    clearTimeout(watcher.initialTimer);
    statusEpoch++;
    statusCache = null;
    statusPending = null;
    try {
      const delivered = message.respond({
        returnValue: true, subscribed: true,
        volume: current.volume, muted: current.muted, updatedAt: Date.now()
      });
      if (delivered === false) fail(failure('NATIVE_ERROR', 'Volume client closed'));
    } catch (_) {
      fail(failure('NATIVE_ERROR', 'Volume client closed'));
    }
  }
  watcher.initialTimer = setTimeout(() => fail(failure('TIMEOUT', 'Native volume subscription timeout')), 2000);
  try {
    watcher.native = service.subscribe(URI.watchVolume, { subscribe: true });
    watcher.native.on('response', receive);
    watcher.native.on('cancel', nativeMessage => {
      if (watcher.closed) return;
      const reply = nativeMessage && nativeMessage.payload;
      if (reply && reply.returnValue === false) receive(nativeMessage);
      else fail(failure('NATIVE_ERROR', 'Native volume subscription cancelled'));
    });
    watcher.native.on('error', () => fail(failure('NATIVE_ERROR', 'Native volume subscription error')));
  } catch (_) {
    fail(failure('NATIVE_ERROR', 'Native volume subscription unavailable'));
  }
}

function register(name, handler) {
  service.register(name, message => {
    if (!message || message.sender !== OWNER) {
      if (message) endReply(message, { returnValue: false, errorCode: 'ACCESS_DENIED', errorText: 'Este recurso pertence ao Casa.' });
      return;
    }
    const payload = message.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length || message.isSubscription) {
      endReply(message, { returnValue: false, errorCode: 'INVALID_ARGUMENTS', errorText: 'Este método aceita somente {} e não mantém assinaturas.' });
      return;
    }
    Promise.resolve().then(handler).then(reply => message.respond(reply)).catch(error => {
      const friendly = error && error.code === 'BUSY' ? error.message : publicError(error).message;
      message.respond({ returnValue: false, errorCode: error && error.code || 'NATIVE_ERROR', errorText: friendly });
    });
  }, () => {});
}

register('getCatalog', getCatalog);
register('getTVStatus', getTVStatus);
register('volumeUp', () => controlAudio('volumeUp'));
register('volumeDown', () => controlAudio('volumeDown'));
register('toggleMute', () => controlAudio('toggleMute'));
service.register('watchVolume', watchVolume, message => {
  if (message && typeof message.uniqueToken === 'string') stopVolumeWatch(message.uniqueToken);
});

// Only watchVolume retains a client-scoped subscription. No polling, keepalive,
// network listener or independent persistent activity is created.

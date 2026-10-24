(function (window) {
  'use strict';

  var bridgeConstructor = window.webOSServiceBridge || window.PalmServiceBridge;
  var serviceApi = window.webOS && window.webOS.service;
  var isTV = Boolean(
    bridgeConstructor || serviceApi || window.PalmSystem ||
    /Web0S|webOS|SmartTV/i.test(window.navigator.userAgent)
  );
  var pending = {};
  var requestNumber = 0;
  var diagnostics = {
    appsSource: isTV ? 'pending' : 'preview',
    inputsSource: isTV ? 'pending' : 'preview',
    appListError: null,
    inputListError: null,
    catalogVerificationErrors: 0,
    nativeService: false
  };

  function errorFor(message, code) {
    var error = new Error(message || 'A TV não concluiu a solicitação.');
    error.name = 'TVServiceError';
    error.code = code === undefined ? null : code;
    return error;
  }

  function catalog() {
    var value = window.LauncherCatalog || [];
    return Array.isArray(value) ? value : (value.apps || []);
  }

  function normalizeApp(app) {
    var known = catalog().filter(function (item) { return item.id === app.id; })[0];
    return Object.assign({}, known || {}, app, {
      id: app.id,
      title: (known && known.title) || app.title || app.name || app.id,
      icon: (known && known.icon) || app.icon || '',
      systemApp: Boolean(app.systemApp)
    });
  }

  function catalogApps() {
    return catalog().filter(function (app) {
      return app && typeof app.id === 'string' && app.id !== 'com.soar.tv.launcher';
    }).map(normalizeApp);
  }

  function orderApps(apps) {
    var order = catalog().map(function (app) { return app.id; });
    return apps.sort(function (a, b) {
      var left = order.indexOf(a.id); var right = order.indexOf(b.id);
      if (left >= 0 || right >= 0) return (left < 0 ? 999 : left) - (right < 0 ? 999 : right);
      return a.title.localeCompare(b.title, 'pt-BR');
    });
  }

  function request(uri, parameters, timeout) {
    if (!isTV) {
      return Promise.reject(errorFor('Esta solicitação só está disponível na TV.', 'PREVIEW'));
    }
    return new Promise(function (resolve, reject) {
      var key = ++requestNumber;
      var nativeRequest;
      var finished = false;
      var timer = window.setTimeout(function () {
        finish(errorFor('A TV demorou para responder. Tente novamente.', 'TIMEOUT'));
      }, timeout || 5000);

      function finish(error, response) {
        if (finished) return;
        finished = true;
        window.clearTimeout(timer);
        if (nativeRequest && typeof nativeRequest.cancel === 'function') {
          try { nativeRequest.cancel(); } catch (_) { /* Already closed by webOS. */ }
        }
        delete pending[key];
        if (error) reject(error);
        else resolve(response);
      }

      function receive(raw) {
        var result;
        try {
          result = typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch (_) {
          finish(errorFor('A TV retornou uma resposta inválida.', 'INVALID_RESPONSE'));
          return;
        }
        if (!result || typeof result !== 'object') {
          finish(errorFor('A TV retornou uma resposta vazia.', 'INVALID_RESPONSE'));
        } else if (result.returnValue === false) {
          finish(errorFor(result.errorText || 'A TV não permitiu esta solicitação.', result.errorCode));
        } else {
          finish(null, result);
        }
      }

      try {
        if (typeof bridgeConstructor === 'function') {
          nativeRequest = new bridgeConstructor();
          pending[key] = nativeRequest;
          nativeRequest.onservicecallback = receive;
          nativeRequest.call(uri, JSON.stringify(parameters || {}));
        } else if (serviceApi && typeof serviceApi.request === 'function') {
          var separator = uri.lastIndexOf('/');
          nativeRequest = serviceApi.request(uri.slice(0, separator), {
            method: uri.slice(separator + 1),
            parameters: parameters || {},
            onSuccess: receive,
            onFailure: function (error) {
              finish(errorFor(error.errorText || 'A TV não permitiu esta solicitação.', error.errorCode));
            }
          });
          if (!finished) pending[key] = nativeRequest;
        } else {
          finish(errorFor('A integração webOS não está disponível neste contexto.', 'BRIDGE_UNAVAILABLE'));
        }
      } catch (error) {
        finish(errorFor(error.message, 'BRIDGE_ERROR'));
      }
    });
  }

  function verifyCatalog() {
    var candidates = catalogApps();
    var results = [];
    diagnostics.catalogVerificationErrors = 0;
    // Four calls at a time avoid flooding the embedded service bus on startup.
    function batch(offset) {
      if (offset >= candidates.length) return Promise.resolve(results);
      return Promise.all(candidates.slice(offset, offset + 4).map(function (app) {
        return request('luna://com.webos.applicationManager/getAppLoadStatus', {
          appId: app.id
        }, 3500).then(function (reply) {
          if (reply.exist === true) return Object.assign({}, app, { verified: true });
          if (reply.exist === false) return null;
          diagnostics.catalogVerificationErrors++;
          return Object.assign({}, app, { verified: false });
        }).catch(function () {
          diagnostics.catalogVerificationErrors++;
          // These entries came from the owner's audited installed-app snapshot.
          return Object.assign({}, app, { verified: false });
        });
      })).then(function (apps) {
        results = results.concat(apps.filter(Boolean));
        return batch(offset + 4);
      });
    }
    return batch(0).then(function (apps) {
      diagnostics.appsSource = diagnostics.catalogVerificationErrors ? 'catalog-snapshot' : 'verified-catalog';
      return apps;
    });
  }

  function legacyListApps() {
    return request('luna://com.webos.applicationManager/listApps', {}).then(function (response) {
      if (!Array.isArray(response.apps)) throw errorFor('Inventário de aplicativos indisponível.', 'NO_APP_LIST');
      diagnostics.appsSource = 'live';
      diagnostics.appListError = null;
      return response.apps.filter(function (app) {
        return app && app.id && app.id !== 'com.soar.tv.launcher' &&
          app.visible !== false && !(app.class && app.class.hidden);
      }).map(normalizeApp);
    }).catch(function (error) {
      diagnostics.appListError = error.message;
      return verifyCatalog();
    });
  }

  function listApps() {
    if (!isTV) return Promise.resolve(catalogApps());
    return request('luna://com.soar.tv.launcher.service/getCatalog', {}, 9000).then(function (response) {
      if (!Array.isArray(response.apps) || !response.apps.length) throw errorFor('Catálogo indisponível.', 'NO_APP_LIST');
      diagnostics.nativeService = true;
      diagnostics.appsSource = response.partial ? 'native-partial' : 'native';
      diagnostics.appListError = null;
      return orderApps(response.apps.map(normalizeApp));
    }).catch(function () { return legacyListApps(); });
  }

  function getTVStatus() {
    if (!isTV) return Promise.resolve({ available: false, preview: true });
    return request('luna://com.soar.tv.launcher.service/getTVStatus', {}, 6500).then(function (result) {
      diagnostics.nativeService = true;
      return result;
    }).catch(function () { return { available: false }; });
  }

  function controlAudio(method) {
    if (!isTV) return Promise.reject(errorFor('Controle disponível na TV.', 'PREVIEW'));
    if (['volumeUp', 'volumeDown', 'toggleMute'].indexOf(method) < 0) return Promise.reject(errorFor('Controle inválido.', 'INVALID_CONTROL'));
    return request('luna://com.soar.tv.launcher.service/' + method, {}, 5000);
  }

  function watchVolume(receive) {
    if (!isTV) return function () {};
    var key = ++requestNumber;
    var nativeRequest;
    var stopped = false;
    var timer = window.setTimeout(stop, 5000);
    function stop() {
      if (stopped) return;
      stopped = true;
      window.clearTimeout(timer);
      if (nativeRequest && typeof nativeRequest.cancel === 'function') {
        try { nativeRequest.cancel(); } catch (_) { /* Already closed. */ }
      }
      delete pending[key];
    }
    function callback(raw) {
      if (stopped) return;
      window.clearTimeout(timer);
      try {
        var result = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!result || result.returnValue === false) { stop(); return; }
        receive(result);
        if (!result.subscribed) stop();
      } catch (_) { stop(); }
    }
    try {
      if (typeof bridgeConstructor === 'function') {
        nativeRequest = new bridgeConstructor();
        pending[key] = nativeRequest;
        nativeRequest.onservicecallback = callback;
        nativeRequest.call('luna://com.soar.tv.launcher.service/watchVolume', JSON.stringify({ subscribe: true }));
      } else if (serviceApi && typeof serviceApi.request === 'function') {
        nativeRequest = serviceApi.request('luna://com.soar.tv.launcher.service', {
          method: 'watchVolume', parameters: { subscribe: true }, onSuccess: callback, onFailure: stop
        });
        if (!stopped) pending[key] = nativeRequest;
      } else stop();
    } catch (_) { stop(); }
    return stop;
  }

  function fallbackInputs(preview) {
    var supplied = window.LauncherInputs;
    if (Array.isArray(supplied)) {
      return supplied.map(function (input) { return Object.assign({}, input); });
    }
    return [1, 2, 3].map(function (port) {
      return {
        id: 'HDMI_' + port,
        title: 'HDMI ' + port,
        appId: 'com.webos.app.hdmi' + port,
        connected: null,
        preview: Boolean(preview)
      };
    });
  }

  function listInputs() {
    if (!isTV) return Promise.resolve(fallbackInputs(true));
    return request('luna://com.webos.service.eim/getAllInputStatus', {}).then(function (response) {
      if (!Array.isArray(response.devices)) throw errorFor('Entradas indisponíveis.', 'NO_INPUT_LIST');
      diagnostics.inputsSource = 'live';
      diagnostics.inputListError = null;
      return response.devices.filter(function (input) {
        return input.appId && /^HDMI_\d+$/.test(input.id);
      }).map(function (input) {
        return {
          id: input.id,
          title: input.label || input.id.replace('_', ' '),
          appId: input.appId,
          connected: typeof input.connected === 'boolean' ? input.connected : null,
          signal: typeof input.hdmiSignalExist === 'boolean' ? input.hdmiSignalExist : null,
          deviceName: Array.isArray(input.subList) && input.subList.length ? input.subList[0].label || input.subList[0].name || '' : ''
        };
      });
    }).catch(function (error) {
      diagnostics.inputsSource = 'catalog-snapshot';
      diagnostics.inputListError = error.message;
      return fallbackInputs(false);
    });
  }

  function launchApp(id) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9._-]{1,180}$/.test(id)) {
      return Promise.reject(errorFor('Aplicativo inválido.', 'INVALID_APP'));
    }
    if (!isTV) {
      var app = catalogApps().filter(function (item) { return item.id === id; })[0];
      return Promise.resolve({ preview: true, id: id, title: app ? app.title : id });
    }
    return request('luna://com.webos.applicationManager/launch', { id: id }, 8000);
  }

  function openInput(input) {
    var id = typeof input === 'string' ? input : input && input.id;
    if (!/^HDMI_[1-3]$/.test(id || '')) {
      return Promise.reject(errorFor('Entrada inválida.', 'INVALID_INPUT'));
    }
    var appId = 'com.webos.app.hdmi' + id.slice(5);
    return launchApp(appId).then(function (result) {
      if (result.preview) result.title = input.title || id.replace('_', ' ');
      return result;
    });
  }

  function exit() {
    if (!isTV) return;
    if (window.webOS && typeof window.webOS.platformBack === 'function') {
      window.webOS.platformBack();
    } else if (window.PalmSystem && typeof window.PalmSystem.platformBack === 'function') {
      window.PalmSystem.platformBack();
    } else if (window.PalmSystem && typeof window.PalmSystem.close === 'function') {
      window.PalmSystem.close();
    } else {
      window.close();
    }
  }

  window.TVBridge = {
    isTV: isTV,
    listApps: listApps,
    listInputs: listInputs,
    launchApp: launchApp,
    openInput: openInput,
    openSettings: function () { return launchApp('com.palm.app.settings'); },
    openLiveTV: function () { return launchApp('com.webos.app.livetv'); },
    getTVStatus: getTVStatus,
    controlAudio: controlAudio,
    watchVolume: watchVolume,
    exit: exit,
    getStatus: function () { return Object.assign({}, diagnostics); }
  };
}(window));

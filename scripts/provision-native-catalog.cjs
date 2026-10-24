// Optional administrator tool. The Casa service keeps its ordinary jailed UID.
'use strict';

const nativeFs = require('fs');
const childProcess = require('child_process');
const path = require('path').posix;
const APP = 'com.soar.tv.launcher';
const SERVICE = APP + '.service';
const GROUPS = ['public', 'applications.internal'];
const PREFIXES = ['/var/luna-service2-dev', '/var/luna-service2'];
const BACKUP_ROOT = '/var/lib/casa-launcher/permission-backup';

function parseArguments(args) {
  const options = { restore: false, help: false, prefix: null };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--restore') options.restore = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--prefix' || arg.startsWith('--prefix=')) {
      if (options.prefix) throw new Error('Informe --prefix somente uma vez.');
      options.prefix = arg === '--prefix' ? args[++index] : arg.slice('--prefix='.length);
      if (!PREFIXES.includes(options.prefix)) throw new Error('--prefix aceita somente ' + PREFIXES.join(' ou ') + '.');
    } else throw new Error('Argumento desconhecido: ' + arg);
  }
  return options;
}

function run(args, dependencies) {
  const deps = dependencies || {};
  const fs = deps.fs || nativeFs;
  const execFileSync = deps.execFileSync || childProcess.execFileSync;
  const stdout = deps.stdout || process.stdout;
  const getuid = deps.getuid || (() => typeof process.getuid === 'function' ? process.getuid() : -1);
  const now = deps.now || (() => new Date().toISOString());
  const pid = deps.pid || process.pid;
  let temporaryNumber = 0;
  const options = parseArguments(args);
  if (options.help) {
    stdout.write('Uso na TV: node provision-native-catalog.cjs [--prefix PREFIXO] [--restore]\n' +
      'Prefixos permitidos: ' + PREFIXES.join(', ') + '\n' +
      'Requer root somente para provisionar/restaurar o grupo LS2 do serviço.\n');
    return;
  }
  if (getuid() !== 0) throw new Error('Execute na TV em uma sessão administrativa root existente.');

  function installedManifest(prefix) { return prefix + '/manifests.d/' + APP + '.json'; }
  const installed = PREFIXES.filter(prefix => fs.existsSync(installedManifest(prefix)));
  if (!options.prefix && installed.length > 1) {
    throw new Error('Há duas instalações. Qual prefixo deseja usar? Rode novamente com --prefix ' + PREFIXES.join(' ou --prefix ') + '.');
  }
  const prefix = options.prefix || installed[0];
  if (!prefix || !fs.existsSync(installedManifest(prefix))) throw new Error('Manifesto instalado do Casa não encontrado no prefixo escolhido.');
  const manifestPath = installedManifest(prefix);
  const clientPath = prefix + '/client-permissions.d/' + APP + '.native.json';
  const statePath = BACKUP_ROOT + '/' + (prefix === PREFIXES[0] ? 'developer' : 'system') + '.json';

  function snapshot(file) {
    let stat;
    try { stat = fs.lstatSync(file); } catch (error) {
      if (error.code === 'ENOENT') return { exists: false };
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Esperado arquivo regular, sem symlink: ' + file);
    return { exists: true, content: fs.readFileSync(file).toString('base64'), mode: stat.mode & 0o777 };
  }

  function parseSnapshot(value, label) {
    try {
      if (!value || value.exists !== true || typeof value.content !== 'string') throw new Error();
      return JSON.parse(Buffer.from(value.content, 'base64').toString('utf8'));
    } catch (_) { throw new Error('JSON inválido: ' + label + '. Nenhum arquivo foi alterado.'); }
  }

  function clientMap(value) {
    const result = parseSnapshot(value, 'permissões do cliente');
    if (!result || typeof result !== 'object' || Array.isArray(result) ||
      Object.values(result).some(groups => !Array.isArray(groups) || groups.some(group => typeof group !== 'string'))) {
      throw new Error('Formato de permissões inesperado; arquivo preexistente preservado.');
    }
    return result;
  }

  function validateSnapshot(value) {
    return value && (value.exists === false || value.exists === true && typeof value.content === 'string' &&
      Number.isInteger(value.mode) && value.mode >= 0 && value.mode <= 0o777);
  }

  function atomicWrite(file, bytes, mode) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: file === statePath ? 0o700 : 0o755 });
    const temporary = file + '.casa-tmp-' + pid + '-' + (++temporaryNumber);
    let descriptor;
    let created = false;
    try {
      descriptor = fs.openSync(temporary, 'wx', mode);
      created = true;
      fs.writeFileSync(descriptor, bytes);
      fs.fchmodSync(descriptor, mode);
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.renameSync(temporary, file);
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
      if (created) {
        try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }
  }

  function restoreSnapshot(file, value) {
    if (value.exists) atomicWrite(file, Buffer.from(value.content, 'base64'), value.mode);
    else {
      try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }

  function encoded(value, mode) {
    return { exists: true, content: Buffer.from(JSON.stringify(value, null, 2) + '\n').toString('base64'), mode };
  }

  function scan() { execFileSync('ls-control', ['scan-services'], { timeout: 10000, stdio: 'pipe' }); }

  const manifestSnapshot = snapshot(manifestPath);
  const grantSnapshot = snapshot(clientPath);
  const stateSnapshot = snapshot(statePath);
  const manifest = parseSnapshot(manifestSnapshot, 'manifesto');
  if (manifest.id !== APP || !Array.isArray(manifest.apiPermissionFiles) || !Array.isArray(manifest.clientPermissionFiles) ||
    manifest.apiPermissionFiles.some(item => typeof item !== 'string') || manifest.clientPermissionFiles.some(item => typeof item !== 'string')) {
    throw new Error('Manifesto instalado inesperado. Nenhum arquivo foi alterado.');
  }
  let state = stateSnapshot.exists ? parseSnapshot(stateSnapshot, 'backup') : null;
  if (state && (state.schema !== 1 || state.appId !== APP || state.service !== SERVICE || state.prefix !== prefix ||
    !['active', 'restored'].includes(state.status) || !validateSnapshot(state.manifestBefore) ||
    !validateSnapshot(state.grantBefore) || typeof state.referenceBefore !== 'boolean')) {
    throw new Error('Backup incompatível; preserve-o e revise antes de continuar.');
  }

  let nextGrant;
  if (options.restore) {
    if (state && state.status === 'restored') {
      stdout.write('Nenhum provisionamento ativo neste prefixo. Arquivos preexistentes preservados.\n');
      return;
    }
    if (!state || state.status !== 'active') {
      if (manifest.clientPermissionFiles.includes(clientPath) || grantSnapshot.exists) {
        throw new Error('Não há backup ativo deste provisionador; os arquivos existentes foram preservados.');
      }
      stdout.write('Nenhum provisionamento ativo neste prefixo.\n');
      return;
    }
    const original = state.grantBefore.exists ? clientMap(state.grantBefore) : {};
    if (!grantSnapshot.exists) {
      nextGrant = state.grantBefore;
    } else if (state.lastGrant && state.lastGrant.content === grantSnapshot.content) {
      nextGrant = state.grantBefore;
    } else {
      const current = clientMap(grantSnapshot);
      const originalGroups = original[SERVICE] || [];
      const removed = GROUPS.filter(group => !originalGroups.includes(group));
      if (Object.prototype.hasOwnProperty.call(current, SERVICE)) {
        current[SERVICE] = current[SERVICE].filter(group => !removed.includes(group));
        if (!current[SERVICE].length && !Object.prototype.hasOwnProperty.call(original, SERVICE)) delete current[SERVICE];
      }
      nextGrant = Object.keys(current).length || state.grantBefore.exists ? encoded(current, grantSnapshot.mode) : { exists: false };
    }
    if (!state.referenceBefore) manifest.clientPermissionFiles = manifest.clientPermissionFiles.filter(item => item !== clientPath);
    state = Object.assign({}, state, { status: 'restored', restoredAt: now() });
  } else {
    const current = grantSnapshot.exists ? clientMap(grantSnapshot) : {};
    if (!state || state.status !== 'active') {
      state = {
        schema: 1, appId: APP, service: SERVICE, prefix, status: 'active',
        manifestBefore: manifestSnapshot, grantBefore: grantSnapshot,
        referenceBefore: manifest.clientPermissionFiles.includes(clientPath), createdAt: now()
      };
    }
    const currentGroups = current[SERVICE] || [];
    const nextGroups = Array.from(new Set(currentGroups.concat(GROUPS)));
    if (GROUPS.every(group => currentGroups.includes(group))) nextGrant = grantSnapshot;
    else {
      current[SERVICE] = nextGroups;
      nextGrant = encoded(current, grantSnapshot.exists ? grantSnapshot.mode : 0o644);
    }
    if (!manifest.clientPermissionFiles.includes(clientPath)) manifest.clientPermissionFiles.push(clientPath);
    state = Object.assign({}, state, { lastGrant: nextGrant, appliedAt: now() });
  }

  const nextManifest = JSON.stringify(manifest) === JSON.stringify(parseSnapshot(manifestSnapshot, 'manifesto')) ?
    manifestSnapshot : encoded(manifest, manifestSnapshot.mode);
  fs.mkdirSync(BACKUP_ROOT, { recursive: true, mode: 0o700 });
  fs.chmodSync(BACKUP_ROOT, 0o700);
  const before = [[manifestPath, manifestSnapshot], [clientPath, grantSnapshot], [statePath, stateSnapshot]];
  let mutationStarted = false;
  try {
    mutationStarted = true;
    restoreSnapshot(statePath, encoded(state, 0o600));
    restoreSnapshot(clientPath, nextGrant);
    restoreSnapshot(manifestPath, nextManifest);
    scan();
  } catch (error) {
    const rollbackErrors = [];
    if (mutationStarted) {
      for (const [file, previous] of before) {
        try { restoreSnapshot(file, previous); } catch (_) { rollbackErrors.push(file); }
      }
      try { scan(); } catch (_) { rollbackErrors.push('recarga LS2'); }
    }
    throw new Error('Provisionamento falhou. ' + (rollbackErrors.length ?
      'Rollback incompleto: ' + rollbackErrors.join(', ') + '. Preserve o backup e revise o estado da TV.' :
      'Metadados anteriores restaurados e LS2 recarregado.') + ' Causa: ' + error.message);
  }
  stdout.write((options.restore ? 'Permissões adicionadas pelo Casa removidas de ' : 'Catálogo nativo provisionado somente para ' + SERVICE + ' em ') + prefix + '.\n');
  stdout.write('Backup administrativo: ' + statePath + '\nO serviço continua sem root; nenhuma alteração de Home ou boot foi feita.\n');
}

module.exports = { run, PREFIXES };
if (require.main === module || module.id === '[stdin]') {
  try { run(process.argv.slice(2)); }
  catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}

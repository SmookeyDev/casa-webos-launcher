'use strict';

// No SSH, real filesystem writes, ls-control or TV access: all dependencies are
// in-memory fakes. Run with node scripts/provision-native-catalog.test.cjs.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { run, PREFIXES } = require('./provision-native-catalog.cjs');
const APP = 'com.soar.tv.launcher';
const SERVICE = APP + '.service';
const BACKUP = '/var/lib/casa-launcher/permission-backup/';
const manifestPath = prefix => prefix + '/manifests.d/' + APP + '.json';
const grantPath = prefix => prefix + '/client-permissions.d/' + APP + '.native.json';
function missing() { return Object.assign(new Error('not found'), { code: 'ENOENT' }); }

class MemoryFS {
  constructor() { this.files = new Map(); this.descriptors = new Map(); this.nextDescriptor = 10; this.writes = []; }
  set(file, data, mode) { this.files.set(file, { bytes: Buffer.from(data), mode: mode === undefined ? 0o644 : mode, kind: 'file' }); }
  json(file) { return JSON.parse(this.readFileSync(file).toString()); }
  existsSync(file) { return this.files.has(file); }
  readFileSync(file) { if (!this.files.has(file)) throw missing(); return Buffer.from(this.files.get(file).bytes); }
  lstatSync(file) {
    const value = this.files.get(file); if (!value) throw missing();
    return { mode: value.mode, isFile: () => value.kind === 'file', isSymbolicLink: () => value.kind === 'symlink' };
  }
  mkdirSync() {}
  chmodSync() {}
  openSync(file, flags, mode) {
    assert.strictEqual(flags, 'wx');
    if (this.files.has(file)) throw Object.assign(new Error('exists'), { code: 'EEXIST' });
    this.set(file, '', mode); const descriptor = ++this.nextDescriptor; this.descriptors.set(descriptor, file); return descriptor;
  }
  writeFileSync(descriptor, bytes) { const file = this.descriptors.get(descriptor); assert(file); this.files.get(file).bytes = Buffer.from(bytes); }
  fchmodSync(descriptor, mode) { this.files.get(this.descriptors.get(descriptor)).mode = mode; }
  fsyncSync() {}
  closeSync(descriptor) { this.descriptors.delete(descriptor); }
  renameSync(source, target) { assert(this.files.has(source)); this.files.set(target, this.files.get(source)); this.files.delete(source); this.writes.push(target); }
  unlinkSync(file) { if (!this.files.delete(file)) throw missing(); }
}

function environment(prefixes) {
  const fs = new MemoryFS();
  for (const prefix of prefixes || [PREFIXES[0]]) {
    fs.set(manifestPath(prefix), JSON.stringify({ id: APP, version: '0.2.0', apiPermissionFiles: ['/keep.api'], clientPermissionFiles: ['/keep.client'] }));
  }
  let scans = 0;
  const output = [];
  const deps = {
    fs, stdout: { write: text => output.push(text) }, getuid: () => 0, now: () => 'test-time', pid: 77,
    execFileSync: (command, args, options) => {
      assert.strictEqual(command, 'ls-control'); assert.deepStrictEqual(args, ['scan-services']); assert.strictEqual(options.timeout, 10000);
      scans++; if (deps.failScan === scans || deps.failEveryScan) throw new Error('scan failed');
    }
  };
  return { fs, deps, output, scans: () => scans, run: args => run(args || [], deps) };
}

const passed = [];
function test(name, fn) { fn(); passed.push(name); }

test('Help is available without root or filesystem changes', () => {
  const env = environment(); env.deps.getuid = () => 1000; env.run(['--help']); assert.strictEqual(env.fs.writes.length, 0); assert.strictEqual(env.scans(), 0);
  assert.throws(() => env.run(), /root/);
});
test('The real Node stdin entrypoint executes --help', () => {
  const source = fs.readFileSync(path.join(__dirname, 'provision-native-catalog.cjs'), 'utf8');
  const result = spawnSync(process.execPath, ['-', '--help'], { input: source, encoding: 'utf8', timeout: 5000 });
  assert.ifError(result.error);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.match(result.stdout, /Uso na TV: node provision-native-catalog\.cjs/);
  assert.match(result.stdout, /--prefix/);
  assert.match(result.stdout, /--restore/);
  assert.strictEqual(result.stderr, '');
});
test('Only fixed prefixes are accepted and ambiguous installs require a choice', () => {
  const env = environment(PREFIXES); assert.throws(() => env.run(), /duas instalações/);
  assert.throws(() => env.run(['--prefix=/tmp/other']), /somente/); assert.strictEqual(env.fs.writes.length, 0);
  const dev = env.fs.readFileSync(manifestPath(PREFIXES[0])); env.run(['--prefix', PREFIXES[1]]);
  assert.deepStrictEqual(env.fs.readFileSync(manifestPath(PREFIXES[0])), dev);
  assert(env.fs.existsSync(BACKUP + 'system.json')); assert(!env.fs.existsSync(BACKUP + 'developer.json'));
});
test('Apply grants only the fixed service and backs up original bytes', () => {
  const env = environment(); const prefix = PREFIXES[0]; const original = env.fs.readFileSync(manifestPath(prefix)); env.run();
  assert.deepStrictEqual(env.fs.json(grantPath(prefix)), { [SERVICE]: ['public', 'applications.internal'] });
  const state = env.fs.json(BACKUP + 'developer.json'); assert.strictEqual(state.manifestBefore.content, original.toString('base64'));
  assert.strictEqual(env.fs.files.get(BACKUP + 'developer.json').mode, 0o600);
  assert.deepStrictEqual(env.fs.json(manifestPath(prefix)).apiPermissionFiles, ['/keep.api']);
});
test('Repeated apply keeps baseline and does not duplicate references', () => {
  const env = environment(); env.run(); const before = env.fs.json(BACKUP + 'developer.json').manifestBefore; env.run();
  assert.deepStrictEqual(env.fs.json(BACKUP + 'developer.json').manifestBefore, before);
  assert.strictEqual(env.fs.json(manifestPath(PREFIXES[0])).clientPermissionFiles.filter(item => item === grantPath(PREFIXES[0])).length, 1);
});
test('Reinstall/reapply/restore preserves the new installed manifest', () => {
  const env = environment(); const prefix = PREFIXES[0]; env.run();
  env.fs.set(manifestPath(prefix), JSON.stringify({ id: APP, version: '0.2.1', apiPermissionFiles: ['/new.api'], clientPermissionFiles: ['/new.client'] }));
  env.run(); env.run(['--restore']);
  assert.deepStrictEqual(env.fs.json(manifestPath(prefix)), { id: APP, version: '0.2.1', apiPermissionFiles: ['/new.api'], clientPermissionFiles: ['/new.client'] });
  assert(!env.fs.existsSync(grantPath(prefix))); assert.strictEqual(env.fs.json(BACKUP + 'developer.json').status, 'restored');
  env.run(['--restore']);
});
test('Preexisting grant file, groups, reference and mode are restored', () => {
  const env = environment(); const prefix = PREFIXES[0]; const file = grantPath(prefix);
  const original = '{"' + SERVICE + '":["custom"],"other.client":["public"]}\n'; env.fs.set(file, original, 0o640);
  const manifest = env.fs.json(manifestPath(prefix)); manifest.clientPermissionFiles.push(file); env.fs.set(manifestPath(prefix), JSON.stringify(manifest));
  env.run(); env.run(['--restore']);
  assert.strictEqual(env.fs.readFileSync(file).toString(), original); assert.strictEqual(env.fs.files.get(file).mode, 0o640);
  assert(env.fs.json(manifestPath(prefix)).clientPermissionFiles.includes(file));
  const scans = env.scans(); env.run(['--restore']); assert.strictEqual(env.scans(), scans);
  assert.strictEqual(env.fs.readFileSync(file).toString(), original);
});
test('Selective restore preserves later unrelated grant/manifest edits', () => {
  const env = environment(); const prefix = PREFIXES[0]; const file = grantPath(prefix); env.run();
  const current = env.fs.json(file); current[SERVICE].push('later.group'); current['later.client'] = ['public']; env.fs.set(file, JSON.stringify(current));
  const manifest = env.fs.json(manifestPath(prefix)); manifest.clientPermissionFiles.push('/later.client'); env.fs.set(manifestPath(prefix), JSON.stringify(manifest));
  env.run(['--restore']); assert.deepStrictEqual(env.fs.json(file), { [SERVICE]: ['later.group'], 'later.client': ['public'] });
  assert.deepStrictEqual(env.fs.json(manifestPath(prefix)).clientPermissionFiles, ['/keep.client', '/later.client']);
});
test('Duplicate existing groups cannot hide a missing private group', () => {
  const env = environment(); env.fs.set(grantPath(PREFIXES[0]), JSON.stringify({ [SERVICE]: ['public', 'public'] })); env.run();
  assert(env.fs.json(grantPath(PREFIXES[0]))[SERVICE].includes('applications.internal'));
});
test('Failed scan rolls back all file bytes and reloads previous LS2 state', () => {
  const env = environment(); const original = env.fs.readFileSync(manifestPath(PREFIXES[0])); env.deps.failScan = 1;
  assert.throws(() => env.run(), /Metadados anteriores restaurados/);
  assert.deepStrictEqual(env.fs.readFileSync(manifestPath(PREFIXES[0])), original);
  assert(!env.fs.existsSync(grantPath(PREFIXES[0]))); assert(!env.fs.existsSync(BACKUP + 'developer.json')); assert.strictEqual(env.scans(), 2);
  assert(!Array.from(env.fs.files.keys()).some(file => file.includes('.casa-tmp-')));
});
test('Failed restore rolls back to its active grant and backup', () => {
  const env = environment(); env.run(); const before = new Map(Array.from(env.fs.files, ([file, entry]) => [file, Buffer.from(entry.bytes)])); env.deps.failScan = 2;
  assert.throws(() => env.run(['--restore']), /Metadados anteriores restaurados/);
  for (const [file, bytes] of before) assert.deepStrictEqual(env.fs.readFileSync(file), bytes);
  assert.strictEqual(env.fs.json(BACKUP + 'developer.json').status, 'active');
});
test('Unrecoverable LS2 reload failure is reported explicitly', () => {
  const env = environment(); env.deps.failEveryScan = true; assert.throws(() => env.run(), /Rollback incompleto: recarga LS2/);
});
test('Legacy or malformed grants are not silently overwritten/restored', () => {
  const env = environment(); const file = grantPath(PREFIXES[0]); env.fs.set(file, 'malformed');
  assert.throws(() => env.run(), /JSON inválido/); assert.strictEqual(env.fs.readFileSync(file).toString(), 'malformed'); assert.strictEqual(env.fs.writes.length, 0);
  env.fs.set(file, JSON.stringify({ [SERVICE]: ['public', 'applications.internal'] }));
  assert.throws(() => env.run(['--restore']), /Não há backup ativo/); assert.strictEqual(env.fs.writes.length, 0);
});
test('Symlink targets are rejected before any mutation', () => {
  const env = environment(); env.fs.files.get(manifestPath(PREFIXES[0])).kind = 'symlink'; assert.throws(() => env.run(), /sem symlink/); assert.strictEqual(env.fs.writes.length, 0);
});
test('A preexisting temporary file is never deleted on exclusive-open failure', () => {
  const env = environment(); const existing = BACKUP + 'developer.json.casa-tmp-77-1'; env.fs.set(existing, 'preserve');
  assert.throws(() => env.run(), /Provisionamento falhou/); assert.strictEqual(env.fs.readFileSync(existing).toString(), 'preserve');
});

for (const name of passed) process.stdout.write('PASS ' + name + '\n');
process.stdout.write(passed.length + ' provisioner checks passed without TV access.\n');

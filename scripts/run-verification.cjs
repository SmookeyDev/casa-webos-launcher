'use strict';
const cp = require('node:child_process');
const path = require('node:path');
const base = path.resolve(__dirname, '..');
const port = Number(process.env.CASA_VERIFY_PORT || 4187);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid CASA_VERIFY_PORT.');
const origin = process.env.CASA_PREVIEW_URL || 'http://127.0.0.1:' + port;
let server;
async function isCasa() {
  try {
    const response = await fetch(new URL('/appinfo.json', origin), { signal: AbortSignal.timeout(1000) });
    if (!response.ok) return false;
    return (await response.json()).id === 'com.soar.tv.launcher';
  } catch (_) { return false; }
}
function run(file) {
  return new Promise((resolve, reject) => {
    const child = cp.spawn(process.execPath, [path.join(__dirname, file)], { cwd: base, stdio: 'inherit', env: Object.assign({}, process.env, { CASA_PREVIEW_URL: origin }) });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(Error(file + ' failed with code ' + code)));
  });
}
async function stop() {
  if (!server || server.exitCode !== null) return;
  const finished = new Promise(resolve => server.once('exit', resolve));
  server.kill();
  await Promise.race([finished, new Promise(resolve => setTimeout(resolve, 2000))]);
}
(async () => {
  try {
    if (!(await isCasa())) {
      if (process.env.CASA_PREVIEW_URL) throw Error('CASA_PREVIEW_URL must point to a running Casa preview.');
      server = cp.spawn(process.execPath, [path.join(__dirname, 'serve.cjs')], { cwd: base, stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { PORT: String(port) }) });
      let error = '';
      server.stderr.on('data', bytes => { error += bytes; });
      server.on('error', failure => { error += failure.message; });
      for (let attempt = 0; attempt < 40 && !(await isCasa()); attempt++) {
        if (server.exitCode !== null || error) throw Error('Could not start preview: ' + error);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!(await isCasa())) throw Error('Casa preview did not become ready.');
    }
    await run('verify.cjs');
    await run('verify-integration.cjs');
  } finally { await stop(); }
})().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });

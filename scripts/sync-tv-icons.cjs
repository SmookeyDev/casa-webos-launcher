// Development tool: exports only icons from this TV's selected native catalog.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const sharp = require('./dependencies.cjs')('sharp');
const target = process.argv[2] || process.env.TV_HOST;
if (!target || !/^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/.test(target)) throw Error('Pass the TV hostname/IP as the first argument or set TV_HOST.');
const key = process.env.SSH_KEY;
const user = process.env.TV_USER || 'root';
if (!/^[A-Za-z_][A-Za-z0-9_-]{0,31}$/.test(user)) throw Error('Invalid TV_USER.');
const connection = user + '@' + target;
const options = (key ? ['-i', path.resolve(key)] : []).concat(['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=6']);
const base = path.join(__dirname, '..');
const known = JSON.parse(fs.readFileSync(path.join(base, 'app/assets/icons/catalog.json'), 'utf8'));
const additions = [
 ['com.webos.app.livetv', 'TV ao vivo'], ['com.webos.app.browser', 'Navegador Web'],
 ['com.webos.app.homeconnect', 'Hub Inicial'], ['com.webos.app.discovery', 'Apps'],
 ['clock-o-clock', 'clock o clock'], ['com.dasverse.app.dailyartstory', 'DailyArtStory'],
 ['com.webos.app.camera', 'Câmera']
];
const ids = new Set(known.map(a => a.id).concat(additions.map(a => a[0])));
const raw = process.argv[3] ? fs.readFileSync(process.argv[3], 'utf8').replace(/^\uFEFF/, '') : cp.execFileSync('ssh', options.concat([connection, 'node', '-']), {
  input: 'const cp=require("child_process");process.stdout.write(cp.execFileSync("luna-send",["-w","5000","-n","1","luna://com.webos.applicationManager/listApps","{}"],{encoding:"utf8"}));\n',
  encoding: 'utf8', timeout: 15000, maxBuffer: 2 * 1024 * 1024
});
if (!raw.trim()) throw Error('SSH returned an empty inventory. Pass a saved listApps JSON as the third argument.');
const apps = JSON.parse(raw).apps.filter(a => ids.has(a.id));
const serviceIcons = path.join(base, 'services/com.soar.tv.launcher.service/icons');
fs.mkdirSync(serviceIcons, { recursive: true });
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'casa-icons-'));
(async () => {
 for (const app of apps) {
  if (!/^[a-zA-Z0-9._-]+$/.test(app.id) || !app.folderPath) continue;
  const folder = path.posix.normalize(app.folderPath);
  if (!['/usr/palm/applications', '/mnt/otncabi/usr/palm/applications', '/media/cryptofs/apps/usr/palm/applications', '/media/developer/apps/usr/palm/applications'].some(root => folder === root + '/' + app.id)) continue;
  const source = app.largeIcon || app.icon;
  if (typeof source !== 'string') continue;
  const remote = source.startsWith(folder + '/') ? path.posix.normalize(source) : path.posix.join(folder, source.replace(/^\/+/, ''));
  if (!remote.startsWith(folder + '/') || !/^[A-Za-z0-9/._-]+$/.test(remote)) continue;
  const downloaded = path.join(temporary, app.id + '.source');
  try {
   try {
    cp.execFileSync('scp', ['-O'].concat(options, [connection + ':' + remote, downloaded]), { timeout: 15000, stdio: 'pipe' });
   } catch (_) {
    // LG may report a missing translated resources/pt icon while the base exists.
    cp.execFileSync('scp', ['-O'].concat(options, [connection + ':' + folder + '/' + path.posix.basename(remote), downloaded]), { timeout: 15000, stdio: 'pipe' });
   }
   const png = await sharp(downloaded).resize(192, 192, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
   fs.writeFileSync(path.join(serviceIcons, app.id + '.png'), png);
   if (!known.some(a => a.id === app.id)) {
    fs.writeFileSync(path.join(base, 'app/assets/icons', app.id + '.png'), png);
    const pixels = await sharp(png).ensureAlpha().raw().toBuffer();
    const color = pixels[3] > 240 ? '#' + Array.from(pixels.subarray(0, 3)).map(n => n.toString(16).padStart(2, '0')).join('') : '#26303c';
    const label = additions.find(a => a[0] === app.id);
    known.push({ id: app.id, title: label ? label[1] : app.title, icon: 'assets/icons/' + app.id + '.png', color, systemApp: Boolean(app.systemApp) });
   }
   process.stdout.write('Icon exported: ' + app.id + '\n');
  } catch (_) { process.stdout.write('Icon unavailable: ' + app.id + '\n'); }
  finally { if (fs.existsSync(downloaded)) fs.unlinkSync(downloaded); }
 }
 fs.rmdirSync(temporary);
 fs.writeFileSync(path.join(base, 'app/assets/icons/catalog.json'), JSON.stringify(known, null, 2) + '\n');
 fs.writeFileSync(path.join(base, 'app/js/catalog.js'), 'window.LauncherCatalog = ' + JSON.stringify(known, null, 2) + ';\n');
})().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });

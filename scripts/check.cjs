'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const base = path.resolve(__dirname, '..');
const pkg = require('../package.json');
const app = require('../app/appinfo.json');
const native = require('../services/com.soar.tv.launcher.service/package.json');
if (pkg.version !== app.version || pkg.version !== native.version) throw Error('App, service and package versions must match.');
function visit(folder) {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) visit(file);
    else if (/\.(c?js)$/.test(file)) cp.execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
    else if (entry.name.endsWith('.json')) JSON.parse(fs.readFileSync(file, 'utf8'));
  }
}
visit(path.join(base, 'app'));
visit(path.join(base, 'services'));
for (const file of fs.readdirSync(__dirname).filter(name => name.endsWith('.cjs') && !name.startsWith('tv-'))) {
  cp.execFileSync(process.execPath, ['--check', path.join(__dirname, file)], { stdio: 'inherit' });
}
process.stdout.write('JavaScript syntax, JSON and version consistency passed.\n');

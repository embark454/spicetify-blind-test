const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('incomplete release package leaves the existing installation untouched', { skip: process.platform !== 'win32' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blind-test-preflight-'));
  const destination = path.join(root, 'spicetify', 'CustomApps', 'blind-test');
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, 'index.js'), 'original installation');
  fs.writeFileSync(path.join(root, 'spicetify', 'config-xpui.ini'), 'original config');
  fs.copyFileSync(path.join(__dirname, '..', 'INSTALLER.ps1'), path.join(root, 'INSTALLER.ps1'));
  fs.writeFileSync(path.join(root, 'spicetify.cmd'), '@exit /b 0\r\n');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'INSTALLER.ps1')], {
    encoding: 'utf8', timeout: 20000, env: { ...process.env, APPDATA: root, PATH: root + path.delimiter + process.env.PATH }
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Incomplete Blind Test package/);
  assert.equal(fs.readFileSync(path.join(destination, 'index.js'), 'utf8'), 'original installation');
  assert.equal(fs.readFileSync(path.join(root, 'spicetify', 'config-xpui.ini'), 'utf8'), 'original config');
  assert.equal(fs.existsSync(path.join(root, 'sauvegardes')), false);
});

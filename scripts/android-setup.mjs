// Idempotent setup. Run once from the repo root:  node scripts/android-setup.mjs
//  1. applies the source patches in ./patches (skips the ones already applied)
//  2. adds the Capacitor deps + android:* scripts to package.json
//  3. removes every GitHub workflow except android.yml (pass --keep-workflows to skip)
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const run = (cmd) => { try { execSync(cmd, { stdio: 'pipe' }); return true; } catch { return false; } };

// 1. patches
for (const f of fs.readdirSync('patches').filter(f => f.endsWith('.patch')).sort()) {
  const p = path.join('patches', f);
  const flags = '--ignore-whitespace';
  if (run(`git apply ${flags} --check "${p}"`)) {
    execSync(`git apply ${flags} "${p}"`, { stdio: 'inherit' });
    console.log('applied  ', f);
  } else if (run(`git apply ${flags} --check -R "${p}"`)) {
    console.log('already  ', f);
  } else {
    console.error(`ERRO: o patch ${f} não aplica e não está aplicado. O arquivo foi alterado em relação ao Blockbench 5.2.1?`);
    process.exit(1);
  }
}

// 2. package.json
const raw = fs.readFileSync('package.json', 'utf8');
const pkg = JSON.parse(raw);
pkg.scripts ??= {};
pkg.devDependencies ??= {};
Object.assign(pkg.scripts, {
  'android:prepare': 'node scripts/prepare-www.mjs',
  'android:add': 'npx cap add android && node scripts/android-overlay.mjs',
  'android:sync': 'node scripts/prepare-www.mjs && node scripts/android-overlay.mjs && npx cap sync android',
});
for (const dep of ['@capacitor/android', '@capacitor/cli', '@capacitor/core']) {
  pkg.devDependencies[dep] ??= '^7.4.0';
}
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
const out = JSON.stringify(pkg, null, '\t').replace(/\n/g, eol) + (raw.endsWith('\n') ? eol : '');
if (out !== raw) { fs.writeFileSync('package.json', out); console.log('updated   package.json'); }
else console.log('already   package.json');

// 3. other workflows
if (!process.argv.includes('--keep-workflows') && fs.existsSync('.github/workflows')) {
  for (const f of fs.readdirSync('.github/workflows')) {
    if (f === 'android.yml') continue;
    fs.rmSync(path.join('.github/workflows', f));
    console.log('removed   .github/workflows/' + f);
  }
}
console.log('setup ok');

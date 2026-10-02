// Builds the regular Blockbench WEB target and copies what the WebView needs into ./www
import { execSync } from 'node:child_process';
import fs from 'node:fs';

execSync('node build.js --target=web', { stdio: 'inherit' });

fs.rmSync('www', { recursive: true, force: true });
fs.mkdirSync('www/dist', { recursive: true });
fs.copyFileSync('dist/bundle.js', 'www/dist/bundle.js');

const items = ['index.html', 'css', 'font', 'lib', 'assets', 'icons', 'lang', 'themes',
  'keymaps', 'content', 'favicon.png', 'icon.png', 'icon_full.png', 'icon_maskable.png',
  'manifest.webmanifest'];
for (const item of items) {
  if (fs.existsSync(item)) fs.cpSync(item, `www/${item}`, { recursive: true });
  else console.warn('skip (not found):', item);
}
console.log('www ready');

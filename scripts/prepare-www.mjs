// Builds the regular Blockbench WEB target and copies what the WebView needs into ./www
import { execSync } from 'node:child_process';
import fs from 'node:fs';

execSync('node build.js --target=web', { stdio: 'inherit' });

// O WebView carrega o bundle como módulo ES: qualquer import de módulo "cru" (ex.: 'buffer', 'fs') que o esbuild
// tenha deixado de fora derruba o app inteiro ("Failed to resolve module specifier"). Barra o build aqui.
// O esbuild relê o bundle e lista os imports externos de verdade (sem confundir com texto dentro de strings).
{
  const { build } = await import('esbuild');
  const r = await build({ entryPoints: ['dist/bundle.js'], bundle: true, write: false, metafile: true, format: 'esm', platform: 'neutral', external: ['*'], logLevel: 'silent' });
  const out = Object.values(r.metafile.outputs)[0];
  const bare = [...new Set(out.imports.filter(i => i.external).map(i => i.path))];
  if (bare.length) {
    console.error('ERRO: o bundle ainda importa módulos que o WebView não resolve: ' + bare.join(', ') +
      '\nUse o pacote npm com barra no fim (ex.: "buffer/") ou inclua o módulo no bundle.');
    process.exit(1);
  }
}

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
// "Forçar Versão de Computador (Web)": o app grava bb_android_force_desktop=1 e, na próxima abertura,
// este trecho (executado antes do Blockbench) troca o viewport para uma largura de desktop.
const indexPath = 'www/index.html';
let html = fs.readFileSync(indexPath, 'utf8');
// viewport fixo: sem zoom de pinça (conflita com os controles de touch) e com viewport-fit=cover (preencher a tela)
html = html.replace(/(<meta name="viewport" content=")[^"]*(")/i, '$1width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover$2');
const snippet = `<script>(function(){try{if(localStorage.getItem('bb_android_force_desktop')!=='1')return;
function fit(){var m=document.querySelector('meta[name=viewport]');if(!m)return;var sc=(Math.min(screen.width,screen.height)/1280).toFixed(3);m.setAttribute('content','width=1280, initial-scale='+sc+', minimum-scale='+sc+', maximum-scale='+sc+', user-scalable=no, viewport-fit=cover');}
fit();
// se o WebView ignorar o viewport (ex.: tela em pé), tenta de novo e recarrega uma vez quando a largura virar a de desktop
function check(){fit();setTimeout(function(){try{if(window.innerWidth>=900){sessionStorage.removeItem('bb_fd_retry');return;}
if(!sessionStorage.getItem('bb_fd_retry')){sessionStorage.setItem('bb_fd_retry','1');fit();setTimeout(function(){if(window.innerWidth>=900)location.reload();},400);}}catch(e){}},250);}
window.addEventListener('load',check);window.addEventListener('orientationchange',function(){setTimeout(fit,150);});
}catch(e){}})();</script>`;
if (!html.includes('bb_android_force_desktop')) {
  html = html.replace(/(<meta name="viewport"[^>]*>)/i, `$1\n\t${snippet}`);
  if (!html.includes('bb_android_force_desktop')) console.warn('viewport meta não encontrado em index.html');
  fs.writeFileSync(indexPath, html);
}
console.log('www ready');

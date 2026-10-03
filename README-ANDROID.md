# Blockbench Android (Capacitor)

Base: Blockbench 5.2.1, target **web** (não o Electron). A ponte só ativa dentro do app Android; no navegador nada muda.

## O que foi feito
| Problema | Causa no código | Solução |
|---|---|---|
| Download com nome genérico | `Filesystem.exportFile` (js/file_system.ts) usa `saveAs()` com blob; o WebView do Android não repassa o nome | Hook no início de `exportFile` → `AndroidBridge` → plugin nativo `saveFile` (ACTION_CREATE_DOCUMENT) com o nome real; tenta renomear se o provedor acrescentar extensão |
| `player.jem` exporta como `model.jem` | `Codec.load` (js/io/codec.ts) só define `Project.name` a partir do arquivo aberto quando `isApp`; na web o nome fica vazio e `Codec.fileName()` cai em `'model'` | Patch em `Codec.load`: na web/Android, `Project.name = nome do arquivo aberto` (sem extensão), então o export sugere `player.jem` |
| Modelos abertos somem | `AutoBackup` salva só o projeto **selecionado**, a cada ≥5 s, e a recuperação depende de um clique na tela inicial | Salva ao ir para segundo plano (`visibilitychange`/`pagehide`) e antes de trocar de aba (`save_editor_state`); `AutoBackup.initialize()` reabre os projetos automaticamente ao iniciar (patch em `auto_backup.ts`, sem o aviso de recuperar) |
| App precisa continuar aberto | — | `KeepAliveService` (serviço em primeiro plano, tipo `specialUse`) + `resumeTimers()` no `onPause` |

## Ícone e splash
`scripts/generate-android-assets.py` gera ícones (legado + adaptativo) e splash a partir de `icon.png` / `icon_maskable.png`, em `android-overlay/res/`. `android-overlay.mjs` copia isso por cima do template do Capacitor (troca o ícone e o splash padrão).

## Menu flutuante (☰) e controles de touch
Código em `js/android/` (carregado só dentro do app Android):
- `android_menu.ts` — botão ☰ no topo central e os menus laterais empilhados (Enviar Input, Configurações Persistentes, Forçar Encerramento). O Voltar do Android fecha o menu de cima sem desfazer nada no Blockbench.
- `touch_controls.ts` + `touch_editor.ts` — controles na tela e editor de perfis. `pojav_format.ts` lê/grava o **mesmo JSON do PojavLauncher** (versões 2–8; campos `mControlDataList`, `mDrawerDataList`, `mJoystickDataList`, `dynamicX/Y` com `${margin}`, `${width}`…, códigos GLFW e botões especiais −1…−9). `keymap.ts` traduz GLFW → teclas do DOM (gerado a partir do `LwjglGlfwKeycode.java` do Pojav).
- `input_emulator.ts` — teclado, mouse (botões, rolagem, ponteiro virtual estilo trackpad) e teclado virtual.
- Perfis ficam no `localStorage` do app; exportar/importar usa o seletor nativo de arquivos.

**Keep Alive:** o serviço agora é `START_NOT_STICKY`, tem `stopWithTask`, para em `onTaskRemoved` e quando a Activity é fechada de verdade (`onDestroy` com `isFinishing`). "Forçar Encerramento" para o serviço, remove a tarefa e mata o processo.

**Forçar Versão de Computador:** grava `bb_android_force_desktop`; um script injetado no `index.html` (por `prepare-www.mjs`) troca o viewport para 1280 px na abertura seguinte. Exige recarregar.

**Não portado do Pojav** (não faz sentido no Blockbench): rotação de câmera "grab", hotbar, e o formato v1 (sem `version`).

## Como aplicar no clone do Blockbench
1. Copie o conteúdo deste zip para a raiz do repo (mesclando pastas): `js/android/`, `scripts/`, `patches/`, `android-overlay/`, `capacitor.config.json`, `.github/workflows/android.yml`
2. Na raiz do repo: `node scripts/android-setup.mjs` — aplica os patches (pula os já aplicados), adiciona as deps do Capacitor e os scripts `android:*` no `package.json` e **apaga os outros workflows** do GitHub (use `--keep-workflows` para manter).
3. `git add -A && git commit && git push` — o workflow **Build Android APK** roda sozinho e também por "Run workflow". O APK sai em Artifacts.
4. Local (opcional): `npm install` → `npm run android:add` (1ª vez) → `npm run android:sync` → `cd android && ./gradlew assembleDebug`.

## Limites conhecidos / a testar no aparelho
- O seletor de salvar do Android nunca sobrescreve: se `player.jem` já existir na pasta, ele cria `player (1).jem`.
- O botão Voltar do Android fecha a Activity (a sessão volta pelo backup, mas o estado ao vivo se perde).
- Pode haver recursos online do Blockbench (lista de plugins etc.) que dependam de CORS a partir de `https://localhost`; não testei.
- Compilei o build web e a ponte TS aqui; o **Java/Gradle não foi compilado** (sem Android SDK neste ambiente) — o primeiro build no Actions pode apontar ajustes.
- Se o Android matar o processo, a sessão é restaurada, mas o app não "ressuscita" sozinho em segundo plano (limite do Android 12+).
- `specialUse` exige justificativa se um dia for para a Play Store; para sideload não.
- `androidScheme: https` define a origem do IndexedDB — mudar depois faz os backups antigos "sumirem".
- Fase 2 (toque, drawers, modificadores virtuais) ainda não iniciada.

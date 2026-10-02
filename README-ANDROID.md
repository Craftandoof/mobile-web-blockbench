# Blockbench Android (Capacitor)

Base: Blockbench 5.2.1, target **web** (não o Electron). A ponte só ativa dentro do app Android; no navegador nada muda.

## O que foi feito
| Problema | Causa no código | Solução |
|---|---|---|
| Download com nome genérico | `Filesystem.exportFile` (js/file_system.ts) usa `saveAs()` com blob; o WebView do Android não repassa o nome | Hook no início de `exportFile` → `AndroidBridge` → plugin nativo `saveFile` (ACTION_CREATE_DOCUMENT) com o nome real; tenta renomear se o provedor acrescentar extensão |
| `player.jem` exporta como `model.jem` | `Codec.load` (js/io/codec.ts) só define `Project.name` a partir do arquivo aberto quando `isApp`; na web o nome fica vazio e `Codec.fileName()` cai em `'model'` | Patch em `Codec.load`: na web/Android, `Project.name = nome do arquivo aberto` (sem extensão), então o export sugere `player.jem` |
| Modelos abertos somem | `AutoBackup` salva só o projeto **selecionado**, a cada ≥5 s, e a recuperação depende de um clique na tela inicial | Salva ao ir para segundo plano (`visibilitychange`/`pagehide`) e antes de trocar de aba (`save_editor_state`); `AutoBackup.initialize()` reabre os projetos automaticamente ao iniciar (patch em `auto_backup.ts`, sem o aviso de recuperar) |
| App precisa continuar aberto | — | `KeepAliveService` (serviço em primeiro plano, tipo `specialUse`) + `resumeTimers()` no `onPause` |

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

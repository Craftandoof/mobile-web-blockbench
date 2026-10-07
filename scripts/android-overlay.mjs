// Run after `npx cap add android`. Copies native sources and patches AndroidManifest.xml (idempotent).
import fs from 'node:fs';
import path from 'node:path';

const pkgDir = 'android/app/src/main/java/com/craftandoof/blockbench';
fs.mkdirSync(pkgDir, { recursive: true });
for (const f of fs.readdirSync('android-overlay/java')) {
  fs.copyFileSync(path.join('android-overlay/java', f), path.join(pkgDir, f));
}

// Ícones e splash do Blockbench (gerados por scripts/generate-android-assets.py)
if (fs.existsSync('android-overlay/res')) {
  fs.cpSync('android-overlay/res', 'android/app/src/main/res', { recursive: true, force: true });
}

const manifestPath = 'android/app/src/main/AndroidManifest.xml';
let m = fs.readFileSync(manifestPath, 'utf8');

const perms = [
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
  'android.permission.WAKE_LOCK',
];
for (const p of perms) {
  if (!m.includes(p)) m = m.replace('</manifest>', `    <uses-permission android:name="${p}" />\n</manifest>`);
}
// Acesso a arquivos para os plugins desktop (fs real). MANAGE_EXTERNAL_STORAGE = "acesso a todos os arquivos".
for (const [perm, attrs] of [
  ['android.permission.MANAGE_EXTERNAL_STORAGE', ''],
  ['android.permission.READ_EXTERNAL_STORAGE', ' android:maxSdkVersion="32"'],
  ['android.permission.WRITE_EXTERNAL_STORAGE', ' android:maxSdkVersion="29"'],
]) {
  if (!m.includes(perm)) m = m.replace('</manifest>', `    <uses-permission android:name="${perm}"${attrs} />\n</manifest>`);
}
if (!m.includes('requestLegacyExternalStorage')) m = m.replace('<application', '<application\n        android:requestLegacyExternalStorage="true"');
if (!m.includes('KeepAliveService')) {
  m = m.replace('</application>', `
        <service
            android:name=".KeepAliveService"
            android:exported="false"
            android:stopWithTask="true"
            android:foregroundServiceType="specialUse">
            <property
                android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE"
                android:value="Keeps the open model editing session alive in the background" />
        </service>
    </application>`);
}
if (m.includes('KeepAliveService') && !m.includes('android:stopWithTask')) {
  m = m.replace('android:name=".KeepAliveService"', 'android:name=".KeepAliveService"\n            android:stopWithTask="true"');
}
fs.writeFileSync(manifestPath, m);
console.log('Android overlay applied');

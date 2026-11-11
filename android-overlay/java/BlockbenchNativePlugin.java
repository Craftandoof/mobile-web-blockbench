package com.craftandoof.blockbench;

import android.Manifest;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.ParcelFileDescriptor;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.util.Base64;
import android.util.Log;
import androidx.core.app.ActivityCompat;
import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

@CapacitorPlugin(
    name = "BlockbenchNative",
    permissions = {
        @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications")
    }
)
public class BlockbenchNativePlugin extends Plugin {

    /** Injeta window.BBNativeFs (fs síncrono dos plugins desktop) antes de a página carregar. */
    @Override
    public void load() {
        try {
            getBridge().getWebView().addJavascriptInterface(new NativeFs(getContext()), "BBNativeFs");
            getBridge().getWebView().addJavascriptInterface(new NativeProc(getContext()), "BBNativeProc");
            getBridge().getWebView().addJavascriptInterface(new NativeStage(getContext()), "BBNativeStage");
            NativeStage.sweep(getContext(), prefs().getString("stage", null));
        } catch (Exception ignored) { /* sem WebView: o JS avisa que o acesso nativo não existe */ }
    }

    @PluginMethod
    public void hasAllFilesAccess(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", NativeFs.hasAllFilesAccess(getContext()));
        call.resolve(r);
    }

    /** Abre a tela do sistema para conceder "acesso a todos os arquivos" (ou pede a permissão clássica no Android < 11). */
    @PluginMethod
    public void requestAllFilesAccess(PluginCall call) {
        Context ctx = getContext();
        if (Build.VERSION.SDK_INT >= 30) {
            try {
                Intent i = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:" + ctx.getPackageName()));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(i);
            } catch (Exception e) {
                Intent i = new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(i);
            }
        } else if (getActivity() != null) {
            ActivityCompat.requestPermissions(getActivity(),
                new String[] { Manifest.permission.READ_EXTERNAL_STORAGE, Manifest.permission.WRITE_EXTERNAL_STORAGE }, 4242);
        }
        call.resolve();
    }

    @PluginMethod
    public void openExternal(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) { call.reject("URL ausente"); return; }
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) { call.reject("Não foi possível abrir: " + e.getMessage()); }
    }

    // ---------- Native save dialog (SAF) with the real file name ----------
    // O conteúdo vai primeiro para um arquivo temporário do app (BBNativeStage, em pedaços) e o que fica pendente é
    // guardado em SharedPreferences. Se o Android recriar a tela enquanto o seletor está aberto, o PluginCall se perde,
    // mas o salvamento ainda termina a partir do arquivo temporário (antes o arquivo era criado vazio).
    private android.content.SharedPreferences prefs() { return getContext().getSharedPreferences("bb_native_pending", Context.MODE_PRIVATE); }

    @PluginMethod
    public void saveFile(PluginCall call) {
        String name = call.getString("name", "file");
        String mime = call.getString("mime", "application/octet-stream");
        String stage = call.getString("stage");
        Integer size = call.getInt("size");
        try {
            if (stage == null) {
                // caminho antigo: tudo em base64 na chamada; vira arquivo temporário para seguir o mesmo fluxo
                String b64 = call.getString("data");
                if (b64 == null) { call.reject("Missing data"); return; }
                byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
                stage = java.util.UUID.randomUUID().toString();
                try (FileOutputStream out = new FileOutputStream(NativeStage.fileFor(getContext(), stage))) { out.write(bytes); }
                size = bytes.length;
            }
            java.io.File f = NativeStage.fileFor(getContext(), stage);
            if (!f.exists()) { call.reject("Arquivo temporário não encontrado"); return; }
            if (size != null && f.length() != size.longValue()) { call.reject("Dados corrompidos na transferência (" + f.length() + " de " + size + " bytes)"); return; }
            if (f.length() == 0) { call.reject("Conteúdo vazio: nada foi gravado"); f.delete(); return; }
            prefs().edit().putString("stage", stage).putString("name", name).putLong("size", f.length()).apply();
        } catch (Exception e) { call.reject("Save failed: " + e.getMessage()); return; }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mime);
        intent.putExtra(Intent.EXTRA_TITLE, name);
        startActivityForResult(call, intent, "saveFileResult");
    }

    private void toastUi(final String msg) {
        new Handler(Looper.getMainLooper()).post(() -> android.widget.Toast.makeText(getContext(), msg, android.widget.Toast.LENGTH_LONG).show());
    }

    @ActivityCallback
    private void saveFileResult(PluginCall call, ActivityResult result) {
        android.content.SharedPreferences p = prefs();
        String stage = p.getString("stage", null);
        String wanted = p.getString("name", "file");
        long size = p.getLong("size", -1);
        p.edit().clear().apply();
        if (stage == null) {
            Log.e("BlockbenchNative", "saveFileResult sem preparo pendente");
            if (call != null) call.reject("Nada pendente para salvar");
            return;
        }
        java.io.File staged = null;
        try { staged = NativeStage.fileFor(getContext(), stage); } catch (Exception ignored) { /* id inválido */ }
        Intent data = result.getData();
        if (result.getResultCode() != android.app.Activity.RESULT_OK || data == null || data.getData() == null) {
            if (staged != null) staged.delete();
            if (call != null) { JSObject r = new JSObject(); r.put("cancelled", true); call.resolve(r); }
            return;
        }
        Uri uri = data.getData();
        try {
            if (staged == null || !staged.exists()) throw new IOException("o arquivo temporário sumiu");
            if (size >= 0 && staged.length() != size) throw new IOException("temporário com " + staged.length() + " de " + size + " bytes");
            long written = copyAndVerify(uri, staged);
            String shown = displayName(uri, wanted);
            staged.delete();
            if (call != null) {
                JSObject r = new JSObject();
                r.put("uri", uri.toString());
                r.put("name", shown);
                r.put("bytes", written);
                call.resolve(r);
            } else {
                toastUi("✔ " + shown + " (" + written + " bytes)");
            }
        } catch (Exception e) {
            if (call != null) call.reject("Save failed: " + e.getMessage());
            else toastUi("Save failed: " + e.getMessage());
        }
    }

    /** Copia o arquivo temporário para o destino e CONFERE o tamanho final; tenta outros modos se o provedor deixar incompleto. */
    private long copyAndVerify(Uri uri, java.io.File src) throws Exception {
        ContentResolver cr = getContext().getContentResolver();
        long total = src.length();
        Exception last = null;
        for (String mode : new String[] { "wt", "rwt", "w" }) {
            try {
                try (ParcelFileDescriptor pfd = cr.openFileDescriptor(uri, mode);
                     FileOutputStream os = new FileOutputStream(pfd.getFileDescriptor());
                     java.io.FileInputStream in = new java.io.FileInputStream(src)) {
                    byte[] buf = new byte[256 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
                    os.flush();
                    try { os.getFD().sync(); } catch (Exception ignored) { /* nem todo descritor aceita sync */ }
                }
                long len = sizeOf(cr, uri);
                if (len < 0 || len == total) return total;   // -1 = provedor não informa o tamanho
                last = new IOException("o provedor mostra " + len + " bytes em vez de " + total);
            } catch (Exception e) {
                last = e;
            }
        }
        throw last != null ? last : new IOException("não foi possível gravar o arquivo");
    }

    private long sizeOf(ContentResolver cr, Uri uri) {
        try (Cursor c = cr.query(uri, new String[] { OpenableColumns.SIZE }, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int i = c.getColumnIndex(OpenableColumns.SIZE);
                if (i >= 0 && !c.isNull(i)) return c.getLong(i);
            }
        } catch (Exception ignored) { /* tenta o descritor */ }
        try (ParcelFileDescriptor pfd = cr.openFileDescriptor(uri, "r")) {
            if (pfd != null) return pfd.getStatSize();
        } catch (Exception ignored) { /* sem tamanho */ }
        return -1;
    }

    private String displayName(Uri uri, String fallback) {
        try (Cursor c = getContext().getContentResolver().query(uri, null, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (i >= 0) return c.getString(i);
            }
        } catch (Exception ignored) {}
        return fallback;
    }

    // ---------- Keep-alive foreground service ----------
    @PluginMethod
    public void startKeepAlive(PluginCall call) {
        Context ctx = getContext();
        ContextCompat.startForegroundService(ctx, new Intent(ctx, KeepAliveService.class));
        call.resolve();
    }

    @PluginMethod
    public void stopKeepAlive(PluginCall call) {
        Context ctx = getContext();
        ctx.stopService(new Intent(ctx, KeepAliveService.class));
        call.resolve();
    }

    /** Modo tela cheia imersivo (esconde barras do sistema). Reaplicado em MainActivity ao recuperar o foco. */
    @PluginMethod
    public void setFullscreen(final PluginCall call) {
        final boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        final Activity activity = getActivity();
        if (activity == null) { call.reject("Sem Activity"); return; }
        MainActivity.fullscreen = enabled;
        activity.runOnUiThread(new Runnable() {
            @Override public void run() {
                MainActivity.applyWindowMode(activity);
                call.resolve();
            }
        });
    }

    /** Preencher a tela inteira: janela sem recuo (recorte da câmera e bordas incluídos). */
    @PluginMethod
    public void setFillScreen(final PluginCall call) {
        final boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        final Activity activity = getActivity();
        if (activity == null) { call.reject("Sem Activity"); return; }
        MainActivity.fillScreen = enabled;
        activity.runOnUiThread(new Runnable() {
            @Override public void run() {
                MainActivity.applyWindowMode(activity);
                call.resolve();
            }
        });
    }

    /** Forçar Encerramento: derruba o Keep Alive, fecha a tarefa e mata o processo. */
    @PluginMethod
    public void forceQuit(PluginCall call) {
        final Context ctx = getContext();
        final Activity activity = getActivity();
        ctx.stopService(new Intent(ctx, KeepAliveService.class));
        call.resolve();
        final Handler main = new Handler(Looper.getMainLooper());
        main.postDelayed(new Runnable() {
            @Override public void run() {
                if (activity != null) activity.finishAndRemoveTask();
                main.postDelayed(new Runnable() {
                    @Override public void run() {
                        android.os.Process.killProcess(android.os.Process.myPid());
                        System.exit(0);
                    }
                }, 300);
            }
        }, 150);
    }

    @PluginMethod
    public void requestBatteryExemption(PluginCall call) {
        Context ctx = getContext();
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        if (Build.VERSION.SDK_INT >= 23 && !pm.isIgnoringBatteryOptimizations(ctx.getPackageName())) {
            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            i.setData(Uri.parse("package:" + ctx.getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
        }
        call.resolve();
    }
}

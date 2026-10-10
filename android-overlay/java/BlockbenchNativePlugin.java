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
    @PluginMethod
    public void saveFile(PluginCall call) {
        String name = call.getString("name", "file");
        String mime = call.getString("mime", "application/octet-stream");
        if (call.getString("data") == null) {
            call.reject("Missing data");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mime);
        intent.putExtra(Intent.EXTRA_TITLE, name);
        startActivityForResult(call, intent, "saveFileResult");
    }

    @ActivityCallback
    private void saveFileResult(PluginCall call, ActivityResult result) {
        if (call == null) { Log.e("BlockbenchNative", "saveFileResult sem PluginCall: o arquivo escolhido ficou vazio"); return; }
        Intent data = result.getData();
        if (result.getResultCode() != android.app.Activity.RESULT_OK || data == null || data.getData() == null) {
            JSObject r = new JSObject();
            r.put("cancelled", true);
            call.resolve(r);
            return;
        }
        Uri uri = data.getData();
        String wanted = call.getString("name", "file");
        try {
            String b64 = call.getString("data");
            byte[] bytes = Base64.decode(b64 == null ? "" : b64, Base64.DEFAULT);
            Integer expected = call.getInt("size");
            if (expected != null && expected.intValue() != bytes.length) {
                call.reject("Dados corrompidos na transferência (" + bytes.length + " de " + expected + " bytes)");
                return;
            }
            if (bytes.length == 0) { call.reject("Conteúdo vazio: nada foi gravado"); return; }
            long written = writeAndVerify(uri, bytes);
            JSObject r = new JSObject();
            r.put("uri", uri.toString());
            r.put("name", displayName(uri, wanted));
            r.put("bytes", written);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Save failed: " + e.getMessage());
        }
    }

    /** Grava e CONFERE o tamanho final; tenta outros modos de abertura se o provedor deixar o arquivo vazio/incompleto. */
    private long writeAndVerify(Uri uri, byte[] bytes) throws Exception {
        ContentResolver cr = getContext().getContentResolver();
        Exception last = null;
        for (String mode : new String[] { "wt", "rwt", "w" }) {
            try {
                try (ParcelFileDescriptor pfd = cr.openFileDescriptor(uri, mode);
                     FileOutputStream os = new FileOutputStream(pfd.getFileDescriptor())) {
                    os.write(bytes);
                    os.flush();
                    try { os.getFD().sync(); } catch (Exception ignored) { /* nem todo descritor aceita sync */ }
                }
                long len = sizeOf(cr, uri);
                if (len < 0 || len == bytes.length) return bytes.length;   // -1 = provedor não informa o tamanho
                last = new IOException("o provedor mostra " + len + " bytes em vez de " + bytes.length);
            } catch (Exception e) {
                last = e;
            }
        }
        // última tentativa pelo caminho clássico
        try (OutputStream os = cr.openOutputStream(uri, "wt")) {
            if (os == null) throw new IOException("não foi possível abrir o arquivo para escrita");
            os.write(bytes);
            os.flush();
        }
        long len = sizeOf(cr, uri);
        if (len < 0 || len == bytes.length) return bytes.length;
        throw last != null ? last : new IOException("tamanho gravado " + len + " != " + bytes.length);
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

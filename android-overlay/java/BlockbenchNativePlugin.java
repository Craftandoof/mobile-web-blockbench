package com.craftandoof.blockbench;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import java.io.OutputStream;

@CapacitorPlugin(
    name = "BlockbenchNative",
    permissions = {
        @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications")
    }
)
public class BlockbenchNativePlugin extends Plugin {

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
        if (call == null) return;
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
            byte[] bytes = Base64.decode(call.getString("data"), Base64.DEFAULT);
            // "wt" = write + truncate, otherwise overwriting a larger file leaves trailing garbage
            try (OutputStream os = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                if (os == null) throw new Exception("Could not open output stream");
                os.write(bytes);
                os.flush();
            }
            String finalName = displayName(uri, wanted);
            // Some providers append an extension (e.g. ".bin"); try to restore the requested name.
            if (!finalName.equals(wanted)) {
                try {
                    Uri renamed = DocumentsContract.renameDocument(getContext().getContentResolver(), uri, wanted);
                    if (renamed != null) { uri = renamed; finalName = wanted; }
                } catch (Exception ignored) { /* keep provider's name */ }
            }
            JSObject r = new JSObject();
            r.put("uri", uri.toString());
            r.put("name", finalName);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Save failed: " + e.getMessage());
        }
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
                MainActivity.applyFullscreen(activity);
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

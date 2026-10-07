package com.craftandoof.blockbench;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Environment;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Acesso SÍNCRONO a arquivos para o JavaScript do WebView (window.BBNativeFs).
 * Contrato (ver js/android/node/fs.ts): toda resposta é uma String,
 * "O" + carga em caso de sucesso, ou "E:CODIGO:mensagem" em caso de erro. Dados binários em base64.
 * Só caminhos dentro das pastas do app, e do armazenamento compartilhado quando há "acesso a todos os arquivos".
 */
public class NativeFs {
    private static final long MAX_READ = 128L * 1024 * 1024;
    private final Context ctx;

    public NativeFs(Context context) { this.ctx = context.getApplicationContext(); }

    // ------------------------------------------------------------------ permissão / raízes

    public static boolean hasAllFilesAccess(Context c) {
        if (Build.VERSION.SDK_INT >= 30) return Environment.isExternalStorageManager();
        return c.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
            && c.checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
    }

    private List<String> allowedRoots() throws IOException {
        List<String> r = new ArrayList<>();
        r.add(ctx.getFilesDir().getCanonicalPath());
        r.add(ctx.getCacheDir().getCanonicalPath());
        File ext = ctx.getExternalFilesDir(null);
        if (ext != null) r.add(ext.getCanonicalPath());
        File extCache = ctx.getExternalCacheDir();
        if (extCache != null) r.add(extCache.getCanonicalPath());
        if (hasAllFilesAccess(ctx)) {
            r.add(Environment.getExternalStorageDirectory().getCanonicalPath());
            r.add("/storage");
        }
        return r;
    }

    private File resolve(String path) throws IOException {
        if (path == null || path.isEmpty() || path.indexOf('\0') >= 0 || path.charAt(0) != '/') throw new SecurityException("caminho inválido: " + path);
        File f = new File(path).getCanonicalFile();   // resolve "..", links simbólicos e /sdcard
        String c = f.getPath();
        for (String root : allowedRoots()) {
            if (c.equals(root) || c.startsWith(root.endsWith("/") ? root : root + "/")) return f;
        }
        throw new SecurityException("fora das pastas permitidas: " + c);
    }

    private static String err(String code, String msg) { return "E:" + code + ":" + (msg == null ? "" : msg); }

    private String fail(Throwable t) {
        if (t instanceof SecurityException) return err("EACCES", t.getMessage());
        return err("EIO", String.valueOf(t.getMessage()));
    }

    // ------------------------------------------------------------------ operações

    @JavascriptInterface
    public String roots() {
        try {
            JSONObject o = new JSONObject();
            File ext = Environment.getExternalStorageDirectory();
            o.put("external", ext.getCanonicalPath());
            o.put("files", ctx.getFilesDir().getCanonicalPath());
            o.put("cache", ctx.getCacheDir().getCanonicalPath());
            o.put("release", Build.VERSION.RELEASE);
            o.put("abi", Build.SUPPORTED_ABIS.length > 0 ? Build.SUPPORTED_ABIS[0] : "arm64-v8a");
            o.put("hasAll", hasAllFilesAccess(ctx));
            return "O" + o.toString();
        } catch (Throwable t) { return fail(t); }
    }

    @JavascriptInterface
    public String stat(String path) {
        try {
            File f = resolve(path);
            if (!f.exists()) return err("ENOENT", path);
            JSONObject o = new JSONObject();
            o.put("t", f.isDirectory() ? "d" : "f");
            o.put("s", f.length());
            o.put("m", f.lastModified());
            return "O" + o.toString();
        } catch (Throwable t) { return fail(t); }
    }

    @JavascriptInterface
    public String readFile(String path) {
        try {
            File f = resolve(path);
            if (!f.exists()) return err("ENOENT", path);
            if (f.isDirectory()) return err("EISDIR", path);
            if (f.length() > MAX_READ) return err("EIO", "arquivo grande demais para leitura síncrona (" + f.length() + " bytes)");
            try (InputStream in = new FileInputStream(f); ByteArrayOutputStream out = new ByteArrayOutputStream((int) Math.max(16, f.length()))) {
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                return "O" + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
            }
        } catch (Throwable t) { return fail(t); }
    }

    @JavascriptInterface
    public String writeFile(String path, String base64, String append) {
        try {
            File f = resolve(path);
            File parent = f.getParentFile();
            if (parent == null || !parent.exists()) return err("ENOENT", path);
            if (!parent.isDirectory()) return err("ENOTDIR", path);
            if (f.isDirectory()) return err("EISDIR", path);
            byte[] data = Base64.decode(base64 == null ? "" : base64, Base64.DEFAULT);
            try (OutputStream out = new FileOutputStream(f, "1".equals(append))) { out.write(data); }
            return "O";
        } catch (Throwable t) { return fail(t); }
    }

    @JavascriptInterface
    public String readdir(String path) {
        try {
            File f = resolve(path);
            if (!f.exists()) return err("ENOENT", path);
            if (!f.isDirectory()) return err("ENOTDIR", path);
            File[] list = f.listFiles();
            if (list == null) return err("EACCES", path);
            JSONArray arr = new JSONArray();
            for (File c : list) {
                JSONArray e = new JSONArray();
                e.put(c.getName());
                e.put(c.isDirectory() ? "d" : "f");
                arr.put(e);
            }
            return "O" + arr.toString();
        } catch (Throwable t) { return fail(t); }
    }

    @JavascriptInterface
    public String mkdir(String path, String recursive) {
        try {
            File f = resolve(path);
            boolean rec = "1".equals(recursive);
            if (f.exists()) return (rec && f.isDirectory()) ? "O" : err("EEXIST", path);
            File parent = f.getParentFile();
            if (!rec && (parent == null || !parent.exists())) return err("ENOENT", path);
            boolean ok = rec ? f.mkdirs() : f.mkdir();
            if (!ok && !f.isDirectory()) return err("EACCES", path);
            return "O";
        } catch (Throwable t) { return fail(t); }
    }

    private static boolean deleteTree(File f) {
        if (f.isDirectory()) {
            File[] kids = f.listFiles();
            if (kids != null) for (File k : kids) if (!deleteTree(k)) return false;
        }
        return f.delete();
    }

    @JavascriptInterface
    public String rm(String path, String recursive) {
        try {
            File f = resolve(path);
            if (!f.exists()) return err("ENOENT", path);
            if (f.isDirectory()) {
                if ("1".equals(recursive)) {
                    if (!deleteTree(f)) return err("EACCES", path);
                    return "O";
                }
                String[] kids = f.list();
                if (kids != null && kids.length > 0) return err("ENOTEMPTY", path);
            }
            if (!f.delete()) return err("EACCES", path);
            return "O";
        } catch (Throwable t) { return fail(t); }
    }

    private static void copyStream(File from, File to) throws IOException {
        try (InputStream in = new FileInputStream(from); OutputStream out = new FileOutputStream(to)) {
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        }
    }

    @JavascriptInterface
    public String rename(String from, String to) {
        try {
            File a = resolve(from), b = resolve(to);
            if (!a.exists()) return err("ENOENT", from);
            File parent = b.getParentFile();
            if (parent == null || !parent.exists()) return err("ENOENT", to);
            if (b.isDirectory()) {
                String[] kids = b.list();
                if (kids != null && kids.length > 0) return err("ENOTEMPTY", to);
            }
            if (a.renameTo(b)) return "O";
            if (a.isFile()) {   // outro volume: copiar e apagar
                copyStream(a, b);
                if (!a.delete()) return err("EACCES", from);
                return "O";
            }
            return err("EIO", "não foi possível mover a pasta");
        } catch (Throwable t) { return fail(t); }
    }

    @JavascriptInterface
    public String copyFile(String from, String to) {
        try {
            File a = resolve(from), b = resolve(to);
            if (!a.exists()) return err("ENOENT", from);
            if (a.isDirectory()) return err("EISDIR", from);
            File parent = b.getParentFile();
            if (parent == null || !parent.exists()) return err("ENOENT", to);
            if (b.isDirectory()) return err("EISDIR", to);
            copyStream(a, b);
            return "O";
        } catch (Throwable t) { return fail(t); }
    }

    @JavascriptInterface
    public String realpath(String path) {
        try {
            File f = resolve(path);
            if (!f.exists()) return err("ENOENT", path);
            return "O" + f.getPath();
        } catch (Throwable t) { return fail(t); }
    }
}

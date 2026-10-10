package com.craftandoof.blockbench;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Environment;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Executa o FFmpeg do "FFmpeg Plugin" do PojavLauncher (pacote net.kdt.pojavlaunch.ffmpeg), exposto ao JavaScript
 * como window.BBNativeProc. O plugin é um APK sem código cujo executável é libffmpeg.so dentro da pasta de
 * bibliotecas nativas dele (a mesma descoberta que o PojavLauncher faz em FFmpegPlugin.discover).
 *
 * Só o ffmpeg do plugin pode ser executado (o Android 10+ não deixa executar arquivos de pastas graváveis, e não
 * queremos que um plugin do Blockbench rode programas arbitrários). Contrato: respostas "O"+carga ou "E:CODIGO:msg".
 * Saída por polling: poll(id) devolve o que chegou desde a última chamada e o código de saída quando terminou.
 */
public class NativeProc {
    private static final String[] PACKAGES = { "net.kdt.pojavlaunch.ffmpeg" };
    private static final String EXECUTABLE = "libffmpeg.so";

    private final Context ctx;
    private final Map<Integer, Proc> procs = new ConcurrentHashMap<>();
    private final AtomicInteger nextId = new AtomicInteger(1);

    public NativeProc(Context context) { this.ctx = context.getApplicationContext(); }

    private static final class Proc {
        Process process;
        OutputStream stdin;
        final LinkedBlockingQueue<byte[]> inQueue = new LinkedBlockingQueue<>();
        final ByteArrayOutputStream out = new ByteArrayOutputStream();
        final ByteArrayOutputStream err = new ByteArrayOutputStream();
        volatile Integer exit = null;
    }

    private static final byte[] EOF = new byte[0];

    private static String err(String code, String msg) { return "E:" + code + ":" + (msg == null ? "" : msg); }

    // ------------------------------------------------------------------ descoberta

    private JSONObject discover() {
        JSONObject o = new JSONObject();
        try {
            PackageManager pm = ctx.getPackageManager();
            for (String pkg : PACKAGES) {
                try {
                    @SuppressWarnings("deprecation")
                    PackageInfo info = pm.getPackageInfo(pkg, PackageManager.GET_SHARED_LIBRARY_FILES);
                    String lib = info.applicationInfo.nativeLibraryDir;
                    File exe = new File(lib, EXECUTABLE);
                    if (exe.exists()) {
                        o.put("found", true);
                        o.put("path", exe.getAbsolutePath());
                        o.put("libraryPath", lib);
                        o.put("package", pkg);
                        o.put("version", info.versionName == null ? "" : info.versionName);
                        return o;
                    }
                } catch (PackageManager.NameNotFoundException ignored) { /* tenta o próximo */ }
            }
            o.put("found", false);
        } catch (Exception e) {
            try { o.put("found", false); o.put("error", String.valueOf(e.getMessage())); } catch (Exception ignored) { }
        }
        return o;
    }

    @JavascriptInterface
    public String findFfmpeg() { return "O" + discover().toString(); }

    /** Pasta onde o ffmpeg grava quando o plugin passa só o nome do arquivo de saída. */
    private File outputDir() {
        File dir = null;
        if (NativeFs.hasAllFilesAccess(ctx)) dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "Blockbench");
        if (dir == null || (!dir.exists() && !dir.mkdirs())) {
            File ext = ctx.getExternalFilesDir("recordings");
            dir = ext != null ? ext : new File(ctx.getFilesDir(), "recordings");
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
        }
        return dir;
    }

    @JavascriptInterface
    public String outputDir(String unused) { return "O" + outputDir().getAbsolutePath(); }

    // ------------------------------------------------------------------ execução

    private static void pump(final InputStream in, final ByteArrayOutputStream sink) {
        Thread t = new Thread(new Runnable() {
            @Override public void run() {
                byte[] buf = new byte[16384];
                try {
                    int n;
                    while ((n = in.read(buf)) > 0) synchronized (sink) { sink.write(buf, 0, n); }
                } catch (IOException ignored) { /* processo terminou */ }
            }
        }, "bb-proc-pump");
        t.setDaemon(true);
        t.start();
    }

    @JavascriptInterface
    public String start(String json) {
        try {
            JSONObject req = new JSONObject(json);
            String cmd = req.getString("cmd");
            String base = new File(cmd).getName();
            if (!("ffmpeg".equals(base) || "ffmpeg.exe".equals(base) || EXECUTABLE.equals(base))) {
                return err("ENOENT", "só o ffmpeg do plugin do Pojav pode ser executado: " + cmd);
            }
            JSONObject d = discover();
            if (!d.optBoolean("found")) return err("ENOENT", "FFmpeg Plugin do PojavLauncher não está instalado");

            List<String> command = new ArrayList<>();
            command.add(d.getString("path"));
            JSONArray args = req.optJSONArray("args");
            if (args != null) for (int i = 0; i < args.length(); i++) command.add(String.valueOf(args.get(i)));

            ProcessBuilder pb = new ProcessBuilder(command);
            Map<String, String> env = pb.environment();
            String ld = env.get("LD_LIBRARY_PATH");
            env.put("LD_LIBRARY_PATH", d.getString("libraryPath") + (ld == null || ld.isEmpty() ? "" : ":" + ld));
            env.put("TMPDIR", ctx.getCacheDir().getAbsolutePath());
            String cwd = req.optString("cwd", "");
            File dir = cwd.isEmpty() ? outputDir() : new File(cwd);
            if (!dir.isDirectory()) dir = outputDir();
            pb.directory(dir);

            final Proc p = new Proc();
            p.process = pb.start();
            p.stdin = p.process.getOutputStream();
            final int id = nextId.getAndIncrement();
            procs.put(id, p);

            pump(p.process.getInputStream(), p.out);
            pump(p.process.getErrorStream(), p.err);

            // escritor do stdin: write() só enfileira (não trava a thread do JavaScript)
            Thread w = new Thread(new Runnable() {
                @Override public void run() {
                    try {
                        while (true) {
                            byte[] chunk = p.inQueue.take();
                            if (chunk == EOF) break;
                            p.stdin.write(chunk);
                        }
                        p.stdin.flush();
                    } catch (Exception ignored) { /* ffmpeg fechou o stdin */ }
                    try { p.stdin.close(); } catch (Exception ignored) { }
                }
            }, "bb-proc-stdin");
            w.setDaemon(true);
            w.start();

            Thread waiter = new Thread(new Runnable() {
                @Override public void run() {
                    int code = -1;
                    try { code = p.process.waitFor(); } catch (InterruptedException ignored) { }
                    try { Thread.sleep(80); } catch (InterruptedException ignored) { }   // deixa os pumps esvaziarem
                    p.exit = code;
                }
            }, "bb-proc-wait");
            waiter.setDaemon(true);
            waiter.start();

            JSONObject r = new JSONObject();
            r.put("id", id);
            r.put("cwd", dir.getAbsolutePath());
            return "O" + r.toString();
        } catch (IOException e) {
            String m = String.valueOf(e.getMessage());
            return err(m.contains("error=13") ? "EACCES" : m.contains("error=2") ? "ENOENT" : "EIO", m);
        } catch (Exception e) {
            return err("EIO", String.valueOf(e.getMessage()));
        }
    }

    private Proc get(String id) { try { return procs.get(Integer.parseInt(id)); } catch (Exception e) { return null; } }

    @JavascriptInterface
    public String write(String id, String base64) {
        Proc p = get(id);
        if (p == null) return err("ENOENT", "processo inexistente");
        try { p.inQueue.put(Base64.decode(base64, Base64.DEFAULT)); return "O"; }
        catch (Exception e) { return err("EIO", String.valueOf(e.getMessage())); }
    }

    @JavascriptInterface
    public String closeStdin(String id) {
        Proc p = get(id);
        if (p == null) return err("ENOENT", "processo inexistente");
        p.inQueue.offer(EOF);
        return "O";
    }

    @JavascriptInterface
    public String poll(String id) {
        Proc p = get(id);
        if (p == null) return err("ENOENT", "processo inexistente");
        try {
            byte[] o, e;
            synchronized (p.out) { o = p.out.toByteArray(); p.out.reset(); }
            synchronized (p.err) { e = p.err.toByteArray(); p.err.reset(); }
            Integer exit = p.exit;
            JSONObject r = new JSONObject();
            r.put("o", Base64.encodeToString(o, Base64.NO_WRAP));
            r.put("e", Base64.encodeToString(e, Base64.NO_WRAP));
            r.put("x", exit == null ? JSONObject.NULL : exit);
            if (exit != null) {
                // só descarta depois de entregar tudo: se ainda chegou saída, o próximo poll leva o resto
                synchronized (p.out) { if (p.out.size() == 0) { synchronized (p.err) { if (p.err.size() == 0) procs.remove(Integer.parseInt(id)); } } }
            }
            return "O" + r.toString();
        } catch (Exception ex) {
            return err("EIO", String.valueOf(ex.getMessage()));
        }
    }

    @JavascriptInterface
    public String kill(String id) {
        Proc p = get(id);
        if (p == null) return "O";
        p.process.destroyForcibly();
        p.inQueue.offer(EOF);
        return "O";
    }
}

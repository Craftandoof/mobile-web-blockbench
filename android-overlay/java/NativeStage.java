package com.craftandoof.blockbench;

import android.content.Context;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.UUID;

/**
 * Área de preparo para salvar arquivos grandes (window.BBNativeStage).
 * O JavaScript entrega o arquivo em pedaços pequenos, direto para um arquivo temporário do app,
 * em vez de mandar tudo de uma vez (base64 de vários MB) pela ponte do Capacitor.
 * Assim o salvamento termina mesmo se o Android recriar a tela enquanto o seletor de arquivos está aberto.
 * Respostas: "O"+carga ou "E:CODIGO:mensagem".
 */
public class NativeStage {
    private final Context ctx;

    public NativeStage(Context c) { ctx = c.getApplicationContext(); }

    static File dir(Context c) {
        File d = new File(c.getCacheDir(), "bb-stage");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    static File fileFor(Context c, String id) {
        if (id == null || !id.matches("[A-Za-z0-9-]{8,64}")) throw new SecurityException("id inválido");
        return new File(dir(c), id + ".bin");
    }

    /** Apaga preparos esquecidos (mais de 2 h), exceto o indicado. */
    static void sweep(Context c, String keepId) {
        try {
            File[] l = dir(c).listFiles();
            if (l == null) return;
            long limit = System.currentTimeMillis() - 2L * 3600 * 1000;
            for (File f : l) {
                if (keepId != null && f.getName().equals(keepId + ".bin")) continue;
                if (f.lastModified() < limit) f.delete();
            }
        } catch (Throwable ignored) { /* limpeza é opcional */ }
    }

    @JavascriptInterface
    public String begin() {
        try {
            sweep(ctx, null);
            String id = UUID.randomUUID().toString();
            File f = fileFor(ctx, id);
            if (!f.createNewFile() && !f.exists()) return "E:EIO:não foi possível criar o arquivo temporário";
            return "O" + id;
        } catch (Throwable t) { return "E:EIO:" + t.getMessage(); }
    }

    /** Anexa um pedaço em base64. Devolve o tamanho total até agora. */
    @JavascriptInterface
    public String append(String id, String base64) {
        try {
            File f = fileFor(ctx, id);
            byte[] data = Base64.decode(base64 == null ? "" : base64, Base64.DEFAULT);
            try (FileOutputStream out = new FileOutputStream(f, true)) { out.write(data); }
            return "O" + f.length();
        } catch (Throwable t) { return "E:EIO:" + t.getMessage(); }
    }

    @JavascriptInterface
    public String size(String id) {
        try { return "O" + fileFor(ctx, id).length(); } catch (Throwable t) { return "E:EIO:" + t.getMessage(); }
    }

    @JavascriptInterface
    public String discard(String id) {
        try { fileFor(ctx, id).delete(); return "O"; } catch (Throwable t) { return "E:EIO:" + t.getMessage(); }
    }
}

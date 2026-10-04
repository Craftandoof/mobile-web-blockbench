package com.craftandoof.blockbench;

import android.content.Intent;
import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import android.view.Window;
import android.view.WindowManager;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    /** Preferência de tela cheia, definida pelo JS (BlockbenchNativePlugin.setFullscreen). */
    public static volatile boolean fullscreen = false;

    /** Esconde/mostra as barras do sistema conforme {@link #fullscreen}. Chamar na thread da UI. */
    public static void applyFullscreen(Activity activity) {
        Window w = activity.getWindow();
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(w, w.getDecorView());
        if (c == null) return;
        if (fullscreen) {
            c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            c.hide(WindowInsetsCompat.Type.systemBars());
        } else {
            c.show(WindowInsetsCompat.Type.systemBars());
        }
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = w.getAttributes();
            lp.layoutInDisplayCutoutMode = fullscreen
                ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_DEFAULT;
            w.setAttributes(lp);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // o Android pode mostrar as barras de novo (diálogos, multitarefa): reaplica
        if (hasFocus && fullscreen) applyFullscreen(this);
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BlockbenchNativePlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onPause() {
        super.onPause();
        // Keep JS timers (auto-backup loop etc.) running while backgrounded. Verify on device.
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().resumeTimers();
        }
    }

    @Override
    public void onDestroy() {
        // Fechou de verdade (voltar / finish / remover dos recentes) => derruba o Keep Alive.
        // Rotação e outras recriações têm isFinishing() == false e mantêm o serviço.
        if (isFinishing()) {
            stopService(new Intent(this, KeepAliveService.class));
        }
        super.onDestroy();
    }
}

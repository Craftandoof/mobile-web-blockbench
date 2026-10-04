package com.craftandoof.blockbench;

import android.content.Intent;
import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebSettings;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    /** Tela cheia imersiva (BlockbenchNativePlugin.setFullscreen). */
    public static volatile boolean fullscreen = false;
    /** Preencher a tela inteira, incluindo recorte da câmera (BlockbenchNativePlugin.setFillScreen). */
    public static volatile boolean fillScreen = false;
    private static boolean windowModeTouched = false;

    /** Aplica tela cheia e "preencher a tela" à janela. Chamar na thread da UI. */
    public static void applyWindowMode(Activity activity) {
        Window w = activity.getWindow();
        View decor = w.getDecorView();

        // barras do sistema
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(w, decor);
        if (c != null) {
            if (fullscreen) {
                c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                c.hide(WindowInsetsCompat.Type.systemBars());
            } else if (windowModeTouched) {
                c.show(WindowInsetsCompat.Type.systemBars());
            }
        }

        // recorte da câmera: desenhar nele em tela cheia ou ao preencher
        if (Build.VERSION.SDK_INT >= 28 && (fullscreen || fillScreen || windowModeTouched)) {
            WindowManager.LayoutParams lp = w.getAttributes();
            if (fullscreen || fillScreen) {
                lp.layoutInDisplayCutoutMode = Build.VERSION.SDK_INT >= 30
                    ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                    : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            } else {
                lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_DEFAULT;
            }
            w.setAttributes(lp);
        }

        // sem recuo do sistema: o conteúdo ocupa a janela toda; só as barras VISÍVEIS (não o recorte) viram padding
        if (fillScreen) {
            WindowCompat.setDecorFitsSystemWindows(w, false);
            ViewCompat.setOnApplyWindowInsetsListener(decor, (v, insets) -> {
                Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
                View content = v.findViewById(android.R.id.content);
                if (content != null) content.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return insets;
            });
            windowModeTouched = true;
        } else if (windowModeTouched) {
            WindowCompat.setDecorFitsSystemWindows(w, true);
            ViewCompat.setOnApplyWindowInsetsListener(decor, null);
            View content = decor.findViewById(android.R.id.content);
            if (content != null) content.setPadding(0, 0, 0, 0);
        }
        if (fullscreen) windowModeTouched = true;
        ViewCompat.requestApplyInsets(decor);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // o Android pode mostrar as barras de novo (diálogos, multitarefa): reaplica
        if (hasFocus && (fullscreen || fillScreen)) applyWindowMode(this);
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BlockbenchNativePlugin.class);
        super.onCreate(savedInstanceState);
        // O zoom de pinça do WebView transformava "um dedo no botão + um dedo na tela" em zoom da página.
        try {
            WebSettings ws = getBridge().getWebView().getSettings();
            ws.setSupportZoom(false);
            ws.setBuiltInZoomControls(false);
            ws.setDisplayZoomControls(false);
        } catch (Exception ignored) { /* WebView indisponível */ }
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

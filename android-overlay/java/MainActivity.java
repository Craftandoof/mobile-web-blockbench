package com.craftandoof.blockbench;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
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

package com.craftandoof.blockbench;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;

/** Foreground service whose only job is to keep the app process at high priority. */
public class KeepAliveService extends Service {
    private static final String CHANNEL_ID = "bb_keepalive";
    private static final int NOTIFICATION_ID = 1001;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        createChannel();
        Intent open = new Intent(this, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(
            this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        Notification n = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Blockbench")
            .setContentText(sessionText())
            .setSmallIcon(android.R.drawable.ic_menu_edit)
            .setOngoing(true)
            .setContentIntent(pi)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();

        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(NOTIFICATION_ID, n);
        }
        // Não ressuscitar sozinho: se o processo morrer, o serviço morre junto.
        return START_NOT_STICKY;
    }

    /** Texto da notificação no idioma do sistema (inglês por padrão). */
    private static String sessionText() {
        String l = java.util.Locale.getDefault().getLanguage();
        if ("pt".equals(l)) return "Sessão ativa em segundo plano";
        if ("es".equals(l)) return "Sesión activa en segundo plano";
        if ("ru".equals(l)) return "Сеанс работает в фоне";
        if ("zh".equals(l)) return "会话正在后台运行";
        return "Session active in the background";
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID, sessionText(), NotificationManager.IMPORTANCE_LOW);
            getSystemService(NotificationManager.class).createNotificationChannel(ch);
        }
    }

    /** App removido dos recentes (deslizar para fechar): encerra o serviço e some a notificação. */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        shutdown();
        super.onTaskRemoved(rootIntent);
    }

    private void shutdown() {
        stopForeground(true);
        stopSelf();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}

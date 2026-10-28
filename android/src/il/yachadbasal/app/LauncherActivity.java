package il.yachadbasal.app;

import android.app.Activity;
import android.content.ComponentName;
import android.content.Intent;
import android.content.ServiceConnection;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Binder;
import android.os.Bundle;
import android.os.IBinder;
import android.os.Parcel;
import android.os.RemoteException;
import java.util.List;

/**
 * Opens the web app as a Trusted Web Activity: full screen in Chrome, with the site's push notifications working.
 * Talks the Custom Tabs protocol directly (two Binder calls), so the APK needs no support libraries.
 * Chrome verifies the app against https://SITE_HOST/.well-known/assetlinks.json; if that fails it shows a URL bar.
 */
public class LauncherActivity extends Activity {
    private static final String SERVICE_ACTION = "android.support.customtabs.action.CustomTabsService";
    private static final String SERVICE_DESCRIPTOR = "android.support.customtabs.ICustomTabsService";
    private static final String CALLBACK_DESCRIPTOR = "android.support.customtabs.ICustomTabsCallback";
    private static final int TX_WARMUP = IBinder.FIRST_CALL_TRANSACTION;          // warmup(long)
    private static final int TX_NEW_SESSION = IBinder.FIRST_CALL_TRANSACTION + 1; // newSession(ICustomTabsCallback)
    private static final String[] PREFERRED = {
        "com.android.chrome", "com.chrome.beta", "com.chrome.dev", "com.google.android.apps.chrome",
        "com.microsoft.emmx", "com.sec.android.app.sbrowser", "org.mozilla.firefox"
    };
    private static final int THEME_COLOR = 0xFF2E6B45;

    /** Session token we hand to the browser. It ignores navigation callbacks. */
    private final Binder callback = new Binder() {
        { attachInterface(null, CALLBACK_DESCRIPTOR); }
        @Override protected boolean onTransact(int code, Parcel data, Parcel reply, int flags) throws RemoteException {
            if (code == INTERFACE_TRANSACTION) return super.onTransact(code, data, reply, flags);
            if (reply != null) reply.writeNoException();
            return true;
        }
    };

    private ServiceConnection connection;
    private boolean launched;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        final Uri url = targetUrl();
        final String browser = pickBrowser();
        if (browser == null) { openPlain(url); return; }

        connection = new ServiceConnection() {
            @Override public void onServiceConnected(ComponentName name, IBinder service) {
                boolean session = call(service, TX_WARMUP, null) && call(service, TX_NEW_SESSION, callback);
                if (session) launchTrusted(browser, url); else openPlain(url);
            }
            @Override public void onServiceDisconnected(ComponentName name) { }
        };
        Intent bind = new Intent(SERVICE_ACTION).setPackage(browser);
        if (!bindService(bind, connection, BIND_AUTO_CREATE | BIND_WAIVE_PRIORITY)) { connection = null; openPlain(url); }
    }

    private Uri targetUrl() {
        Uri data = getIntent().getData();
        if (data != null && BuildConfig.SITE_HOST.equals(data.getHost())) return data;
        return Uri.parse("https://" + BuildConfig.SITE_HOST + "/");
    }

    private String pickBrowser() {
        PackageManager pm = getPackageManager();
        List<ResolveInfo> services = pm.queryIntentServices(new Intent(SERVICE_ACTION), 0);
        for (String p : PREFERRED) for (ResolveInfo r : services) if (p.equals(r.serviceInfo.packageName)) return p;
        return services.isEmpty() ? null : services.get(0).serviceInfo.packageName;
    }

    private static boolean call(IBinder service, int code, IBinder cb) {
        Parcel data = Parcel.obtain(), reply = Parcel.obtain();
        try {
            data.writeInterfaceToken(SERVICE_DESCRIPTOR);
            if (code == TX_WARMUP) data.writeLong(0); else data.writeStrongBinder(cb);
            service.transact(code, data, reply, 0);
            reply.readException();
            return reply.readInt() != 0;
        } catch (Exception e) {
            return false;
        } finally { data.recycle(); reply.recycle(); }
    }

    private void launchTrusted(String browser, Uri url) {
        if (launched) return;
        launched = true;
        Intent i = new Intent(Intent.ACTION_VIEW, url).setPackage(browser);
        Bundle extras = new Bundle();
        extras.putBinder("android.support.customtabs.extra.SESSION", callback);
        i.putExtras(extras);
        i.putExtra("android.support.customtabs.extra.LAUNCH_AS_TRUSTED_WEB_ACTIVITY", true);
        i.putExtra("android.support.customtabs.extra.TOOLBAR_COLOR", THEME_COLOR);
        i.putExtra("androidx.browser.customtabs.extra.NAVIGATION_BAR_COLOR", THEME_COLOR);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(i);
        finish();
    }

    private void openPlain(Uri url) {
        if (launched) return;
        launched = true;
        startActivity(new Intent(Intent.ACTION_VIEW, url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        finish();
    }

    @Override
    protected void onDestroy() {
        if (connection != null) { try { unbindService(connection); } catch (IllegalArgumentException ignored) { } }
        super.onDestroy();
    }
}

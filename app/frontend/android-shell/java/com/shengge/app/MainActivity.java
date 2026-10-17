package com.shengge.app;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.ValueCallback;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.net.http.SslError;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

/**
 * 「生格」WebView 壳（内测真机用）。
 * 加载顺序：局域网 TLS(192.168.1.5:8103) → USB 反代(127.0.0.1:8103)。
 * 仅限测试包：放行自签证书；正式包必须改为受信证书并移除 proceed()。
 */
public class MainActivity extends Activity {

    private static final String[] URLS = {
            "https://192.168.1.5:8103/",
            "https://127.0.0.1:8103/"
    };

    private WebView web;
    private int attempt = 0;
    private boolean loaded = false;
    private OnBackInvokedCallback backCallback; // Android 13+ 手势返回（预测性返回）

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window w = getWindow();
        w.setStatusBarColor(Color.parseColor("#F7F5F0"));
        w.setNavigationBarColor(Color.parseColor("#F7F5F0"));
        w.setBackgroundDrawable(new ColorDrawable(Color.parseColor("#F7F5F0")));
        applyInsets();
        setupBackHandling();
        web = new WebView(this);
        WebView.setWebContentsDebuggingEnabled(true); // 内测包：允许 CDP 远程调试
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        web.setBackgroundColor(Color.parseColor("#F7F5F0"));

        web.setWebViewClient(new WebViewClient() {
            // 测试专用：自签证书放行（正式包须替换为受信 CA 并删除此方法）
            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.proceed();
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (!url.startsWith("about:")) loaded = true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame() && !loaded) tryNext();
            }
        });

        setContentView(web);
        loadCurrent();
    }

    /**
     * 系统返回统一入口（全面屏手势 + 传统返回键）。
     * 先问前端 __sgOnSystemBack()：返回 true = 前端已消费（关闭浮层/返回上一级页面）；
     * false = 一级 Tab 首页，才放行退出（WebView 无历史则 finish）。
     */
    private void handleSystemBack() {
        if (web == null) { finish(); return; }
        web.evaluateJavascript(
                "(function(){try{return (typeof window.__sgOnSystemBack==='function' && window.__sgOnSystemBack())?'1':'0';}catch(e){return '0';}})()",
                new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String value) {
                        boolean consumed = "\"1\"".equals(value) || "1".equals(value);
                        if (consumed) return;
                        if (web.canGoBack()) { web.goBack(); return; }
                        runOnUiThread(new Runnable() { @Override public void run() { finish(); } });
                    }
                });
    }

    /** Android 13+ 预测性手势返回注册；低版本走 onBackPressed 传统路径 */
    private void setupBackHandling() {
        if (Build.VERSION.SDK_INT >= 33) {
            backCallback = new OnBackInvokedCallback() {
                @Override public void onBackInvoked() { handleSystemBack(); }
            };
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, backCallback);
        }
    }

    @Override
    public void onBackPressed() { // <33 传统返回键；33+ 由 OnBackInvokedCallback 接管
        if (Build.VERSION.SDK_INT >= 33) { super.onBackPressed(); return; }
        handleSystemBack();
    }

    @Override
    protected void onDestroy() {
        if (Build.VERSION.SDK_INT >= 33 && backCallback != null) {
            getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backCallback);
            backCallback = null;
        }
        super.onDestroy();
    }

    /**
     * 全面屏适配：Android 15+（targetSdk 35）强制 edge-to-edge，内容默认会画进
     * 状态栏/手势条/刘海区域。这里把系统栏+刘海 inset 转成根视图 padding，
     * 保证 App 内容在任何机型（含刘海屏、异形屏）上都不被系统栏遮挡或出框。
     */
    private void applyInsets() {
        final View decor = getWindow().getDecorView();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            decor.setOnApplyWindowInsetsListener((v, insets) -> {
                android.graphics.Insets bars = insets.getInsets(
                        WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                boolean changed = v.getPaddingTop() != bars.top || v.getPaddingBottom() != bars.bottom
                        || v.getPaddingLeft() != bars.left || v.getPaddingRight() != bars.right;
                if (changed) v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return WindowInsets.CONSUMED;
            });
        } else {
            // Android 10 及以下：传统 fitsSystemWindows 路径
            decor.setFitsSystemWindows(true);
        }
    }

    private void loadCurrent() {
        if (attempt < URLS.length) {
            web.loadUrl(URLS[attempt]);
        } else {
            showOfflineTip();
        }
    }

    private void tryNext() {
        attempt++;
        loadCurrent();
    }

    private void showOfflineTip() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(android.view.Gravity.CENTER);
        box.setBackgroundColor(Color.parseColor("#F7F5F0"));
        TextView t1 = new TextView(this);
        t1.setText("「生格」无法连接服务");
        t1.setTextSize(20);
        t1.setTextColor(Color.parseColor("#3D4A3E"));
        t1.setGravity(android.view.Gravity.CENTER);
        TextView t2 = new TextView(this);
        t2.setText("请确认电脑端服务已启动：\n"
                + "① 同一 Wi-Fi：电脑服务地址 https://192.168.1.5:8103\n"
                + "② USB 连接：adb reverse tcp:8103 tcp:8103\n\n"
                + "点击屏幕重试");
        t2.setTextSize(14);
        t2.setTextColor(Color.parseColor("#8A938A"));
        t2.setGravity(android.view.Gravity.CENTER);
        t2.setPadding(40, 40, 40, 40);
        box.addView(t1);
        box.addView(t2);
        box.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { attempt = 0; loaded = false; setContentView(web); loadCurrent(); }
        });
        setContentView(box);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && web.canGoBack()) {
            web.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }
}

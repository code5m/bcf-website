package com.code5m.tongpin;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.Menu;
import android.view.MenuItem;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.EditText;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.Toast;

import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;

public final class MainActivity extends Activity {
    private static final String OFFLINE = "https://appassets.androidplatform.net/tongpin/index.html";
    private static final int CHOOSE_FILE = 42;
    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private String remoteOrigin;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags
            & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        final WebViewAssetLoader assets = new WebViewAssetLoader.Builder()
            .addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        webView.setWebViewClient(new WebViewClientCompat() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assets.shouldInterceptRequest(request.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri target = request.getUrl();
                String origin = target.getScheme() + "://" + target.getAuthority();
                if ("https://appassets.androidplatform.net".equals(origin)
                    || (remoteOrigin != null && remoteOrigin.equals(origin))) return false;
                if (!"https".equals(target.getScheme())) return true;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, target));
                } catch (Exception ignored) {
                    Toast.makeText(MainActivity.this, "无法打开链接", Toast.LENGTH_SHORT).show();
                }
                return true;
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                                        FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), CHOOSE_FILE);
                    return true;
                } catch (Exception error) {
                    fileCallback = null;
                    callback.onReceiveValue(null);
                    return false;
                }
            }
        });
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        Button connect = new Button(this);
        connect.setText("连接 HTTPS 社交服务");
        connect.setOnClickListener(v -> connectServer());
        Button offline = new Button(this);
        offline.setText("离线私人收藏");
        offline.setOnClickListener(v -> openOffline());
        header.addView(connect, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 2));
        header.addView(offline, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        root.addView(header);
        root.addView(webView, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(root);
        String origin = getPreferences(MODE_PRIVATE).getString("server", "");
        if (!origin.isEmpty()) {
            remoteOrigin = origin;
            webView.loadUrl(origin + "/tongpin/");
        } else {
            webView.loadUrl(OFFLINE);
        }
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == CHOOSE_FILE && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            fileCallback = null;
        }
    }

    @Override public boolean onCreateOptionsMenu(Menu menu) {
        menu.add(0, 1, 0, "连接 HTTPS 同频服务");
        menu.add(0, 2, 1, "返回离线私人收藏");
        return true;
    }

    @Override public boolean onOptionsItemSelected(MenuItem item) {
        if (item.getItemId() == 2) { openOffline(); return true; }
        if (item.getItemId() == 1) { connectServer(); return true; }
        return super.onOptionsItemSelected(item);
    }
    private void openOffline() {
        remoteOrigin = null;
        getPreferences(MODE_PRIVATE).edit().remove("server").apply();
        webView.loadUrl(OFFLINE);
    }
    private void connectServer() {
            EditText input = new EditText(this);
            input.setSingleLine(true);
            input.setText(remoteOrigin == null ? "" : remoteOrigin);
            input.setHint("https://example.com");
            new AlertDialog.Builder(this)
                .setTitle("连接你信任的同频服务")
                .setMessage("切换服务器会切换本地收藏存储来源。请先在旧来源导出备份。只允许 HTTPS。")
                .setView(input)
                .setNegativeButton("取消", (dialog, which) -> {})
                .setPositiveButton("连接", (dialog, which) -> {
                    try {
                        Uri uri = Uri.parse(input.getText().toString().trim());
                        if (!"https".equals(uri.getScheme()) || uri.getHost() == null
                            || uri.getUserInfo() != null || uri.getPort() < -1) {
                            throw new IllegalArgumentException("invalid_https_url");
                        }
                        remoteOrigin = "https://" + uri.getAuthority();
                        getPreferences(MODE_PRIVATE).edit().putString("server", remoteOrigin).apply();
                        webView.loadUrl(remoteOrigin + "/tongpin/");
                    } catch (Exception e) {
                        Toast.makeText(this, "请输入有效 HTTPS 域名", Toast.LENGTH_LONG).show();
                    }
                }).show();
    }
    @Override public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }
    @Override protected void onDestroy() {
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}

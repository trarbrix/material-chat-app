package app.materialchat.variantb;

import android.app.Activity;
import android.Manifest;
import android.content.pm.PackageManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.IOException;
import java.util.ArrayList;

public final class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String APP_URL = "https://" + HOST + "/index.html";
    private static final int FILE_REQUEST = 412;
    private static final int MEDIA_REQUEST = 413;
    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest mediaRequest;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        webView = new WebView(this);
        setContentView(webView);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true); // Android's document picker returns content URIs.
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        webView.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("https".equals(uri.getScheme()) && HOST.equals(uri.getHost())
                        && "/index.html".equals(uri.getPath())) {
                    try { return new WebResourceResponse("text/html", "UTF-8", getAssets().open("variant-b.html")); }
                    catch (IOException e) { return new WebResourceResponse("text/plain", "UTF-8", 404, "Not found", null, null); }
                }
                // Do not let other paths on the reserved origin reach the network.
                if (HOST.equals(uri.getHost())) {
                    return new WebResourceResponse("text/plain", "UTF-8", 404, "Not found", null, null);
                }
                return null;
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                Uri uri = request.getUrl();
                if (APP_URL.equals(uri.toString())) return false;
                String scheme = uri.getScheme();
                if ("https".equals(scheme) || "mailto".equals(scheme) || "tel".equals(scheme) || "tg".equals(scheme)) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
                    catch (ActivityNotFoundException ignored) { }
                }
                return true;
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) {
                Uri origin = request.getOrigin();
                if (mediaRequest != null || !"https".equals(origin.getScheme()) || !HOST.equals(origin.getHost()) || (origin.getPort() != -1 && origin.getPort() != 443)) {
                    request.deny(); return;
                }
                ArrayList<String> needed = new ArrayList<>();
                for (String resource : request.getResources()) {
                    String permission;
                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) permission = Manifest.permission.RECORD_AUDIO;
                    else if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) permission = Manifest.permission.CAMERA;
                    else { request.deny(); return; }
                    if (checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED && !needed.contains(permission)) needed.add(permission);
                }
                if (request.getResources().length == 0) { request.deny(); return; }
                if (needed.isEmpty()) { request.grant(request.getResources()); return; }
                mediaRequest = request;
                requestPermissions(needed.toArray(new String[0]), MEDIA_REQUEST);
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) {
                if (mediaRequest == request) mediaRequest = null;
            }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try { startActivityForResult(params.createIntent(), FILE_REQUEST); }
                catch (ActivityNotFoundException e) { fileCallback = null; callback.onReceiveValue(null); }
                return true;
            }
        });
        webView.loadUrl(APP_URL);
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != MEDIA_REQUEST || mediaRequest == null) return;
        PermissionRequest request = mediaRequest; mediaRequest = null;
        boolean granted = grantResults.length > 0;
        for (int result : grantResults) if (result != PackageManager.PERMISSION_GRANTED) granted = false;
        if (granted) request.grant(request.getResources()); else request.deny();
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_REQUEST || fileCallback == null) return;
        Uri[] result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
        ArrayList<Uri> safe = new ArrayList<>();
        if (result != null) for (Uri uri : result) if (uri != null && "content".equals(uri.getScheme())) safe.add(uri);
        fileCallback.onReceiveValue(safe.isEmpty() ? null : safe.toArray(new Uri[0]));
        fileCallback = null;
    }

    @Override public void onBackPressed() {
        // Close overlays and step back through the mobile panes before leaving the app.
        String js = "(function(){var x=document.querySelector('.vb-modal-close');" +
                "if(x){x.click();return true;}x=document.querySelector('.vb-menu-overlay');" +
                "if(x){x.click();return true;}var a=document.getElementById('app');" +
                "if(a&&a.classList.contains('vb-mobile-details')){document.getElementById('detail-close').click();return true;}" +
                "if(a&&a.classList.contains('vb-mobile-chat')){document.getElementById('back-chats').click();return true;}return false;})()";
        webView.evaluateJavascript(js, new ValueCallback<String>() {
            @Override public void onReceiveValue(String value) {
                if (!"true".equals(value)) moveTaskToBack(true);
            }
        });
    }

    @Override protected void onDestroy() {
        if (fileCallback != null) { fileCallback.onReceiveValue(null); fileCallback = null; }
        if (mediaRequest != null) { mediaRequest.deny(); mediaRequest = null; }
        webView.destroy();
        super.onDestroy();
    }
}

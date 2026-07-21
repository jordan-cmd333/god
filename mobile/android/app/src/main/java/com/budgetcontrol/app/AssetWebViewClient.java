package com.budgetcontrol.app;

import android.content.Context;
import android.content.res.AssetManager;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Sert les assets locaux (dossier assets/www) pour l'origine virtuelle
 * https://appassets.local/. Toute autre origine est refusee : l'application ne
 * charge jamais rien depuis le reseau.
 */
class AssetWebViewClient extends WebViewClient {

    private final AssetManager assets;

    AssetWebViewClient(Context context) {
        this.assets = context.getAssets();
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri uri = request.getUrl();
        if (!MainActivity.HOST.equals(uri.getHost())) {
            return response("text/plain", 403, "Forbidden", null);
        }
        String path = uri.getPath();
        if (path == null || path.equals("/")) {
            path = "/index.html";
        }
        try {
            InputStream in = assets.open("www" + path);
            return response(mimeOf(path), 200, "OK", in);
        } catch (IOException e) {
            return response("text/plain", 404, "Not Found", null);
        }
    }

    private WebResourceResponse response(String mime, int code, String reason, InputStream body) {
        if (body == null) {
            body = new ByteArrayInputStream(new byte[0]);
        }
        WebResourceResponse resp = new WebResourceResponse(mime, "utf-8", code, reason,
                noStoreHeaders(), body);
        return resp;
    }

    private Map<String, String> noStoreHeaders() {
        Map<String, String> h = new HashMap<String, String>();
        h.put("Cache-Control", "no-store");
        return h;
    }

    private static String mimeOf(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".js")) return "application/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".json")) return "application/json";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }
}

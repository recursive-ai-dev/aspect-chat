package dev.recursiveai.aspectstudio;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.DocumentsContract;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.UUID;

/** Permission-free export through Android's user-selected document provider. */
@CapacitorPlugin(name = "DocumentExport")
public class DocumentExportPlugin extends Plugin {
    private String activeToken;
    private String filename;
    private String mimeType;
    private long stagedBytes;
    private volatile boolean pickerOpen;

    private File directory() throws IOException {
        File dir = new File(getContext().getCacheDir(), "document-exports");
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("Could not prepare export storage");
        return dir;
    }

    private File stagedFile(String token) throws IOException {
        ExportPolicy.validateToken(token);
        return new File(directory(), token);
    }

    @PluginMethod
    public void begin(PluginCall call) {
        try {
            if (activeToken != null) throw new IllegalStateException("Another export is in progress");
            String requestedName = call.getString("filename");
            String requestedType = call.getString("mimeType");
            ExportPolicy.validateFilename(requestedName);
            ExportPolicy.validateMimeType(requestedType);
            File dir = directory();
            // Process death can leave private staging files. Remove expired files
            // without touching a document picker that may still be outstanding.
            File[] staleFiles = dir.listFiles();
            if (staleFiles != null) for (File file : staleFiles) {
                if (file.lastModified() < System.currentTimeMillis() - 24L * 60 * 60 * 1000) file.delete();
            }
            String token = UUID.randomUUID().toString();
            if (!stagedFile(token).createNewFile()) throw new IOException("Could not prepare export file");
            activeToken = token;
            stagedBytes = 0;
            filename = requestedName;
            mimeType = requestedType;
            JSObject result = new JSObject();
            result.put("token", token);
            call.resolve(result);
        } catch (Exception error) {
            call.reject(error.getMessage(), error);
        }
    }

    @PluginMethod
    public void append(PluginCall call) {
        try {
            String token = call.getString("token");
            if (pickerOpen || activeToken == null || !activeToken.equals(token)) throw new IllegalStateException("Export is not writable");
            File file = stagedFile(token);
            if (!file.isFile() || file.length() != stagedBytes) throw new IOException("Export data was removed from temporary storage; export again");
            String base64 = call.getString("base64");
            int expectedSize = ExportPolicy.decodedSize(base64);
            ExportPolicy.validateTotal(stagedBytes, expectedSize);
            byte[] bytes = Base64.decode(base64, Base64.NO_WRAP);
            if (bytes.length != expectedSize) throw new IllegalArgumentException("Invalid export chunk");
            try (FileOutputStream output = new FileOutputStream(file, true)) {
                if (output.getChannel().size() != stagedBytes) throw new IOException("Export data changed in temporary storage; export again");
                output.write(bytes);
            }
            stagedBytes += bytes.length;
            call.resolve();
        } catch (Exception error) {
            call.reject(error.getMessage(), error);
        }
    }

    @PluginMethod
    public void save(PluginCall call) {
        try {
            String token = call.getString("token");
            if (pickerOpen || activeToken == null || !activeToken.equals(token)) throw new IllegalStateException("Export is not ready");
            File file = stagedFile(token);
            if (!file.isFile() || file.length() != stagedBytes) throw new IOException("Export file is unavailable or incomplete");
            // Only these small fields are persisted by Capacitor across activity
            // recreation; file contents never go into the saved-state Bundle.
            call.getData().put("filename", filename);
            call.getData().put("mimeType", mimeType);
            call.getData().put("byteCount", stagedBytes);
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType(mimeType);
            intent.putExtra(Intent.EXTRA_TITLE, filename);
            pickerOpen = true;
            getActivity().runOnUiThread(() -> {
                try {
                    startActivityForResult(call, intent, "documentCreated");
                } catch (Exception error) {
                    pickerOpen = false;
                    call.reject("No document provider could save this export", error);
                }
            });
        } catch (Exception error) {
            call.reject(error.getMessage(), error);
        }
    }

    @ActivityCallback
    private void documentCreated(PluginCall call, ActivityResult result) {
        if (call == null) {
            execute(() -> {
                if (activeToken != null) {
                    try { stagedFile(activeToken).delete(); } catch (Exception ignored) { /* Cache expiry retries cleanup. */ }
                }
                activeToken = null;
                pickerOpen = false;
            });
            return;
        }
        // Activity callbacks run on the UI thread. File I/O stays on the bridge
        // worker so a slow cloud document provider cannot freeze the app.
        execute(() -> {
            String token = call.getString("token");
            Uri destination = result.getData() == null ? null : result.getData().getData();
            try {
                if (result.getResultCode() != Activity.RESULT_OK) {
                    JSObject response = new JSObject();
                    response.put("cancelled", true);
                    call.resolve(response);
                    return;
                }
                if (destination == null || !"content".equals(destination.getScheme())) throw new IOException("Document provider returned an invalid destination");
                File file = stagedFile(token);
                if (!file.isFile()) throw new IOException("Export data is no longer available; export again");
                long expectedBytes = call.getData().getLong("byteCount");
                if (file.length() != expectedBytes) throw new IOException("Export data is incomplete; export again");
                ExportPolicy.validateTotal(expectedBytes, 0);
                try (FileInputStream input = new FileInputStream(file);
                     OutputStream output = getContext().getContentResolver().openOutputStream(destination, "wt")) {
                    if (output == null) throw new IOException("Could not open the selected document");
                    byte[] buffer = new byte[32 * 1024];
                    if (input.getChannel().size() != expectedBytes) throw new IOException("Export data changed in temporary storage; export again");
                    long copied = 0;
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        output.write(buffer, 0, count);
                        copied += count;
                    }
                    if (copied != expectedBytes) throw new IOException("Export data became incomplete; export again");
                    output.flush();
                }
                JSObject response = new JSObject();
                response.put("cancelled", false);
                response.put("uri", destination.toString());
                call.resolve(response);
            } catch (Exception error) {
                if (destination != null && "content".equals(destination.getScheme())) {
                    try { DocumentsContract.deleteDocument(getContext().getContentResolver(), destination); } catch (Exception ignored) { /* Provider may not support deletion. */ }
                }
                call.reject("Could not save export: " + error.getMessage(), error);
            } finally {
                try { stagedFile(token).delete(); } catch (Exception ignored) { /* Cache cleanup retries later. */ }
                activeToken = null;
                pickerOpen = false;
            }
        });
    }

    @Override
    protected void restoreState(Bundle state) {
        try {
            JSObject data = new JSObject(state.getString("_json", "{}"));
            String token = data.getString("token");
            ExportPolicy.validateToken(token);
            String restoredFilename = data.getString("filename");
            String restoredType = data.getString("mimeType");
            long restoredSize = data.getLong("byteCount");
            ExportPolicy.validateFilename(restoredFilename);
            ExportPolicy.validateMimeType(restoredType);
            ExportPolicy.validateTotal(restoredSize, 0);
            activeToken = token;
            filename = restoredFilename;
            mimeType = restoredType;
            stagedBytes = restoredSize;
            pickerOpen = true;
        } catch (Exception ignored) {
            // The result callback rejects unavailable/invalid staged data.
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (!pickerOpen && activeToken != null) {
            try { stagedFile(activeToken).delete(); } catch (Exception ignored) { /* Cache expiry retries cleanup. */ }
        }
    }

    @PluginMethod
    public void discard(PluginCall call) {
        try {
            String token = call.getString("token");
            ExportPolicy.validateToken(token);
            if (pickerOpen) throw new IllegalStateException("Document picker is still open");
            File file = stagedFile(token);
            if (file.exists() && !file.delete()) throw new IOException("Could not remove temporary export");
            if (token.equals(activeToken)) activeToken = null;
            call.resolve();
        } catch (Exception error) {
            call.reject(error.getMessage(), error);
        }
    }
}

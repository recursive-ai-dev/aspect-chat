package dev.recursiveai.aspectstudio;

import static org.junit.Assert.*;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.app.Activity;
import android.app.Instrumentation;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import androidx.core.content.FileProvider;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.FileInputStream;
import java.io.DataInputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONTokener;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import android.content.res.XmlResourceParser;
import org.xmlpull.v1.XmlPullParser;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class AppSmokeTest {
    @Test public void manifestPreservesAppIdentityAndPrivateStorage() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("dev.recursiveai.aspectstudio", context.getPackageName());
        assertEquals(0, context.getApplicationInfo().flags & ApplicationInfo.FLAG_ALLOW_BACKUP);
        String[] permissions = context.getPackageManager().getPackageInfo(context.getPackageName(), PackageManager.GET_PERMISSIONS).requestedPermissions;
        assertTrue(Arrays.asList(permissions).contains("android.permission.INTERNET"));
        for (String permission : new String[] {"android.permission.READ_EXTERNAL_STORAGE", "android.permission.WRITE_EXTERNAL_STORAGE", "android.permission.MANAGE_EXTERNAL_STORAGE", "android.permission.CAMERA", "android.permission.ACCESS_FINE_LOCATION"}) {
            assertFalse(permission, Arrays.asList(permissions).contains(permission));
        }
    }

    @Test public void extractionRulesExcludeEveryStorageDomainForBothTransferModes() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Set<String> required = new HashSet<>(Arrays.asList("root", "file", "database", "sharedpref", "external", "device_root", "device_file", "device_database", "device_sharedpref"));
        Set<String> cloud = new HashSet<>();
        Set<String> device = new HashSet<>();
        String mode = null;
        try (XmlResourceParser parser = context.getResources().getXml(R.xml.data_extraction_rules)) {
            int event;
            while ((event = parser.next()) != XmlPullParser.END_DOCUMENT) {
                if (event == XmlPullParser.START_TAG) {
                    String name = parser.getName();
                    assertNotEquals("include", name);
                    if (name.equals("cloud-backup") || name.equals("device-transfer")) mode = name;
                    if (name.equals("exclude")) {
                        assertEquals(".", parser.getAttributeValue(null, "path"));
                        assertNotNull(mode);
                        (mode.equals("cloud-backup") ? cloud : device).add(parser.getAttributeValue(null, "domain"));
                    }
                } else if (event == XmlPullParser.END_TAG && (parser.getName().equals("cloud-backup") || parser.getName().equals("device-transfer"))) mode = null;
            }
        }
        assertEquals(required, cloud);
        assertEquals(required, device);
    }

    @Test public void fileProviderMapsOnlyPrivateCameraCaptures() {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String authority = context.getPackageName() + ".fileprovider";
        File capture = new File(context.getExternalFilesDir("Pictures"), "capture.jpg");
        Uri uri = FileProvider.getUriForFile(context, authority, capture);
        assertEquals("content", uri.getScheme());
        assertTrue(uri.getPath().startsWith("/capture_images/"));
        assertThrows(IllegalArgumentException.class, () -> FileProvider.getUriForFile(context, authority, new File(context.getExternalFilesDir(null), "unrelated.txt")));
        assertThrows(IllegalArgumentException.class, () -> FileProvider.getUriForFile(context, authority, new File(context.getCacheDir(), "private.txt")));
    }

    private String evaluate(ActivityScenario<MainActivity> scenario, String script) throws Exception {
        CountDownLatch completed = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(script, value -> {
            result.set(value);
            completed.countDown();
        }));
        assertTrue("WebView JavaScript callback timed out", completed.await(10, TimeUnit.SECONDS));
        return result.get();
    }

    private void waitForStartup(ActivityScenario<MainActivity> scenario) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
        while (System.nanoTime() < deadline) {
            if ("true".equals(evaluate(scenario, "document.readyState === 'complete' && !!document.getElementById('sidebar')"))) return;
            Thread.sleep(100);
        }
        fail("Packaged app did not finish startup");
    }

    private void waitForValue(ActivityScenario<MainActivity> scenario, String script, String expected) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15);
        while (System.nanoTime() < deadline) {
            if (expected.equals(evaluate(scenario, script))) return;
            Thread.sleep(100);
        }
        fail("Native bridge operation timed out: " + evaluate(scenario, script));
    }

    @Test public void nativeExportStagesValidatedBytesAndDiscardsWithoutStoragePermission() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            waitForStartup(scenario);
            evaluate(scenario, "(async () => { try { const p = (m,o) => window.Capacitor.nativePromise('DocumentExport',m,o); const {token} = await p('begin',{filename:'bridge-test.json',mimeType:'application/json'}); window.__exportToken=token; await p('append',{token,base64:'eyJvayI6dHJ1ZX0='}); window.__exportStatus='staged'; } catch(e) { window.__exportStatus='error:'+e.message; } })(); true");
            waitForValue(scenario, "window.__exportStatus", "\"staged\"");
            String token = (String) new JSONTokener(evaluate(scenario, "window.__exportToken")).nextValue();
            File staged = new File(new File(context.getCacheDir(), "document-exports"), token);
            byte[] data = new byte[11];
            try (DataInputStream input = new DataInputStream(new FileInputStream(staged))) {
                input.readFully(data);
                assertEquals(-1, input.read());
            }
            assertEquals("{\"ok\":true}", new String(data, StandardCharsets.UTF_8));
            evaluate(scenario, "window.Capacitor.nativePromise('DocumentExport','append',{token:window.__exportToken,base64:'not base64'}).then(()=>window.__exportStatus='unexpected',()=>window.__exportStatus='rejected'); true");
            waitForValue(scenario, "window.__exportStatus", "\"rejected\"");
            assertEquals(11, staged.length());
            evaluate(scenario, "window.Capacitor.nativePromise('DocumentExport','discard',{token:window.__exportToken}).then(()=>window.__exportStatus='discarded'); true");
            waitForValue(scenario, "window.__exportStatus", "\"discarded\"");
            assertFalse(staged.exists());
            token = stageExport(scenario);
            File evicted = new File(new File(context.getCacheDir(), "document-exports"), token);
            assertTrue(evicted.delete());
            evaluate(scenario, "window.Capacitor.nativePromise('DocumentExport','append',{token:window.__exportToken,base64:'AA=='}).then(()=>window.__exportStatus='unexpected',()=>window.__exportStatus='evicted'); true");
            waitForValue(scenario, "window.__exportStatus", "\"evicted\"");
            assertFalse("An evicted partial export must never be recreated and silently truncated", evicted.exists());
            evaluate(scenario, "window.Capacitor.nativePromise('DocumentExport','discard',{token:window.__exportToken}).then(()=>window.__exportStatus='discarded'); true");
            waitForValue(scenario, "window.__exportStatus", "\"discarded\"");
        }
    }

    private String stageExport(ActivityScenario<MainActivity> scenario) throws Exception {
        evaluate(scenario, "window.__exportStatus='pending'; (async () => { try { const p=(m,o)=>window.Capacitor.nativePromise('DocumentExport',m,o); const {token}=await p('begin',{filename:'roundtrip.json',mimeType:'application/json'}); window.__exportToken=token; await p('append',{token,base64:'eyJvayI6dHJ1ZX0='}); window.__exportStatus='staged'; } catch(e) { window.__exportStatus='error:'+e.message; } })(); true");
        waitForValue(scenario, "window.__exportStatus", "\"staged\"");
        return (String) new JSONTokener(evaluate(scenario, "window.__exportToken")).nextValue();
    }

    private void saveWithPickerResult(ActivityScenario<MainActivity> scenario, int resultCode, Uri destination, String expectedStatus) throws Exception {
        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        IntentFilter filter = new IntentFilter(Intent.ACTION_CREATE_DOCUMENT);
        filter.addCategory(Intent.CATEGORY_OPENABLE);
        filter.addDataType("application/json");
        Intent data = destination == null ? null : new Intent().setData(destination);
        Instrumentation.ActivityMonitor monitor = instrumentation.addMonitor(filter, new Instrumentation.ActivityResult(resultCode, data), true);
        try {
            evaluate(scenario, "window.__exportStatus='saving'; window.Capacitor.nativePromise('DocumentExport','save',{token:window.__exportToken}).then(r=>{window.__exportResult=r;window.__exportStatus=r.cancelled?'cancelled':'saved';},e=>{window.__exportStatus='failed';window.__exportError=e.message;}); true");
            waitForValue(scenario, "window.__exportStatus", "\"" + expectedStatus + "\"");
            assertEquals("The document creation intent was not launched", 1, monitor.getHits());
        } finally {
            instrumentation.removeMonitor(monitor);
        }
    }

    @Test public void exportSaveCancelAndProviderFailureReleaseNativeResources() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File pictures = context.getExternalFilesDir("Pictures");
        assertNotNull(pictures);
        assertTrue(pictures.isDirectory() || pictures.mkdirs());
        File destination = File.createTempFile("export-roundtrip-", ".json", pictures);
        Uri destinationUri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", destination);
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            waitForStartup(scenario);
            String token = stageExport(scenario);
            saveWithPickerResult(scenario, Activity.RESULT_OK, destinationUri, "saved");
            assertEquals(destinationUri.toString(), new JSONTokener(evaluate(scenario, "window.__exportResult.uri")).nextValue());
            byte[] bytes = new byte[11];
            try (DataInputStream input = new DataInputStream(new FileInputStream(destination))) {
                input.readFully(bytes);
                assertEquals(-1, input.read());
            }
            assertEquals("{\"ok\":true}", new String(bytes, StandardCharsets.UTF_8));
            assertFalse(new File(new File(context.getCacheDir(), "document-exports"), token).exists());
            token = stageExport(scenario);
            saveWithPickerResult(scenario, Activity.RESULT_CANCELED, null, "cancelled");
            assertFalse(new File(new File(context.getCacheDir(), "document-exports"), token).exists());
            token = stageExport(scenario);
            saveWithPickerResult(scenario, Activity.RESULT_OK, Uri.parse("content://unavailable.aspect.test/no-provider"), "failed");
            assertFalse(new File(new File(context.getCacheDir(), "document-exports"), token).exists());
            assertTrue(evaluate(scenario, "window.__exportError").contains("Could not save export"));
            // Repeated initialization after cancellation/failure must remain usable.
            token = stageExport(scenario);
            evaluate(scenario, "window.Capacitor.nativePromise('DocumentExport','discard',{token:window.__exportToken}).then(()=>window.__exportStatus='discarded'); true");
            waitForValue(scenario, "window.__exportStatus", "\"discarded\"");
            assertFalse(new File(new File(context.getCacheDir(), "document-exports"), token).exists());
        } finally {
            assertTrue(!destination.exists() || destination.delete());
        }
    }

    @Test public void packagedToolSandboxExecutesCalculatorWithoutNativeOrParentAccess() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            waitForStartup(scenario);
            waitForValue(scenario, "!!window.state && !window.state.libraryBusy && !!window.getCurrentAspect()", "true");
            evaluate(scenario, """
                window.__sandboxStatus='pending';
                (async () => {
                    const aspect = window.getCurrentAspect();
                    const originalTools = aspect.tools;
                    try {
                        const calculator = originalTools.find(t => t.name === 'Calculator.js' || t.name === 'Calculate.js');
                        if (!calculator) throw new Error('The default calculator is missing');
                        const code = "async function executeTool() { return { androidBridge: typeof self.androidBridge, parentReadable: (() => { try { return !!parent.document; } catch (_) { return false; } })() }; }";
                        let hash = 0x811c9dc5;
                        for (let i = 0; i < code.length; i++) { hash ^= code.charCodeAt(i); hash = Math.imul(hash, 0x01000193); }
                        aspect.tools = [{ ...calculator, name: 'Calculator.js', state: {} }, { name: 'BridgeProbe.js', code, state: {}, trustedHash: (hash >>> 0).toString(16) }];
                        const result = JSON.parse(await window.executeJavaScriptTool('Calculator.js', '{"expression":"2 + 2"}'));
                        if (result.result !== 4) throw new Error('Calculator failed: ' + JSON.stringify(result));
                        window.__sandboxProbe = JSON.parse(await window.executeJavaScriptTool('BridgeProbe.js', '{}'));
                        if (window.__sandboxProbe.error) throw new Error(window.__sandboxProbe.error);
                        window.__sandboxStatus='complete';
                    } catch (error) { window.__sandboxStatus='error:' + error.message; }
                    finally {
                        aspect.tools = originalTools;
                        window.markChangesUnsaved();
                        window.dispatchEvent(new Event('pagehide'));
                    }
                })(); true
                """);
            waitForValue(scenario, "window.__sandboxStatus", "\"complete\"");
            assertEquals("\"undefined\"", evaluate(scenario, "window.__sandboxProbe.androidBridge"));
            assertEquals("false", evaluate(scenario, "window.__sandboxProbe.parentReadable"));
            assertEquals("false", evaluate(scenario, "window.getCurrentAspect().tools.some(t => t.name === 'BridgeProbe.js')"));
        }
    }

    @Test public void packagedWebViewStartsWithExportBridgeAndPreservesOriginStorage() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            waitForStartup(scenario);
            scenario.onActivity(activity -> {
                assertNotNull(activity.getBridge().getPlugin("DocumentExport"));
                assertEquals("http://localhost", Uri.parse(activity.getBridge().getWebView().getUrl()).buildUpon().path(null).query(null).fragment(null).build().toString());
            });
            assertEquals("\"saved\"", evaluate(scenario, "localStorage.setItem('__smoke_test__', 'saved'); localStorage.getItem('__smoke_test__')"));
            scenario.recreate();
            waitForStartup(scenario);
            assertEquals("\"saved\"", evaluate(scenario, "localStorage.getItem('__smoke_test__')"));
            evaluate(scenario, "localStorage.removeItem('__smoke_test__')");
        }
    }
}

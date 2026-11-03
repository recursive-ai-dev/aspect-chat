// Build Android artifacts: node scripts/android.mjs [debug|release|bundle|all]
//   debug   -> release/aspect-chat-<ver>-debug.apk    (debug-signed, sideload/testing)
//   release -> release/aspect-chat-<ver>.apk          (needs signing config)
//   bundle  -> release/aspect-chat-<ver>.aab          (needs signing config; what Google Play wants)
//   all     -> debug + release + bundle
// Release signing comes from android/keystore.properties or ANDROID_KEYSTORE_* env vars
// (see android/app/build.gradle and ANDROID.md).
import { copyFile, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = join(root, 'android');
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const target = process.argv[2] || 'debug';
const targets = { debug: ['debug'], release: ['release'], bundle: ['bundle'], all: ['debug', 'release', 'bundle'] };
if (!targets[target]) throw new Error('Usage: android.mjs [debug|release|bundle|all]');

const exists = p => access(p).then(() => true, () => false);
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts });

if (!process.env.ANDROID_HOME && !process.env.ANDROID_SDK_ROOT && !(await exists(join(androidDir, 'local.properties')))) {
    throw new Error('Android SDK not found. Set ANDROID_HOME (or ANDROID_SDK_ROOT) to your SDK path. See ANDROID.md.');
}

const wantsSigned = targets[target].some(t => t !== 'debug');
const hasSigning = (await exists(join(androidDir, 'keystore.properties'))) || !!process.env.ANDROID_KEYSTORE_FILE;
if (wantsSigned && !hasSigning) {
    throw new Error('Release signing is not configured. Create android/keystore.properties (see android/keystore.properties.example) or set ANDROID_KEYSTORE_FILE/ANDROID_KEYSTORE_PASSWORD/ANDROID_KEY_ALIAS/ANDROID_KEY_PASSWORD.');
}

// Always rebuild the web bundle so the APK never ships a stale dist/.
run(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build']);
run(process.execPath, [join(root, 'node_modules/@capacitor/cli/bin/capacitor'), 'sync', 'android']);

const gradle = join(androidDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
const tasks = { debug: 'assembleDebug', release: 'assembleRelease', bundle: 'bundleRelease' };
const outputs = {
    debug: ['app/build/outputs/apk/debug/app-debug.apk', `aspect-chat-${version}-debug.apk`],
    release: ['app/build/outputs/apk/release/app-release.apk', `aspect-chat-${version}.apk`],
    bundle: ['app/build/outputs/bundle/release/app-release.aab', `aspect-chat-${version}.aab`],
};
const out = join(root, 'release');
await mkdir(out, { recursive: true });
for (const t of targets[target]) {
    run(gradle, ['--no-daemon', tasks[t]], { cwd: androidDir });
    const [from, name] = outputs[t];
    await copyFile(join(androidDir, from), join(out, name));
    const digest = createHash('sha256').update(await readFile(join(out, name))).digest('hex');
    await writeFile(join(out, `${name}.sha256`), `${digest}  ${name}\n`);
    console.log(`Packaged release/${name}`);
}

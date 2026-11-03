// Build and validate Android artifacts: node scripts/android.mjs [debug|release|bundle|all]
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import JSZip from 'jszip';
import { androidVersionCode, readProperties, validateApkManifest, validateBundleManifest, validateBundleSignature, validateSigning } from './android-config.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = join(root, 'android');
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const wrapper = await readProperties(join(androidDir, 'gradle/wrapper/gradle-wrapper.properties'));
const gradleVersion = /gradle-([\d.]+)-(?:all|bin)\.zip/.exec(wrapper.distributionUrl ?? '')?.[1] ?? 'unknown';
const target = process.argv[2] || 'debug';
const targets = { debug: ['debug'], release: ['release'], bundle: ['bundle'], all: ['debug', 'release', 'bundle'] };
if (!Object.hasOwn(targets, target)) throw new Error('Usage: android.mjs [debug|release|bundle|all]');
const code = androidVersionCode(version, process.env.VERSION_CODE);
const outputs = {
    debug: ['app/build/outputs/apk/debug/app-debug.apk', `aspect-chat-${version}-debug.apk`],
    release: ['app/build/outputs/apk/release/app-release.apk', `aspect-chat-${version}.apk`],
    bundle: ['app/build/outputs/bundle/release/app-release.aab', `aspect-chat-${version}.aab`],
};
const out = join(root, 'release');
// Clear only the requested same-version outputs before preflight, so even a
// failed preflight cannot leave stale files ready for a release upload glob.
for (const t of targets[target]) {
    const name = outputs[t][1];
    await Promise.all(['', '.sha256', '.build.json'].map(suffix => rm(join(out, name + suffix), { force: true })));
}
if (targets[target].some(t => t !== 'debug')) await validateSigning(androidDir);

const local = await readProperties(join(androidDir, 'local.properties'));
const sdkPath = local['sdk.dir'] || process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (!sdkPath) throw new Error('Android SDK not found. Set ANDROID_HOME or sdk.dir in android/local.properties. See ANDROID.md.');
const sdk = resolve(androidDir, sdkPath);
const sdkTool = name => join(sdk, 'build-tools', '36.0.0', `${name}${process.platform === 'win32' && name === 'apksigner' ? '.bat' : process.platform === 'win32' ? '.exe' : ''}`);
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts });
const capture = (cmd, args, opts = {}) => run(cmd, args, { stdio: 'pipe', encoding: 'utf8', ...opts }).trim();
// Validate the tools before spending time rebuilding the web and native app.
await Promise.all(['aapt', 'apksigner', 'zipalign'].map(name => access(sdkTool(name)).catch(() => { throw new Error(`Android build-tools 36.0.0 ${name} is unavailable. Install the configured SDK build tools.`); })));

run(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build']);
run(process.execPath, [join(root, 'node_modules/@capacitor/cli/bin/capacitor'), 'sync', 'android']);
const gradle = join(androidDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
const gradleOptions = ['--no-daemon', `-PversionCode=${code}`];
const tasks = { debug: 'assembleDebug', release: 'assembleRelease', bundle: 'bundleRelease' };
await mkdir(out, { recursive: true });
const staging = await mkdtemp(join(out, '.android-'));
try {
    for (const t of targets[target]) {
        const [from, name] = outputs[t];
        run(gradle, [...gradleOptions, tasks[t]], { cwd: androidDir, env: { ...process.env, ANDROID_HOME: sdk } });
        const source = join(androidDir, from);
        let validation;
        if (t === 'bundle') {
            const manifest = capture(gradle, [...gradleOptions, '--quiet', ':app:validateReleaseBundle', ':app:dumpReleaseBundleManifest'], { cwd: androidDir, env: { ...process.env, ANDROID_HOME: sdk } });
            const archive = await JSZip.loadAsync(await readFile(source), { checkCRC32: true });
            for (const entry of ['BundleConfig.pb', 'base/manifest/AndroidManifest.xml', 'base/assets/public/index.html']) {
                if (!archive.file(entry)) throw new Error(`Invalid Android bundle: missing ${entry}.`);
            }
            const signature = capture('jarsigner', ['-J-Duser.language=en', '-J-Duser.country=US', '-verify', '-verbose', source]);
            validateBundleSignature(signature);
            validation = { ...validateBundleManifest(manifest, version, code), zipCrc: true, jarSignature: true, bundletoolValidation: true };
        } else {
            const signature = capture(sdkTool('apksigner'), ['verify', '--verbose', '--print-certs', source]);
            capture(sdkTool('zipalign'), ['-c', '-P', '16', '4', source]);
            validation = {
                ...validateApkManifest(capture(sdkTool('aapt'), ['dump', 'badging', source]), version, code, t === 'debug'),
                apkSignature: true, alignment: true,
                certificateSha256: /certificate SHA-256 digest: (\w+)/.exec(signature)?.[1] ?? null,
            };
        }
        const bytes = await readFile(source);
        const digest = createHash('sha256').update(bytes).digest('hex');
        const metadata = {
            artifact: name, target: t, version, versionCode: code, sha256: digest, bytes: bytes.length,
            buildTime: new Date().toISOString(),
            environment: { node: process.version, java: capture('java', ['--version']).split('\n')[0], gradle: gradleVersion, androidBuildTools: '36.0.0', platform: process.platform, architecture: process.arch },
            source: { commit: capture('git', ['rev-parse', 'HEAD']), modified: Boolean(capture('git', ['status', '--porcelain'])) },
            validation,
            limitations: ['No physical-device/emulator startup or document-picker validation performed by this packaging command.', ...(t === 'bundle' ? ['Google Play upload/acceptance has not been performed.'] : [])],
        };
        await copyFile(source, join(staging, name));
        await writeFile(join(staging, `${name}.sha256`), `${digest}  ${name}\n`);
        await writeFile(join(staging, `${name}.build.json`), JSON.stringify(metadata, null, 2) + '\n');
        for (const file of await readdir(staging)) await rename(join(staging, file), join(out, file));
        console.log(`Validated and packaged release/${name}`);
    }
} finally {
    await rm(staging, { recursive: true, force: true });
}

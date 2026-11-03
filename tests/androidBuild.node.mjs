import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, copyFile, mkdir, mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { androidVersionCode, parseProperties, validateApkManifest, validateBundleManifest, validateBundleSignature, validateSigning } from '../scripts/android-config.mjs';

test('automatic version codes reject collisions and overflow, allow explicit bounded overrides', () => {
    for (const [version, code] of [['0.0.1', 1], ['1.0.0', 10000], ['1.99.99', 19999], ['210000.0.0', 2100000000]]) {
        assert.equal(androidVersionCode(version), code);
    }
    for (const version of ['0.0.0', '1.100.0', '1.0.100', '210000.0.1', '9999999999999999999.0.0', '1.2', '../1.0.0', '01.0.0', '1.0.0/bad', '1.0.0-01', '1.0.0-rc.1', '1.0.0+build.1']) {
        assert.throws(() => androidVersionCode(version));
    }
    for (const code of ['', '0', '-1', '1.2', '01', '2100000001', '999999999999999999999999', ' 1', '1e3']) {
        assert.throws(() => androidVersionCode('1.0.0', code));
    }
    assert.equal(androidVersionCode('1.0.100', '2100000000'), 2100000000);
    assert.equal(androidVersionCode('2.0.0-rc.1+build.1', '20001'), 20001);
    assert.equal(androidVersionCode('2.0.0-rc--test', '20002'), 20002);
    // Exhaust every minor/patch slot for two majors to detect accidental aliases.
    const codes = new Set();
    for (let major = 1; major <= 2; major++) for (let minor = 0; minor < 100; minor++) for (let patch = 0; patch < 100; patch++) {
        const code = androidVersionCode(`${major}.${minor}.${patch}`);
        assert.ok(!codes.has(code));
        codes.add(code);
    }
});

test('Java properties handle comments, separators, whitespace, escapes and continuations', () => {
    const properties = parseProperties('# comment\n!other\nstoreFile = ../a\\ b.jks\nkeyAlias:aspect\\u002dstudio\nstorePassword: abc\\=x\\\\y\nkeyPassword = first\\\n  second\nescaped\\:key:value\n');
    assert.equal(properties.storeFile, '../a b.jks');
    assert.equal(properties.keyAlias, 'aspect-studio');
    assert.equal(properties.storePassword, 'abc=x\\y');
    assert.equal(properties.keyPassword, 'firstsecond');
    assert.equal(properties['escaped:key'], 'value');
    assert.equal(Object.getPrototypeOf(properties), null);
    assert.throws(() => parseProperties('password=\\uxxxx'));
    assert.equal(parseProperties('password=\\\\uxxxx').password, '\\uxxxx');
    assert.throws(() => parseProperties('key\\uxxxx=value'));
});

test('release signing preflight rejects partial configuration without exposing secrets', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aspect-signing-'));
    const env = { ANDROID_KEYSTORE_FILE: 'upload.jks', ANDROID_KEYSTORE_PASSWORD: 'password-secret', ANDROID_KEY_ALIAS: 'alias-secret', ANDROID_KEY_PASSWORD: 'key-secret' };
    try {
        await assert.rejects(validateSigning(directory, {}), /incomplete/);
        await writeFile(join(directory, 'keystore.properties'), '');
        await assert.rejects(validateSigning(directory, {}), /incomplete/);
        await writeFile(join(directory, 'keystore.properties'), 'storePassword=property-secret\n');
        await assert.rejects(validateSigning(directory, env), error => /readable file/.test(error.message) && !/secret/.test(error.message));
        await writeFile(join(directory, 'upload.jks'), 'fixture');
        const values = await validateSigning(directory, env);
        assert.equal(values.storePassword, 'property-secret');
        assert.equal(values.keyAlias, 'alias-secret');
        await assert.rejects(validateSigning(directory, { ...env, ANDROID_KEY_PASSWORD: '' }), error => /keyPassword/.test(error.message) && !/secret/.test(error.message));
        await assert.rejects(validateSigning(directory, { ...env, ANDROID_KEYSTORE_FILE: '.' }), /readable file/);
    } finally { await rm(directory, { recursive: true, force: true }); }
});

test('APK inspection rejects wrong identity, version, debuggability and SDK targets', () => {
    const badging = "package: name='dev.recursiveai.aspectstudio' versionCode='10001' versionName='1.0.1' platformBuildVersionName='16'\nsdkVersion:'24'\ntargetSdkVersion:'36'\napplication-debuggable\n";
    assert.equal(validateApkManifest(badging, '1.0.1', 10001, true).applicationId, 'dev.recursiveai.aspectstudio');
    for (const invalid of ['', badging.replace('dev.recursiveai.aspectstudio', 'other.app'), badging.replace('10001', '10000'), badging.replace("versionName='1.0.1'", "versionName='1.0.0'"), badging.replace("sdkVersion:'24'", "sdkVersion:'23'"), badging.replace("targetSdkVersion:'36'", "targetSdkVersion:'35'"), badging.replace('application-debuggable', '')]) {
        assert.throws(() => validateApkManifest(invalid, '1.0.1', 10001, true));
    }
    assert.throws(() => validateApkManifest(badging, '1.0.1', 10001, false));
});

test('bundle validation rejects missing signatures and partially unsigned archives', () => {
    validateBundleSignature('jar verified.\nWarning: This jar contains entries whose signer certificate is self-signed.');
    for (const output of ['', 'jar is unsigned.', 'jar verified.\nThis jar contains unsigned entries which have not been integrity-checked.', 'jar verified.\nAn entry is not signed.']) {
        assert.throws(() => validateBundleSignature(output));
    }
});

test('bundle manifest inspection rejects mismatched releases and unsafe SDK/debug states', () => {
    const xml = '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="dev.recursiveai.aspectstudio" android:versionCode="10001" android:versionName="1.0.1"><uses-sdk android:minSdkVersion="24" android:targetSdkVersion="36"/><application android:debuggable="false"/></manifest>';
    assert.equal(validateBundleManifest(xml, '1.0.1', 10001).versionCode, 10001);
    for (const invalid of ['', xml.replace('aspectstudio', 'other'), xml.replace('10001', '10000'), xml.replace('1.0.1', '1.0.0'), xml.replace('Version="24"', 'Version="23"'), xml.replace('Version="36"', 'Version="35"'), xml.replace('debuggable="false"', 'debuggable="true"'), xml + xml]) {
        assert.throws(() => validateBundleManifest(invalid, '1.0.1', 10001));
    }
});

test('failed preflight clears only requested stale outputs and rejects inherited CLI targets', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aspect-build-cli-'));
    try {
        await mkdir(join(directory, 'scripts'));
        await mkdir(join(directory, 'android'));
        await mkdir(join(directory, 'android/gradle/wrapper'), { recursive: true });
        await writeFile(join(directory, 'android/gradle/wrapper/gradle-wrapper.properties'), 'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.14.3-all.zip\n');
        await mkdir(join(directory, 'release'));
        for (const name of ['android.mjs', 'android-config.mjs']) await copyFile(new URL(`../scripts/${name}`, import.meta.url), join(directory, 'scripts', name));
        await symlink(fileURLToPath(new URL('../node_modules', import.meta.url)), join(directory, 'node_modules'), 'junction');
        await writeFile(join(directory, 'package.json'), '{"version":"1.0.1","type":"module"}');
        for (const suffix of ['', '.sha256', '.build.json']) await writeFile(join(directory, 'release', `aspect-chat-1.0.1.apk${suffix}`), 'stale');
        await writeFile(join(directory, 'release', 'aspect-chat-1.0.0.apk'), 'keep');
        const run = target => execFileSync(process.execPath, [join(directory, 'scripts/android.mjs'), target], { env: { PATH: process.env.PATH }, stdio: 'pipe' });
        assert.throws(() => run('release'), error => error.status === 1 && /Release signing is incomplete/.test(String(error.stderr)));
        for (const suffix of ['', '.sha256', '.build.json']) await assert.rejects(access(join(directory, 'release', `aspect-chat-1.0.1.apk${suffix}`)));
        assert.equal(await readFile(join(directory, 'release', 'aspect-chat-1.0.0.apk'), 'utf8'), 'keep');
        assert.throws(() => run('toString'), error => error.status === 1 && /Usage: android.mjs/.test(String(error.stderr)));
    } finally { await rm(directory, { recursive: true, force: true }); }
});

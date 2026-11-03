import { access, readFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';

export const APPLICATION_ID = 'dev.recursiveai.aspectstudio';
export const MAX_VERSION_CODE = 2100000000;

export function androidVersionCode(version, override) {
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(version);
    if (!match || match[4]?.split('.').some(part => /^0\d+$/.test(part))) throw new Error('Android requires a valid semantic package version.');
    if (override !== undefined && override !== null) {
        if (!/^[1-9]\d*$/.test(String(override)) || BigInt(override) > BigInt(MAX_VERSION_CODE)) {
            throw new Error(`VERSION_CODE must be an integer from 1 to ${MAX_VERSION_CODE}.`);
        }
        return Number(override);
    }
    if (match[4] || version.includes('+')) throw new Error('Prerelease/build versions require an explicit VERSION_CODE to preserve Android update ordering.');
    const [major, minor, patch] = match.slice(1, 4).map(BigInt);
    const code = major * 10000n + minor * 100n + patch;
    if (minor > 99n || patch > 99n || code < 1n || code > BigInt(MAX_VERSION_CODE)) {
        throw new Error('Automatic Android version codes require minor/patch below 100 and a code from 1 to 2100000000; set VERSION_CODE explicitly.');
    }
    return Number(code);
}

// Match java.util.Properties syntax, including continuation lines and escaped
// separators. Gradle loads the same file with Properties.load(InputStream).
export function parseProperties(source) {
    const result = Object.create(null);
    const unescape = value => {
        let decoded = '';
        for (let index = 0; index < value.length; index++) {
            if (value[index] !== '\\') { decoded += value[index]; continue; }
            const token = value[++index];
            if (token === 'u') {
                const hex = value.slice(index + 1, index + 5);
                if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Error('Invalid Unicode escape in Android properties.');
                decoded += String.fromCharCode(parseInt(hex, 16));
                index += 4;
            } else decoded += ({ t: '\t', r: '\r', n: '\n', f: '\f' })[token] ?? token ?? '';
        }
        return decoded;
    };
    const lines = source.replace(/\r\n?/g, '\n').split('\n');
    for (let index = 0; index < lines.length; index++) {
        let line = lines[index].replace(/^[ \t\f]+/, '');
        if (!line || /^[#!]/.test(line)) continue;
        while ((line.match(/\\+$/)?.[0].length ?? 0) % 2 === 1) {
            line = line.slice(0, -1) + (lines[++index] ?? '').replace(/^[ \t\f]+/, '');
        }
        let split = line.length;
        for (let pos = 0; pos < line.length; pos++) {
            if (line[pos] === '\\') { pos++; continue; }
            if (/[=: \t\f]/.test(line[pos])) { split = pos; break; }
        }
        const rawKey = line.slice(0, split);
        const value = line.slice(split).replace(/^[ \t\f]+/, '').replace(/^[=:][ \t\f]*/, '');
        result[unescape(rawKey)] = unescape(value);
    }
    return result;
}

export async function readProperties(path) {
    try { return parseProperties(await readFile(path, 'latin1')); }
    catch (error) { if (error.code === 'ENOENT') return Object.create(null); throw error; }
}

export async function validateSigning(androidDir, env = process.env) {
    const properties = await readProperties(resolve(androidDir, 'keystore.properties'));
    const fields = {
        storeFile: 'ANDROID_KEYSTORE_FILE', storePassword: 'ANDROID_KEYSTORE_PASSWORD',
        keyAlias: 'ANDROID_KEY_ALIAS', keyPassword: 'ANDROID_KEY_PASSWORD',
    };
    const values = Object.fromEntries(Object.entries(fields).map(([key, name]) => [key, properties[key] || env[name]]));
    const missing = Object.entries(fields).filter(([key]) => !values[key]).map(([key, name]) => `${key}/${name}`);
    if (missing.length) throw new Error(`Release signing is incomplete: missing ${missing.join(', ')}. See android/keystore.properties.example.`);
    const file = resolve(androidDir, values.storeFile);
    try {
        await access(file, constants.R_OK);
        if (!(await stat(file)).isFile()) throw new Error();
    } catch {
        // Never echo supplied paths or credentials in signing diagnostics.
        throw new Error('Release keystore must be a readable file. Check storeFile/ANDROID_KEYSTORE_FILE.');
    }
    return values;
}

export function validateApkManifest(badging, version, code, debug) {
    const pkg = /^package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'/m.exec(badging);
    if (!pkg || pkg[1] !== APPLICATION_ID || pkg[2] !== String(code) || pkg[3] !== version) {
        throw new Error('APK application identity/version does not match this build.');
    }
    if (/^application-debuggable/m.test(badging) !== debug) throw new Error('APK debuggable flag does not match the requested target.');
    if (!/^sdkVersion:'24'$/m.test(badging) || !/^targetSdkVersion:'36'$/m.test(badging)) {
        throw new Error('APK SDK levels do not match supported Android 24–36 configuration.');
    }
    return { applicationId: pkg[1], versionName: pkg[3], versionCode: Number(pkg[2]), debuggable: debug, minSdk: 24, targetSdk: 36 };
}

export function validateBundleSignature(output) {
    if (!/jar verified\./.test(output) || /jar is unsigned|unsigned entries|not signed/i.test(output)) {
        throw new Error('Android bundle signature is missing or does not cover every entry.');
    }
}

export function validateBundleManifest(xml, version, code) {
    const attributes = tag => Object.fromEntries([...tag.matchAll(/([\w:.-]+)\s*=\s*(["'])(.*?)\2/gs)].map(match => [match[1], match[3]]));
    const manifest = /<manifest\b[^>]*>/s.exec(xml)?.[0];
    const sdk = /<uses-sdk\b[^>]*>/s.exec(xml)?.[0];
    const application = /<application\b[^>]*>/s.exec(xml)?.[0];
    if (!manifest || !sdk || !application || (xml.match(/<manifest\b/g) ?? []).length !== 1) throw new Error('Invalid bundle manifest.');
    const root = attributes(manifest);
    const namespace = Object.entries(root).find(([key, value]) => key.startsWith('xmlns:') && value === 'http://schemas.android.com/apk/res/android')?.[0].slice(6);
    const android = name => `${namespace}:${name}`;
    const levels = attributes(sdk);
    if (!namespace || root.package !== APPLICATION_ID || root[android('versionCode')] !== String(code) || root[android('versionName')] !== version ||
        levels[android('minSdkVersion')] !== '24' || levels[android('targetSdkVersion')] !== '36' || attributes(application)[android('debuggable')] === 'true') {
        throw new Error('Bundle application identity/version/SDK/debuggable state does not match this release.');
    }
    return { applicationId: root.package, versionName: version, versionCode: code, minSdk: 24, targetSdk: 36, debuggable: false };
}

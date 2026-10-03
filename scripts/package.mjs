import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import JSZip from 'jszip';
import { readdir } from 'node:fs/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?$/.test(version)) throw new Error('Unsupported package version');
const target = process.argv[2] || 'all';
if (!['web', 'deb', 'all'].includes(target)) throw new Error('Usage: package.mjs [web|deb|all]');
// Never package a stale dist directory.
execFileSync(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build'], { cwd: root, stdio: 'inherit' });
const output = join(root, 'release');
await mkdir(output, { recursive: true });
const staging = await mkdtemp(join(tmpdir(), 'aspect-chat-package-'));
const artifacts = [];
try {
    const name = `aspect-chat-${version}`;
    const bundle = join(staging, name);
    await mkdir(bundle);
    await cp(join(root, 'dist'), join(bundle, 'dist'), { recursive: true });
    await cp(join(root, 'packaging/server.mjs'), join(bundle, 'server.mjs'));
    await cp(join(root, 'LICENSE'), join(bundle, 'LICENSE'));
    await writeFile(join(bundle, 'README.txt'), `Aspect Studio ${version}\n\nRequires Node.js 20.19+ (Node.js 24 recommended). No npm install required.\nRun: node server.mjs --open\nOpen http://localhost:43110/ and keep the terminal open. Ctrl+C stops the server.\nSet ASPECT_CHAT_PORT to change the port. Browser data belongs to its origin;\nuse the same hostname and port to retain access to your existing library.\n\nFor static hosting, upload the contents of dist/ to your web server.\nDo not open index.html using file://. Model weights download on first use.\nOptional llama/git bridges and model servers are installed separately.\n`);
    if (target !== 'deb') {
        const zip = new JSZip();
        async function add(directory, prefix) {
            for (const entry of await readdir(directory, { withFileTypes: true })) {
                const path = join(directory, entry.name);
                const key = `${prefix}/${entry.name}`;
                if (entry.isDirectory()) await add(path, key);
                else zip.file(key, await readFile(path));
            }
        }
        await add(bundle, name);
        const filename = `${name}-web.zip`;
        await writeFile(join(output, filename), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } }));
        artifacts.push(filename);
    }
    if (target !== 'web') {
        const deb = join(staging, 'deb');
        for (const path of ['DEBIAN', 'usr/share/aspect-chat', 'usr/bin', 'usr/share/applications', 'usr/share/icons/hicolor/scalable/apps', 'usr/share/doc/aspect-chat']) {
            await mkdir(join(deb, path), { recursive: true });
        }
        await cp(bundle, join(deb, 'usr/share/aspect-chat'), { recursive: true });
        await cp(join(root, 'LICENSE'), join(deb, 'usr/share/doc/aspect-chat/copyright'));
        await writeFile(join(deb, 'DEBIAN/control'), `Package: aspect-chat\nVersion: ${version}\nSection: web\nPriority: optional\nArchitecture: all\nDepends: nodejs (>= 20.19.0), xdg-utils\nMaintainer: Aspect Chat contributors <noreply@github.com>\nHomepage: https://github.com/recursive-ai-dev/aspect-chat\nDescription: Local-first AI persona studio\n Browser app with a loopback-only production server.\n`);
        await writeFile(join(deb, 'usr/bin/aspect-chat'), '#!/bin/sh\nexec node /usr/share/aspect-chat/server.mjs "$@"\n', { mode: 0o755 });
        await writeFile(join(deb, 'usr/share/applications/aspect-chat.desktop'), '[Desktop Entry]\nType=Application\nName=Aspect Studio\nComment=Custom AI personas using your own models\nExec=/usr/bin/aspect-chat --open\nIcon=aspect-chat\nTerminal=true\nCategories=Development;Utility;\n');
        await cp(join(root, 'packaging/aspect-chat.svg'), join(deb, 'usr/share/icons/hicolor/scalable/apps/aspect-chat.svg'));
        async function normalizeModes(directory) {
            await chmod(directory, 0o755);
            for (const entry of await readdir(directory, { withFileTypes: true })) {
                const path = join(directory, entry.name);
                if (entry.isDirectory()) await normalizeModes(path);
                else await chmod(path, path === join(deb, 'usr/bin/aspect-chat') ? 0o755 : 0o644);
            }
        }
        await normalizeModes(deb);
        const filename = `${name}_all.deb`;
        execFileSync('dpkg-deb', ['--root-owner-group', '--build', deb, join(output, filename)], { stdio: 'inherit' });
        artifacts.push(filename);
    }
    for (const filename of artifacts) {
        const digest = createHash('sha256').update(await readFile(join(output, filename))).digest('hex');
        await writeFile(join(output, `${filename}.sha256`), `${digest}  ${filename}\n`);
        console.log(`Packaged release/${filename}`);
    }
} finally {
    await rm(staging, { recursive: true, force: true });
}

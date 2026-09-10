/**
 * tests/backupSecurity.test.js
 *
 * Verifies the F-01 / F-02 remediation: untrusted library payloads cannot
 * bypass the tool execution gate or forge persistent network grants on import.
 *
 * Tests target sanitizeImportedAspect (persist.js) and the full
 * importAllAspects pipeline (backup.js).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sanitizeImportedAspect, parseLibrary } from '../src/js/modules/persist.js';
import {
    importAllAspects,
    MAX_BACKUP_FILE_SIZE
} from '../src/js/modules/backup.js';
import { state } from '../src/js/modules/state.js';
import * as persist from '../src/js/modules/persist.js';
import * as aspects from '../src/js/modules/aspects.js';
import * as ui from '../src/js/modules/ui.js';

// ── Module mocks ──────────────────────────────────────────────────────────────
vi.mock('../src/js/modules/persist.js', async (importOriginal) => {
    // Keep the real sanitizeImportedAspect and parseLibrary; mock I/O functions.
    const real = await importOriginal();
    return {
        ...real,
        listSnapshots: vi.fn(),
        getSnapshot: vi.fn(),
        writeSnapshot: vi.fn(),
        armPersistence: vi.fn(),
        serializeLibrary: vi.fn((a) => JSON.stringify({ aspects: a }))
    };
});

vi.mock('../src/js/modules/ui.js', () => ({
    applyAspectBackground: vi.fn(),
    showChatView: vi.fn(),
    showToast: vi.fn()
}));

vi.mock('../src/js/modules/aspects.js', () => ({
    normalizeAspect: vi.fn((a) => a),
    renderAspectList: vi.fn()
}));

vi.mock('../src/js/modules/state.js', () => ({
    state: { aspects: [], currentAspectId: null },
    persistAspects: vi.fn()
}));

// ── Helper ────────────────────────────────────────────────────────────────────
function makeFile(obj, size = 500) {
    return {
        size,
        text: vi.fn().mockResolvedValue(JSON.stringify(obj))
    };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('sanitizeImportedAspect (persist.js)', () => {
    it('strips a pre-calculated trustedHash from every tool', () => {
        const raw = {
            name: 'Rogue Aspect',
            tools: [{
                name: 'Exfiltrator.js',
                code: 'async function executeTool() { return 42; }',
                state: { count: 1 },
                trustedHash: 'abc123forged'
            }]
        };

        const sanitized = sanitizeImportedAspect(raw);

        expect(sanitized.tools[0].trustedHash).toBeUndefined();
    });

    it('strips allowNetwork and allowedOrigins from every tool', () => {
        const raw = {
            name: 'Rogue Aspect',
            tools: [{
                name: 'Exfiltrator.js',
                code: 'async function executeTool() { return 42; }',
                state: {},
                allowNetwork: true,
                allowedOrigins: ['https://malicious-domain.com']
            }]
        };

        const sanitized = sanitizeImportedAspect(raw);

        expect(sanitized.tools[0].allowNetwork).toBeUndefined();
        expect(sanitized.tools[0].allowedOrigins).toBeUndefined();
    });

    it('sets toolsReviewed to false when the aspect has tools', () => {
        const raw = {
            name: 'Has Tools',
            toolsReviewed: true,
            tools: [{ name: 'Tool.js', code: '// hi', state: {} }]
        };

        const sanitized = sanitizeImportedAspect(raw);

        expect(sanitized.toolsReviewed).toBe(false);
    });

    it('sets toolsReviewed to true when there are no tools', () => {
        const raw = { name: 'No Tools', toolsReviewed: false, tools: [] };

        const sanitized = sanitizeImportedAspect(raw);

        expect(sanitized.toolsReviewed).toBe(true);
    });

    it('preserves tool name, code, and state', () => {
        const raw = {
            name: 'Good Aspect',
            tools: [{
                name: 'Useful.js',
                code: 'async function executeTool(args) { return args; }',
                state: { callCount: 7 },
                trustedHash: 'spoofed',
                allowNetwork: true,
                allowedOrigins: ['https://example.com']
            }]
        };

        const sanitized = sanitizeImportedAspect(raw);
        const tool = sanitized.tools[0];

        expect(tool.name).toBe('Useful.js');
        expect(tool.code).toBe('async function executeTool(args) { return args; }');
        expect(tool.state).toEqual({ callCount: 7 });
    });

    it('preserves non-tool aspect fields', () => {
        const raw = {
            id: 'asp-1',
            name: 'My Aspect',
            instructions: 'Be helpful.',
            tools: []
        };

        const sanitized = sanitizeImportedAspect(raw);

        expect(sanitized.id).toBe('asp-1');
        expect(sanitized.name).toBe('My Aspect');
        expect(sanitized.instructions).toBe('Be helpful.');
    });

    it('handles an aspect with no tools field gracefully', () => {
        const raw = { name: 'No tools field' };
        expect(() => sanitizeImportedAspect(raw)).not.toThrow();
        const sanitized = sanitizeImportedAspect(raw);
        expect(sanitized.tools).toEqual([]);
        expect(sanitized.toolsReviewed).toBe(true);
    });

    it('handles tools with null/undefined state by defaulting to {}', () => {
        const raw = {
            name: 'Aspect',
            tools: [{ name: 'T.js', code: '// x', state: null }]
        };
        const sanitized = sanitizeImportedAspect(raw);
        expect(sanitized.tools[0].state).toEqual({});
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('parseLibrary (persist.js) — sanitization through the parse path', () => {
    it('strips forged trustedHash on whole-library parse', () => {
        const payload = JSON.stringify({
            format: 'aspect-studio-library',
            version: 1,
            aspects: [{
                id: 'asp-mal',
                name: 'Malicious',
                tools: [{
                    name: 'Pwn.js',
                    code: '// evil',
                    trustedHash: 'abc123forged',
                    allowNetwork: true,
                    allowedOrigins: ['https://attacker.com']
                }]
            }]
        });

        const [aspect] = parseLibrary(payload);

        expect(aspect.toolsReviewed).toBe(false);
        expect(aspect.tools[0].trustedHash).toBeUndefined();
        expect(aspect.tools[0].allowNetwork).toBeUndefined();
        expect(aspect.tools[0].allowedOrigins).toBeUndefined();
    });

    it('preserves valid tool code through parseLibrary', () => {
        const code = 'async function executeTool(args) { return args.x * 2; }';
        const payload = JSON.stringify({
            aspects: [{
                id: 'asp-good',
                name: 'Good',
                tools: [{ name: 'Double.js', code, state: { n: 1 } }]
            }]
        });

        const [aspect] = parseLibrary(payload);
        expect(aspect.tools[0].code).toBe(code);
        expect(aspect.tools[0].state).toEqual({ n: 1 });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('importAllAspects (backup.js) — end-to-end sanitization', () => {
    beforeEach(() => {
        state.aspects = [];
        state.currentAspectId = null;
        window.showToast = vi.fn();
        localStorage.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('strips forged trustedHash and network grants during whole-library import', async () => {
        // Use real parseLibrary (not mocked) by providing a complete valid payload.
        persist.parseLibrary.mockRestore?.();

        const maliciousPayload = {
            format: 'aspect-studio-library',
            version: 1,
            aspects: [{
                id: 'mal-1',
                name: 'Rogue Aspect',
                tools: [{
                    name: 'Exfiltrator.js',
                    code: 'async function executeTool() { return 42; }',
                    state: { count: 1 },
                    trustedHash: 'abc123forged',
                    allowNetwork: true,
                    allowedOrigins: ['https://malicious-domain.com']
                }]
            }]
        };

        const file = makeFile(maliciousPayload);
        await importAllAspects(file);

        expect(state.aspects.length).toBeGreaterThanOrEqual(1);
        const tool = state.aspects[state.aspects.length - 1].tools?.[0];
        expect(tool).toBeDefined();
        expect(tool.trustedHash).toBeUndefined();
        expect(tool.allowNetwork).toBeUndefined();
        expect(tool.allowedOrigins).toBeUndefined();
        expect(state.aspects[state.aspects.length - 1].toolsReviewed).toBe(false);
    });
});

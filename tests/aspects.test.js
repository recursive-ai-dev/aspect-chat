import { describe, it, expect } from 'vitest';
import { getLakesideSageIcon } from '../src/js/modules/aspects.js';

describe('Aspects Module', () => {
    describe('getLakesideSageIcon', () => {
        it('should return a valid base64-encoded SVG string', () => {
            const icon = getLakesideSageIcon();

            // Should start with the correct data URI prefix
            expect(icon).toMatch(/^data:image\/svg\+xml;base64,/);

            // Extract the base64 portion
            const base64Str = icon.split(',')[1];

            // Decode the base64 string
            const decodedSvg = atob(base64Str);

            // Verify it contains expected SVG content
            expect(decodedSvg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
            expect(decodedSvg).toContain('<linearGradient id="sky"');
            expect(decodedSvg).toContain('</svg>');
        });
    });
});

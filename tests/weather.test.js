import { describe, it, expect, vi } from 'vitest';
import { systemTools } from '../src/js/modules/systemTools.js';

const tool = systemTools.find(t => t.name === 'Weather.js');
const run = (args, fetch) => new Function('fetch', tool.code + '; return executeTool;')(fetch)(args, {});
const weather = () => ({
    timezone: 'America/Moncton',
    current: { time: '2026-11-03T13:00', temperature_2m: 6.5, apparent_temperature: 4, wind_speed_10m: 8, weather_code: 3 },
    current_units: { temperature_2m: '°C', apparent_temperature: '°C', wind_speed_10m: 'km/h' }
});
const response = data => ({ ok: true, json: async () => data });

describe('real current-weather tool', () => {
    it('geocodes a bounded, encoded query and returns actual values with source and units', async () => {
        const fetch = vi.fn()
            .mockResolvedValueOnce(response({ results: [{ name: 'Moncton', country: 'Canada', latitude: 46.09, longitude: -64.78 }] }))
            .mockResolvedValueOnce(response(weather()));
        const result = await run({ location: 'Moncton & Canada' }, fetch);
        expect(fetch.mock.calls[0][0]).toContain('name=Moncton%20%26%20Canada');
        const url = new URL(fetch.mock.calls[1][0]);
        expect(url.hostname).toBe('api.open-meteo.com');
        expect(url.searchParams.get('latitude')).toBe('46.09');
        expect(result).toMatchObject({ location: 'Moncton, Canada', temperature: 6.5, temperatureUnit: '°C', windSpeed: 8, weatherCode: 3, source: 'Open-Meteo' });
        expect(result.attribution).toContain('GeoNames');
    });

    it('uses coordinates at valid boundaries without geocoding', async () => {
        const fetch = vi.fn().mockResolvedValue(response(weather()));
        expect(await run({ latitude: -90, longitude: 180 }, fetch)).toMatchObject({ latitude: -90, longitude: 180 });
        expect(fetch).toHaveBeenCalledOnce();
    });

    it.each([null, [], {}, { location: 'x' }, { location: 'x'.repeat(201) }, { latitude: 91, longitude: 0 },
        { latitude: 0, longitude: -181 }, { latitude: '1', longitude: 1 }, { latitude: null, longitude: 1 },
        { latitude: NaN, longitude: Infinity }, { latitude: 1 }, { location: 'Paris', unit: 'invalid' }])('rejects invalid input without network: %j', async args => {
        const fetch = vi.fn();
        expect(await run(args, fetch)).toHaveProperty('error');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('supports explicitly requested Fahrenheit and validates returned units', async () => {
        const data = weather();
        data.current.temperature_2m = 44;
        data.current_units.temperature_2m = '°F';
        data.current_units.apparent_temperature = '°F';
        const fetch = vi.fn().mockResolvedValue(response(data));
        expect(await run({ latitude: 0, longitude: 0, unit: 'fahrenheit' }, fetch)).toMatchObject({ temperature: 44, temperatureUnit: '°F' });
        expect(fetch.mock.calls[0][0]).toContain('temperature_unit=fahrenheit');
    });

    it('never invents fallback values for no location, denied access or failed service', async () => {
        expect(await run({ location: 'unknown' }, vi.fn().mockResolvedValue(response({ results: [] })))).toHaveProperty('error');
        expect(await run({ latitude: 0, longitude: 0 }, vi.fn().mockRejectedValue(new Error('Network permission denied')))).toEqual({ error: 'Weather unavailable: Network permission denied' });
        expect(await run({ latitude: 0, longitude: 0 }, vi.fn().mockResolvedValue({ ok: false, status: 503 }))).toHaveProperty('error', expect.stringContaining('503'));
    });

    it.each(['temperature', 'units', 'time', 'code', 'wind'])('rejects malformed %s from an untrusted service', async kind => {
        const data = weather();
        if (kind === 'temperature') data.current.temperature_2m = null;
        if (kind === 'units') data.current_units.temperature_2m = 'kelvin';
        if (kind === 'time') data.current.time = null;
        if (kind === 'code') data.current.weather_code = 999;
        if (kind === 'wind') data.current.wind_speed_10m = -1;
        expect(await run({ latitude: 0, longitude: 0 }, vi.fn().mockResolvedValue(response(data)))).toHaveProperty('error');
    });
});

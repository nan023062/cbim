import {expect, it} from 'vitest';
import {summarizeUpdaterNetwork} from '../scripts/desktop-update-network-evidence.mjs';

const file = 'CBIM-Setup-0.1.11-x64.exe';
it('counts complete ranged payloads without redirects, interrupted data, or blockmaps', () => {
  expect(summarizeUpdaterNetwork([
    {file, completed: true, status: 302, bytes: 0},
    {file, completed: true, status: 206, bytes: 20, contentRange: 'bytes 0-19/100'},
    {file, completed: true, status: 206, bytes: 10, contentRange: 'bytes 90-99/100'},
    {file, completed: false, status: 200, bytes: 100},
    {file: file + '.blockmap', completed: true, status: 200, bytes: 300},
  ], file)).toEqual({requests: 2, ranges: 2, fullDownloads: 0, completedPayloadBytes: 30});
});
it('reports full fallback rather than presenting partial ranges as differential success', () => {
  expect(summarizeUpdaterNetwork([{file, completed: true, status: 206, contentRange: 'bytes 0-9/100', bytes: 10}, {file, completed: true, status: 200, bytes: 100}], file)).toMatchObject({ranges: 1, fullDownloads: 1, completedPayloadBytes: 110});
});
it('does not invent byte counts when the response lacks content length', () => {
  expect(summarizeUpdaterNetwork([{file, completed: true, status: 200, bytes: null}], file).completedPayloadBytes).toBeNull();
  expect(summarizeUpdaterNetwork([], file)).toEqual({requests: 0, ranges: 0, fullDownloads: 0, completedPayloadBytes: 0});
});

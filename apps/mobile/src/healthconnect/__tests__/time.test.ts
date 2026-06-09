import { formatParisDateTime, parseServerTimestamp } from '../time';

test('treats server timestamps without timezone as UTC', () => {
  expect(parseServerTimestamp('2026-05-20T21:04:11.228').toISOString()).toBe('2026-05-20T21:04:11.228Z');
});

test('formats server timestamps in Europe Paris time', () => {
  expect(formatParisDateTime('2026-05-20T21:04:11.228')).toContain('23:04');
});

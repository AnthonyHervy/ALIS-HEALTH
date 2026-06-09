import { DEFAULT_API_BASE_URL, normalizeApiBaseUrl } from '../config';

test('defaults to the current Tailscale API endpoint instead of localhost', () => {
  expect(DEFAULT_API_BASE_URL).toBe('http://localhost:8010');
});

test('normalizes server URLs for mobile settings', () => {
  expect(normalizeApiBaseUrl(' http://localhost:8010/ ')).toBe('http://localhost:8010');
});

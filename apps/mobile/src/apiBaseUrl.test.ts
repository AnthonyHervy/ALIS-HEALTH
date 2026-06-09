import {
  InvalidApiBaseUrlError,
  normalizeApiBaseUrl,
  normalizeApiBaseUrlOrFallback
} from './apiBaseUrl';

describe('normalizeApiBaseUrl', () => {
  it('trims whitespace and trailing slashes', () => {
    expect(normalizeApiBaseUrl('  http://localhost:8010///  ')).toBe('http://localhost:8010');
  });

  it('keeps https endpoints valid', () => {
    expect(normalizeApiBaseUrl('https://alis.local/api/')).toBe('https://alis.local/api');
  });

  it('rejects non-http schemes', () => {
    expect(() => normalizeApiBaseUrl('file:///tmp/backend')).toThrow(InvalidApiBaseUrlError);
    expect(() => normalizeApiBaseUrl('javascript:alert(1)')).toThrow('URL API invalide');
  });

  it('rejects empty or malformed values', () => {
    expect(() => normalizeApiBaseUrl('')).toThrow('URL API invalide');
    expect(() => normalizeApiBaseUrl('not a url')).toThrow('URL API invalide');
  });

  it('rejects malformed http and https prefixes', () => {
    expect(() => normalizeApiBaseUrl('http:example.com')).toThrow('URL API invalide');
    expect(() => normalizeApiBaseUrl('https:example.com')).toThrow('URL API invalide');
    expect(() => normalizeApiBaseUrl('http:/example.com')).toThrow('URL API invalide');
    expect(() => normalizeApiBaseUrl('https:/example.com')).toThrow('URL API invalide');
  });

  it('rejects malformed http and https authority forms', () => {
    expect(() => normalizeApiBaseUrl('http:///example.com')).toThrow('URL API invalide');
    expect(() => normalizeApiBaseUrl('http:////example.com')).toThrow('URL API invalide');
    expect(() => normalizeApiBaseUrl('https:///example.com')).toThrow('URL API invalide');
  });

  it('rejects query strings and fragments', () => {
    expect(() => normalizeApiBaseUrl('http://example.com?token=abc')).toThrow('URL API invalide');
    expect(() => normalizeApiBaseUrl('http://example.com#frag')).toThrow('URL API invalide');
  });

  it('falls back to a known good default when a stored value is invalid', () => {
    expect(normalizeApiBaseUrlOrFallback('file:///tmp/backend', 'http://localhost:8010')).toBe('http://localhost:8010');
  });
});

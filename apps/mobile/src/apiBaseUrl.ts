export class InvalidApiBaseUrlError extends Error {
  constructor(value: string) {
    super(`URL API invalide : ${value || 'vide'}. Utilise une URL http:// ou https://.`);
    this.name = 'InvalidApiBaseUrlError';
  }
}

export function normalizeApiBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) {
    throw new InvalidApiBaseUrlError(value);
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch (_error) {
    throw new InvalidApiBaseUrlError(value);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new InvalidApiBaseUrlError(value);
  }

  if (!parsed.host || parsed.search || parsed.hash) {
    throw new InvalidApiBaseUrlError(value);
  }

  if (!trimmed.startsWith(`${parsed.protocol}//${parsed.host}`)) {
    throw new InvalidApiBaseUrlError(value);
  }

  return trimmed;
}

export function normalizeApiBaseUrlOrFallback(value: string | null | undefined, fallback: string): string {
  try {
    return normalizeApiBaseUrl(value || fallback);
  } catch (_error) {
    return normalizeApiBaseUrl(fallback);
  }
}

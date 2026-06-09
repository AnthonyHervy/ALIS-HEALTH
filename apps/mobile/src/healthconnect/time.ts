const SERVER_TIMESTAMP_WITH_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/;

export function parseServerTimestamp(timestamp: string): Date {
  const normalized = SERVER_TIMESTAMP_WITH_ZONE.test(timestamp) ? timestamp : `${timestamp}Z`;
  return new Date(normalized);
}

export function formatParisDateTime(timestamp: string): string {
  const date = parseServerTimestamp(timestamp);
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(date);
}

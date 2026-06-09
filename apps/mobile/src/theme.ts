export const theme = {
  colors: {
    background: '#f6f8fb',
    surface: '#ffffff',
    surfaceMuted: '#f8fafc',
    border: '#dbe5ee',
    borderSoft: '#e2e8f0',
    text: '#0f172a',
    textSoft: '#334155',
    muted: '#64748b',
    brand: '#0f4f65',
    brandAlt: '#0f766e',
    brandSoft: '#e8f5f2',
    success: '#16a34a',
    successSoft: '#f0fdf4',
    warning: '#d97706',
    warningSoft: '#fffbeb',
    danger: '#b91c1c',
    dangerSoft: '#fef2f2',
    info: '#2563eb',
    infoSoft: '#eff6ff',
    neutral: '#64748b',
    neutralSoft: '#f1f5f9'
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20
  },
  radii: {
    sm: 6,
    md: 8,
    lg: 10,
    pill: 999
  }
} as const;

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export type MainTab = 'dashboard' | 'nutrition' | 'coach' | 'config';

export const MAIN_TABS: Array<{ key: MainTab; label: string; icon: string }> = [
  { key: 'dashboard', label: 'Données', icon: '▦' },
  { key: 'nutrition', label: 'Nutrition', icon: '◐' },
  { key: 'coach', label: 'Coaching IA', icon: '✦' },
  { key: 'config', label: 'Paramètres', icon: '⚙' }
];

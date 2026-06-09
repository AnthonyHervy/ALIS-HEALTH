import { MAIN_TABS } from './navigation';

test('defines the bottom navigation labels and icons', () => {
  expect(MAIN_TABS).toEqual([
    { key: 'dashboard', label: 'Données', icon: '▦' },
    { key: 'nutrition', label: 'Nutrition', icon: '◐' },
    { key: 'coach', label: 'Coaching IA', icon: '✦' },
    { key: 'config', label: 'Paramètres', icon: '⚙' }
  ]);
});

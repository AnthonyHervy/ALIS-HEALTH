import { headerTopPadding } from './layout';

describe('headerTopPadding', () => {
  it('keeps the cockpit header below the Android status bar', () => {
    expect(headerTopPadding('android', 24)).toBe(46);
  });

  it('keeps a safe Android fallback when status bar height is missing', () => {
    expect(headerTopPadding('android')).toBe(46);
  });

  it('keeps the existing compact spacing on non-Android platforms', () => {
    expect(headerTopPadding('ios', 24)).toBe(14);
  });
});

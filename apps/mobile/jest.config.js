module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.(ts|tsx)$': ['babel-jest', { presets: ['babel-preset-expo'] }]
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json']
};

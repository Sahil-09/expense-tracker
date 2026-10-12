/** node_modules/jest-expo/jest-preset.js */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/src/**/*.test.ts'],
  // constants/theme.ts imports global.css for the web font vars; Jest only wants the values.
  moduleNameMapper: { '\\.css$': '<rootDir>/src/__mocks__/styleMock.js' },
};
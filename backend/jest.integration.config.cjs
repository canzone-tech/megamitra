module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testMatch: ['<rootDir>/test/**/*.integration-spec.ts'],
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  testEnvironment: 'node',
  // Integration suites boot the complete application and exercise real data services.
  // Keep this deterministic across slower local/CI hosts instead of inheriting Jest's 5s unit-test default.
  testTimeout: 30_000,
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
};

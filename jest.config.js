module.exports = {
  testEnvironment: 'node',
  testMatch: [
    '**/__tests__/**/*.test.js',
    '**/?(*.)+(spec|test).js'
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/__tests__/setup.js',
    '/__tests__/utils/',
    '/__tests__/fixtures/',
    '/__tests__/README.md',
    '/__tests__/test-env.js'
  ],
  collectCoverageFrom: [
    'lib/**/*.js',
    'bin/**/*.js',
    '!**/node_modules/**',
    '!**/__tests__/**',
    '!**/coverage/**'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: [
    'text',
    'lcov',
    'html'
  ],
  setupFilesAfterEnv: ['<rootDir>/__tests__/setup.js'],
  testTimeout: 30000, // Increased for integration tests
  verbose: true,
  // Separate test suites for unit and integration tests
  projects: [
    {
      displayName: 'unit',
      testMatch: ['<rootDir>/__tests__/**/*.test.js'],
      testPathIgnorePatterns: [
        '/node_modules/',
        '/__tests__/setup.js',
        '/__tests__/utils/',
        '/__tests__/fixtures/',
        '/__tests__/README.md',
        '/__tests__/test-env.js',
        '/__tests__/stripe-integration.test.js'
      ]
    },
    {
      displayName: 'integration',
      testMatch: ['<rootDir>/__tests__/stripe-integration.test.js'],
      setupFilesAfterEnv: ['<rootDir>/__tests__/setup.js']
    }
  ]
};

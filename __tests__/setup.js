// Test setup file
const nock = require('nock');

// Mock console methods to avoid noise in tests
global.console = {
  ...console,
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
};

// Clean up after each test
afterEach(() => {
  nock.cleanAll();
  jest.clearAllMocks();
});

// Global test timeout
jest.setTimeout(10000);

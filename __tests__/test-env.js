/**
 * Test Environment Configuration
 * 
 * This file handles test environment setup and validation
 * for Stripe API integration tests.
 */

const fs = require('fs');
const path = require('path');

/**
 * Test environment configuration
 */
const testEnv = {
  // Stripe test keys - check environment first, then profile
  stripeTestKey: process.env.STRIPE_TEST_KEY || process.env.STRIPE_SECRET_KEY,
  testProfile: null, // Will be determined from .profile file
  
  // Test data paths
  testDataDir: path.join(__dirname, 'fixtures'),
  
  // Test account configuration
  testAccount: {
    type: 'express',
    country: 'US',
    email: 'test@stripe-cli.example.com'
  },
  
  // Test card data
  testCards: {
    valid: [
      { number: '4242424242424242', brand: 'visa', exp: '12/25' },
      { number: '5555555555554444', brand: 'mastercard', exp: '06/26' },
      { number: '378282246310005', brand: 'amex', exp: '12/25' },
      { number: '6011111111111117', brand: 'discover', exp: '06/26' }
    ],
    declined: [
      { number: '4000000000000002', reason: 'generic_decline' },
      { number: '4000000000000069', reason: 'expired_card' },
      { number: '4000000000000119', reason: 'processing_error' },
      { number: '4000000000000127', reason: 'incorrect_cvc' }
    ]
  },
  
  // Test timeouts
  timeouts: {
    short: 10000,    // 10 seconds
    medium: 20000,   // 20 seconds
    long: 30000      // 30 seconds
  }
};

/**
 * Gets the test key from profile or environment
 * @returns {string|null} Test key or null if not found
 */
function getTestKey() {
  // First try environment variables
  if (testEnv.stripeTestKey && !testEnv.stripeTestKey.includes('sk_test_your_')) {
    return testEnv.stripeTestKey;
  }

  // Try to get key from test profile
  try {
    const ProfileManager = require('../lib/profile-manager');
    const profileManager = new ProfileManager();
    profileManager.loadProfiles();
    
    // Get the test profile name from the global section
    const testProfileName = profileManager.getGlobalSetting('test_profile');
    
    if (testProfileName) {
      const testKey = profileManager.getProfileKey(testProfileName);
      if (testKey && !testKey.includes('sk_test_your_')) {
        return testKey;
      }
    }
  } catch (error) {
    // Profile not found or error loading, continue to other checks
  }

  return null;
}

/**
 * Validates if integration tests should run
 * @returns {boolean} True if integration tests should run
 */
function shouldRunIntegrationTests() {
  const testKey = getTestKey();
  
  if (!testKey) {
    console.log('⚠️  No Stripe test key found.');
    console.log('   Options:');
    console.log('   1. Set STRIPE_TEST_KEY environment variable');
    console.log('   2. Add test_profile=profile_name to [global] section in .profile file');
    console.log('   3. Ensure the specified profile exists with a valid test key');
    return false;
  }
  
  if (testKey.includes('sk_test_your_') || 
      testKey.includes('your_test_key')) {
    console.log('⚠️  Placeholder test key detected. Please set a real test key.');
    return false;
  }
  
  if (!testKey.startsWith('sk_test_') && !testKey.startsWith('rk_test_')) {
    console.log('⚠️  Test key should start with "sk_test_" or "rk_test_". Using live key in tests is not recommended.');
    return false;
  }
  
  return true;
}

/**
 * Creates a test CSV file with valid card data
 * @param {string} filename - Name of the CSV file
 * @param {Array} cards - Array of card objects
 * @returns {string} Path to the created CSV file
 */
function createTestCsvFile(filename = 'test_cards.csv', cards = testEnv.testCards.valid) {
  const csvPath = path.join(__dirname, filename);
  
  const csvHeader = 'card,exp,first,last,zip,token\n';
  const csvRows = cards.map(card => 
    `${card.number},${card.exp},John,Doe,12345,`
  ).join('\n');
  
  const csvContent = csvHeader + csvRows;
  fs.writeFileSync(csvPath, csvContent);
  
  return csvPath;
}

/**
 * Creates a test profile file
 * @param {string} filename - Name of the profile file
 * @returns {string} Path to the created profile file
 */
function createTestProfileFile(filename = 'test.profile') {
  const profilePath = path.join(__dirname, filename);
  
  const profileContent = `[default]
profile=test

[test]
key=${testEnv.stripeTestKey}
description=Test environment for integration tests

[invalid]
key=sk_test_invalid_key_12345
description=Invalid key for testing error handling
`;
  
  fs.writeFileSync(profilePath, profileContent);
  return profilePath;
}

/**
 * Cleans up test files
 * @param {Array} filePaths - Array of file paths to clean up
 */
function cleanupTestFiles(filePaths) {
  filePaths.forEach(filePath => {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  });
}

/**
 * Waits for a specified amount of time
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise} Promise that resolves after the specified time
 */
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retries a function with exponential backoff
 * @param {Function} fn - Function to retry
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} baseDelay - Base delay in milliseconds
 * @returns {Promise} Promise that resolves with the function result
 */
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
  let lastError;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (i === maxRetries - 1) {
        throw lastError;
      }
      
      const delay = baseDelay * Math.pow(2, i);
      await wait(delay);
    }
  }
}

/**
 * Validates Stripe API key format
 * @param {string} key - API key to validate
 * @returns {boolean} True if key format is valid
 */
function validateStripeKey(key) {
  if (!key) return false;
  if (!key.startsWith('sk_test_') && !key.startsWith('sk_live_') && !key.startsWith('rk_')) {
    return false;
  }
  return key.length > 20; // Basic length check
}

/**
 * Gets test environment info
 * @returns {Object} Test environment information
 */
function getTestEnvInfo() {
  return {
    hasTestKey: !!testEnv.stripeTestKey,
    keyFormat: testEnv.stripeTestKey ? testEnv.stripeTestKey.substring(0, 10) + '...' : 'none',
    shouldRunIntegration: shouldRunIntegrationTests(),
    testDataDir: testEnv.testDataDir,
    timeouts: testEnv.timeouts
  };
}

module.exports = {
  testEnv,
  getTestKey,
  shouldRunIntegrationTests,
  createTestCsvFile,
  createTestProfileFile,
  cleanupTestFiles,
  wait,
  retryWithBackoff,
  validateStripeKey,
  getTestEnvInfo
};

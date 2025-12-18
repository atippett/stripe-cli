const fs = require('fs');
const path = require('path');

/**
 * Creates a temporary CSV file for testing
 * @param {string} content - CSV content
 * @param {string} filename - Optional filename
 * @returns {string} - Path to the temporary file
 */
function createTempCsvFile(content, filename = 'temp_test.csv') {
  const tempPath = path.join(process.cwd(), 'tmp', filename);
  fs.writeFileSync(tempPath, content);
  return tempPath;
}

/**
 * Removes a temporary file
 * @param {string} filePath - Path to the file to remove
 */
function removeTempFile(filePath) {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

/**
 * Creates a temporary profile file for testing
 * @param {string} content - Profile content
 * @param {string} filename - Optional filename
 * @returns {string} - Path to the temporary file
 */
function createTempProfileFile(content, filename = 'temp_test.profile') {
  const tempPath = path.join(process.cwd(), 'tmp', filename);
  fs.writeFileSync(tempPath, content);
  return tempPath;
}

/**
 * Valid test card data
 */
const testCardData = {
  valid: [
    {
      card: '4242424242424242',
      exp: '12/25',
      first: 'John',
      last: 'Doe',
      zip: '12345',
      token: ''
    },
    {
      card: '5555555555554444',
      exp: '0626',
      first: 'Jane',
      last: 'Smith',
      zip: '67890',
      token: ''
    },
    {
      card: '4000000000000002',
      exp: '03/27',
      first: '',
      last: '',
      zip: '54321',
      token: ''
    }
  ],
  invalid: [
    {
      card: '1234567890123456', // Invalid Luhn
      exp: '12/25',
      first: 'John',
      last: 'Doe',
      zip: '12345',
      token: ''
    },
    {
      card: '4242424242424242',
      exp: '13/25', // Invalid month
      first: 'Jane',
      last: 'Smith',
      zip: '67890',
      token: ''
    },
    {
      card: '4242424242424242',
      exp: '12/20', // Past date
      first: 'Bob',
      last: 'Johnson',
      zip: '54321',
      token: ''
    }
  ]
};

/**
 * Valid profile data
 */
const testProfileData = {
  valid: `[default]
profile=development

[development]
key=sk_test_1234567890abcdef
description=Development environment

[production]
key=sk_live_1234567890abcdef
description=Production environment`,

  invalid: `[default]
profile=development

[development]
key=invalid_key_format
description=Development environment`
};

/**
 * Mock Stripe responses
 */
const mockStripeResponses = {
  success: {
    id: 'tok_test1234567890abcdef',
    card: {
      id: 'card_test1234567890abcdef',
      brand: 'visa',
      last4: '4242',
      exp_month: 12,
      exp_year: 2025
    }
  },
  error: {
    type: 'StripeAPIError',
    message: 'Invalid card number'
  }
};

module.exports = {
  createTempCsvFile,
  removeTempFile,
  createTempProfileFile,
  testCardData,
  testProfileData,
  mockStripeResponses
};

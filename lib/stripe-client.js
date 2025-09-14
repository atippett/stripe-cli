const Stripe = require('stripe');
const ProfileManager = require('./profile-manager');

/**
 * Creates and configures a Stripe client instance
 * @param {string} secretKey - Stripe secret key
 * @returns {Stripe} Configured Stripe client
 */
function createStripeClient(secretKey) {
  if (!secretKey) {
    throw new Error('Stripe secret key is required. Provide it via --key option, --profile option, or STRIPE_SECRET_KEY environment variable.');
  }

  if (!secretKey.startsWith('sk_') && !secretKey.startsWith('rk_')) {
    throw new Error('Invalid Stripe API key format. Keys should start with "sk_" (secret key) or "rk_" (restricted key).');
  }

  return new Stripe(secretKey, {
    apiVersion: '2023-10-16',
  });
}

/**
 * Gets the Stripe secret key from options, profile, or environment
 * @param {Object} options - Command options
 * @returns {string} Stripe secret key
 */
function getStripeKey(options) {
  // Priority: --key option > --profile option > environment variable
  if (options.key) {
    return options.key;
  }

  if (options.profile) {
    try {
      const profileManager = new ProfileManager();
      profileManager.loadProfiles();
      return profileManager.getProfileKey(options.profile);
    } catch (error) {
      throw new Error(`Profile error: ${error.message}`);
    }
  }

  // Try to use default profile if no explicit key or profile specified
  try {
    const profileManager = new ProfileManager();
    profileManager.loadProfiles();
    return profileManager.getProfileKey(); // Uses default profile
  } catch (error) {
    // If profile loading fails, fall back to environment variable
    return process.env.STRIPE_SECRET_KEY;
  }
}

module.exports = {
  createStripeClient,
  getStripeKey
};

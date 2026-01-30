const Stripe = require('stripe');
const ProfileManager = require('./profile-manager');
const { validateKeyForCommand } = require('./config-loader');

/**
 * Creates and configures a Stripe client instance
 * @param {string} secretKey - Stripe secret key
 * @returns {Stripe} Configured Stripe client
 */
function createStripeClient(secretKey) {
  if (!secretKey) {
    throw new Error('Stripe secret key is required. Provide it via --key option, --platform option, or STRIPE_SECRET_KEY environment variable.');
  }

  if (!secretKey.startsWith('sk_') && !secretKey.startsWith('rk_')) {
    throw new Error('Invalid Stripe API key format. Keys should start with "sk_" (secret key) or "rk_" (restricted key).');
  }

  return new Stripe(secretKey, {
    apiVersion: '2023-10-16',
  });
}

/**
 * Detects the environment based on key patterns or explicit option
 * @param {Object} options - Command options
 * @returns {string} Environment: 'test' or 'prod'
 */
function detectEnvironment(options) {
  // Check for explicit environment option
  if (options.environment) {
    return options.environment;
  }
  
  // Check for test flag
  if (options.test) {
    return 'test';
  }
  
  // Platform name ending with -test or -uat implies test environment (e.g. daysmart-test, vet-uat)
  const platform = String(options.platform || '').toLowerCase();
  if (platform && (platform.endsWith('-test') || platform.endsWith('-uat'))) {
    return 'test';
  }
  // Platform config can set mode: "test" explicitly
  if (options.platform) {
    try {
      const { getPlatformConfig } = require('./config-loader');
      const config = getPlatformConfig(options.platform);
      if (config && config.mode === 'test') {
        return 'test';
      }
    } catch (_) { /* ignore */ }
  }
  
  // Default to prod
  return 'prod';
}

/**
 * Gets the Stripe secret key from options, profile, or environment
 * @param {Object} options - Command options
 * @param {string} commandPath - Optional command path for key type validation
 * @returns {string} Stripe secret key
 */
function getStripeKey(options, commandPath = null) {
  // Priority: --key option > --platform option > environment variable
  if (options.key) {
    const key = options.key;
    // Validate key type if command path is provided
    if (commandPath) {
      return validateKeyForCommand(key, commandPath);
    }
    return key;
  }

  if (options.platform) {
    try {
      const profileManager = new ProfileManager();
      profileManager.loadProfiles();
      
      const environment = detectEnvironment(options);
      let key;
      const platform = options.platform;
      const tryBaseProfile = /-(uat|test)$/i.test(platform);

      if (commandPath) {
        const { getRequiredKeyType } = require('./config-loader');
        const requiredKeyType = getRequiredKeyType(commandPath);
        try {
          key = profileManager.getProfileKeyByType(platform, requiredKeyType, environment);
        } catch (profileErr) {
          if (tryBaseProfile && profileErr.message.includes('not found')) {
            const basePlatform = platform.replace(/-uat$|-test$/i, '');
            key = profileManager.getProfileKeyByType(basePlatform, requiredKeyType, 'test');
          } else {
            throw profileErr;
          }
        }
        if (!key) {
          throw new Error(
            `Profile '${platform}' has no ${requiredKeyType} key configured for ${environment} environment. ` +
            `Command '${commandPath}' requires a ${requiredKeyType} key. ` +
            `Add ${environment === 'test' ? 'test_' : ''}${requiredKeyType}_key to the [${platform}] section in .secrets, or use --key.`
          );
        }
      } else {
        try {
          key = profileManager.getProfileKey(platform);
        } catch (profileErr) {
          if (tryBaseProfile && profileErr.message.includes('not found')) {
            const basePlatform = platform.replace(/-uat$|-test$/i, '');
            key = profileManager.getProfileKeyByType(basePlatform, 'restricted', 'test') || profileManager.getProfileKey(basePlatform);
          } else {
            throw profileErr;
          }
        }
        if (!key) {
          throw new Error(
            `Profile '${platform}' has no API key in .secrets. ` +
            `Add restricted_key or secret_key to the [${platform}] section, or use --key.`
          );
        }
      }
      return key;
    } catch (error) {
      throw new Error(`Profile error: ${error.message}`);
    }
  }

  // Try to use default profile if no explicit key or profile specified
  let key;
  try {
    const profileManager = new ProfileManager();
    profileManager.loadProfiles();
    
    const environment = detectEnvironment(options);
    if (commandPath) {
      // Get the appropriate key type based on command requirements
      const { getRequiredKeyType } = require('./config-loader');
      const requiredKeyType = getRequiredKeyType(commandPath);
      key = profileManager.getProfileKeyByType(null, requiredKeyType, environment); // null uses default profile
      
      if (!key) {
        // Fall back to environment variable
        key = process.env.STRIPE_SECRET_KEY;
      }
    } else {
      // No command path, use backward compatibility method
      key = profileManager.getProfileKey(); // Uses default profile
    }
  } catch (error) {
    // If profile loading fails, fall back to environment variable
    key = process.env.STRIPE_SECRET_KEY;
  }
  
  return key;
}

module.exports = {
  createStripeClient,
  getStripeKey,
  detectEnvironment
};

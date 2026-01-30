const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

/**
 * Loads command requirements configuration from YAML file
 * @returns {Object} Configuration object with commands and their key requirements
 */
function loadCommandRequirements() {
  const configPath = path.join(__dirname, '..', 'config.yml');
  
  try {
    if (!fs.existsSync(configPath)) {
      // Return default configuration if file doesn't exist
      return {
        commands: {}
      };
    }
    
    const fileContents = fs.readFileSync(configPath, 'utf8');
    const config = yaml.load(fileContents);
    
                return {
                  commands: config.commands || {},
                  platform: config.platform || {},
                  global: config.global || {}
                };
  } catch (error) {
    console.warn(`Warning: Could not load command requirements config: ${error.message}`);
    // Return default configuration on error
    return {
      commands: {},
      platform: {},
      global: {}
    };
  }
}

/**
 * Determines the required key type for a given command path
 * @param {string} commandPath - The command path (e.g., "account.settings.network-costs.enable")
 * @returns {string} The required key type: "secret" or "restricted"
 */
function getRequiredKeyType(commandPath) {
  const config = loadCommandRequirements();
  
  // Check if command is explicitly configured
  if (config.commands[commandPath] && config.commands[commandPath].key) {
    return config.commands[commandPath].key;
  }
  
  // Default to restricted key for all other commands
  return 'restricted';
}

/**
 * Gets the test environment for a given command path
 * @param {string} commandPath - The command path (e.g., "account.settings.network-costs.enable")
 * @returns {string} The test environment: "test" or "prod" (defaults to "test")
 */
function getCommandTestEnvironment(commandPath) {
  const config = loadCommandRequirements();
  
  // Check if command is explicitly configured with test_env
  if (config.commands[commandPath] && config.commands[commandPath].test_env) {
    return config.commands[commandPath].test_env;
  }
  
  // Default to test environment for all other commands
  return 'test';
}

/**
 * Validates that the provided key type matches the command requirement
 * @param {string} key - The API key
 * @param {string} commandPath - The command path
 * @throws {Error} If key type doesn't match command requirement
 */
function validateKeyForCommand(key, commandPath) {
  const requiredKeyType = getRequiredKeyType(commandPath);
  
  const isSecretKey = key.startsWith('sk_');
  const isRestrictedKey = key.startsWith('rk_');
  
  if (requiredKeyType === 'secret' && !isSecretKey) {
    throw new Error(
      `Command '${commandPath}' requires a secret key (sk_*), but a restricted key (rk_*) was provided. ` +
      `Please use a secret key for this command.`
    );
  }
  
  if (requiredKeyType === 'restricted' && !isRestrictedKey) {
    throw new Error(
      `Command '${commandPath}' requires a restricted key (rk_*), but a secret key (sk_*) was provided. ` +
      `Please use a restricted key for this command.`
    );
  }
  
  return key;
}

/**
 * Gets a user-friendly description of key requirements for a command
 * @param {string} commandPath - The command path
 * @returns {string} Description of key requirements
 */
function getKeyRequirementDescription(commandPath) {
  const requiredKeyType = getRequiredKeyType(commandPath);
  
  switch (requiredKeyType) {
    case 'secret':
      return 'Requires secret key (sk_*)';
    case 'restricted':
      return 'Requires restricted key (rk_*)';
    default:
      return 'Key type not specified';
  }
}

/**
 * Gets platform configuration for a given platform name
 * @param {string} platformName - The platform name (e.g., "vet", "daysmart")
 * @returns {Object|null} Platform configuration or null if not found
 */
function getPlatformConfig(platformName) {
  const config = loadCommandRequirements();
  return config.platform[platformName] || null;
}

/**
 * Gets the account ID for a given platform
 * If the platform has no account (e.g. vet-uat), inherits from base platform (vet)
 * @param {string} platformName - The platform name
 * @returns {string|null} Account ID or null if not found
 */
function getPlatformAccount(platformName) {
  const platformConfig = getPlatformConfig(platformName);
  if (platformConfig && platformConfig.account) {
    return platformConfig.account;
  }
  // Inherit from base platform when this entry has no account (e.g. vet-uat → vet)
  if (platformName && platformName.includes('-')) {
    const baseName = platformName.split('-')[0];
    return getPlatformAccount(baseName);
  }
  return null;
}

/**
 * Gets the test connected account ID for a given platform
 * Supports: mode: "test" + connected_account, test_connected_account, or testing.connected_account
 * @param {string} platformName - The platform name
 * @returns {string|null} Test connected account ID or null if not found
 */
function getPlatformTestConnectedAccount(platformName) {
  const platformConfig = getPlatformConfig(platformName);
  if (!platformConfig) return null;
  
  // New schema: platform with mode "test" has single connected_account for test
  if (platformConfig.mode === 'test' && platformConfig.connected_account) {
    return platformConfig.connected_account;
  }
  // Legacy: test_connected_account
  if (platformConfig.test_connected_account) {
    return platformConfig.test_connected_account;
  }
  // Legacy: testing.connected_account
  if (platformConfig.testing && platformConfig.testing.connected_account) {
    return platformConfig.testing.connected_account;
  }
  return null;
}

/**
 * Gets the production connected account ID for a given platform
 * Supports: connected_account when mode is not "test", or prod_connected_account
 * @param {string} platformName - The platform name
 * @returns {string|null} Production connected account ID or null if not found
 */
function getPlatformProdConnectedAccount(platformName) {
  const platformConfig = getPlatformConfig(platformName);
  if (!platformConfig) return null;
  // New schema: platform without mode "test" has single connected_account for prod
  if (platformConfig.mode !== 'test' && platformConfig.connected_account) {
    return platformConfig.connected_account;
  }
  return platformConfig.prod_connected_account || null;
}

/**
 * Gets the testing configuration for a given platform
 * @param {string} platformName - The platform name
 * @returns {Object|null} Testing configuration or null if not found
 */
function getPlatformTestingConfig(platformName) {
  const platformConfig = getPlatformConfig(platformName);
  return platformConfig ? platformConfig.testing || null : null;
}

/**
 * Gets the connected account ID for a given platform based on environment
 * @param {string} platformName - The platform name
 * @param {string} environment - Environment: 'test' or 'prod' (defaults to 'test')
 * @returns {string|null} Connected account ID or null if not found
 */
function getPlatformConnectedAccountByEnvironment(platformName, environment = 'test') {
  if (environment === 'prod') {
    return getPlatformProdConnectedAccount(platformName);
  } else {
    return getPlatformTestConnectedAccount(platformName);
  }
}

/**
 * Gets the connected account ID for testing a specific command
 * @param {string} platformName - The platform name
 * @param {string} commandPath - The command path
 * @returns {string|null} Connected account ID or null if not found
 */
function getPlatformConnectedAccountForCommandTesting(platformName, commandPath) {
  const testEnvironment = getCommandTestEnvironment(commandPath);
  return getPlatformConnectedAccountByEnvironment(platformName, testEnvironment);
}

/**
 * Gets the connected account ID for a given platform (backward compatibility)
 * @param {string} platformName - The platform name
 * @returns {string|null} Connected account ID or null if not found
 * @deprecated Use getPlatformTestConnectedAccount or getPlatformConnectedAccountByEnvironment instead
 */
function getPlatformConnectedAccount(platformName) {
  return getPlatformTestConnectedAccount(platformName);
}

/**
 * Lists all available platforms
 * @returns {Array} Array of platform names
 */
function getAvailablePlatforms() {
  const config = loadCommandRequirements();
  return Object.keys(config.platform);
}

/**
 * Gets global configuration settings
 * @returns {Object} Global configuration object
 */
function getGlobalConfig() {
  const config = loadCommandRequirements();
  return config.global || {};
}

/**
 * Gets the default profile name from global configuration
 * @returns {string|null} Default profile name or null if not configured
 */
function getDefaultProfile() {
  const globalConfig = getGlobalConfig();
  return globalConfig.default_platform || null;
}

/**
 * Gets the test profile name from global configuration
 * @returns {string|null} Test profile name or null if not configured
 */
function getTestProfile() {
  const globalConfig = getGlobalConfig();
  return globalConfig.test_platform || null;
}

module.exports = {
  loadCommandRequirements,
  getRequiredKeyType,
  getCommandTestEnvironment,
  validateKeyForCommand,
  getKeyRequirementDescription,
  getPlatformConfig,
  getPlatformAccount,
  getPlatformConnectedAccount, // Backward compatibility
  getPlatformTestConnectedAccount,
  getPlatformProdConnectedAccount,
  getPlatformConnectedAccountByEnvironment,
  getPlatformConnectedAccountForCommandTesting,
  getPlatformTestingConfig,
  getAvailablePlatforms,
  getGlobalConfig,
  getDefaultProfile,
  getTestProfile
};

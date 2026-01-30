const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

/**
 * Resolve project root (directory containing package.json or bin/stripe-cli)
 * so .secrets is found regardless of current working directory.
 */
function getProjectRoot() {
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    if (dir === path.dirname(dir)) break;
    if (fs.existsSync(path.join(dir, 'package.json')) || fs.existsSync(path.join(dir, 'bin', 'stripe-cli'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return process.cwd();
}

/**
 * Profile Manager for Stripe CLI
 * Handles reading and parsing profile configuration files
 */
class ProfileManager {
  constructor() {
    const root = getProjectRoot();
    this.profilePath = path.join(root, '.secrets');
    this.profiles = {};
    this.defaultProfile = null;
    this.globalSettings = {};
  }

  /**
   * Load profiles from .secrets file
   */
  loadProfiles() {
    if (!fs.existsSync(this.profilePath)) {
      throw new Error(`Secrets file not found: ${this.profilePath}`);
    }

    const content = fs.readFileSync(this.profilePath, 'utf8');
    this.parseProfileContent(content);
    
    // Load default profile from config.yml
    this.loadDefaultProfileFromConfig();
  }

  /**
   * Load default profile from config.yml
   */
  loadDefaultProfileFromConfig() {
    try {
      const { getDefaultProfile } = require('./config-loader');
      this.defaultProfile = getDefaultProfile();
    } catch (error) {
      // If config loading fails, keep the default profile from .profile file
      // This maintains backward compatibility
    }
  }

  /**
   * Parse profile configuration content
   * @param {string} content - Raw profile file content
   */
  parseProfileContent(content) {
    const lines = content.split('\n');
    let currentProfile = null;
    let inGlobalSection = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Skip empty lines and comments
      if (!line || line.startsWith('#')) {
        continue;
      }

      // Check for profile section headers
      if (line.startsWith('[') && line.endsWith(']')) {
        const profileName = line.slice(1, -1).trim();
        
        if (profileName === 'global') {
          // Skip global section - we get this from config.yml now
          inGlobalSection = true;
          currentProfile = null;
        } else {
          inGlobalSection = false;
          currentProfile = profileName;
          this.profiles[profileName] = {
            name: profileName,
            key: null, // For backward compatibility
            restricted_key: null,
            secret_key: null,
            public_key: null,
            test_restricted_key: null,
            test_secret_key: null,
            test_public_key: null,
            description: null
          };
        }
        continue;
      }

      // Parse key-value pairs
      const equalIndex = line.indexOf('=');
      if (equalIndex === -1) continue;

      const key = line.substring(0, equalIndex).trim();
      const value = line.substring(equalIndex + 1).trim();

      if (inGlobalSection) {
        this.globalSettings[key] = value;
        if (key === 'profile') {
          this.defaultProfile = value;
        }
      } else if (currentProfile && this.profiles[currentProfile]) {
        // Handle test_ prefixed keys
        if (key.startsWith('test_')) {
          const baseKey = key.substring(5); // Remove 'test_' prefix
          if (baseKey === 'public_key') {
            this.profiles[currentProfile].test_public_key = value;
          } else if (baseKey === 'restricted_key') {
            this.profiles[currentProfile].test_restricted_key = value;
          } else if (baseKey === 'secret_key') {
            this.profiles[currentProfile].test_secret_key = value;
          }
        } else {
          // Handle regular keys (backward compatibility)
          if (key === 'key') {
            this.profiles[currentProfile].key = value;
          } else if (key === 'restricted_key') {
            this.profiles[currentProfile].restricted_key = value;
          } else if (key === 'secret_key') {
            this.profiles[currentProfile].secret_key = value;
          } else if (key === 'description') {
            this.profiles[currentProfile].description = value;
          } else if (key === 'account') {
            this.profiles[currentProfile].account = value;
          } else if (key === 'connected_account') {
            this.profiles[currentProfile].connected_account = value;
          } else if (key === 'public_key') {
            this.profiles[currentProfile].public_key = value;
          }
        }
      }
    }

    // Validate that default profile exists
    if (this.defaultProfile && !this.profiles[this.defaultProfile]) {
      throw new Error(`Default profile '${this.defaultProfile}' not found in profiles`);
    }
  }

  /**
   * Get API key for a specific profile (backward compatibility)
   * @param {string} profileName - Name of the profile
   * @returns {string} API key
   */
  getProfileKey(profileName) {
    // For backward compatibility, try restricted_key first, then fall back to key
    const profile = this.getProfile(profileName);
    return profile.restricted_key || profile.key || null;
  }

  /**
   * Get the appropriate API key for a specific profile and key type
   * @param {string} profileName - Name of the profile
   * @param {string} keyType - Type of key needed: 'secret' or 'restricted'
   * @param {string} environment - Environment: 'test' or 'prod' (defaults to 'prod')
   * @returns {string} API key
   */
  getProfileKeyByType(profileName, keyType, environment = 'prod') {
    const profile = this.getProfile(profileName);
    // -uat / -test profiles use unprefixed keys (restricted_key, secret_key) in their section
    const isUatOrTestProfile = /-(uat|test)$/i.test(profileName);

    if (isUatOrTestProfile) {
      if (keyType === 'secret') return profile.secret_key || null;
      if (keyType === 'restricted') return profile.restricted_key || profile.key || null;
      throw new Error(`Invalid key type: ${keyType}. Must be 'secret' or 'restricted'`);
    }

    if (keyType === 'secret') {
      if (environment === 'test') {
        return profile.test_secret_key || profile.secret_key || null;
      }
      return profile.secret_key || null;
    }
    if (keyType === 'restricted') {
      if (environment === 'test') {
        return profile.test_restricted_key || profile.restricted_key || profile.key || null;
      }
      return profile.restricted_key || profile.key || null;
    }
    throw new Error(`Invalid key type: ${keyType}. Must be 'secret' or 'restricted'`);
  }

  /**
   * Get profile data for a specific profile
   * @param {string} profileName - Name of the profile
   * @returns {Object} Profile data
   */
  getProfile(profileName) {
    if (!profileName) {
      profileName = this.defaultProfile;
    }

    if (!profileName) {
      throw new Error('No profile specified and no default profile configured');
    }

    if (!this.profiles[profileName]) {
      throw new Error(`Profile '${profileName}' not found`);
    }

    return this.profiles[profileName];
  }

  /**
   * Get connected account for a specific profile
   * @param {string} profileName - Name of the profile
   * @param {string} environment - Environment: 'test' or 'prod' (defaults to 'test')
   * @returns {string|null} Connected account ID or null if not configured
   */
  getProfileConnectedAccount(profileName, environment = 'test') {
    if (!profileName) {
      profileName = this.defaultProfile;
    }

    if (!profileName) {
      return null;
    }

    if (!this.profiles[profileName]) {
      return null;
    }

    // First try to get from profile
    const profileConnectedAccount = this.profiles[profileName].connected_account;
    if (profileConnectedAccount) {
      return profileConnectedAccount;
    }

    // Fallback to platform configuration
    try {
      const { getPlatformConnectedAccountByEnvironment } = require('./config-loader');
      const platformName = this.extractPlatformFromProfileName(profileName);
      if (platformName) {
        return getPlatformConnectedAccountByEnvironment(platformName, environment);
      }
    } catch (error) {
      // Ignore errors and return null
    }

    return null;
  }

  /**
   * Get connected account for testing a specific command
   * @param {string} profileName - Name of the profile
   * @param {string} commandPath - The command path
   * @returns {string|null} Connected account ID or null if not configured
   */
  getProfileConnectedAccountForCommandTesting(profileName, commandPath) {
    if (!profileName) {
      profileName = this.defaultProfile;
    }

    if (!profileName) {
      return null;
    }

    if (!this.profiles[profileName]) {
      return null;
    }

    // First try to get from profile
    const profileConnectedAccount = this.profiles[profileName].connected_account;
    if (profileConnectedAccount) {
      return profileConnectedAccount;
    }

    // Fallback to platform configuration using command-specific test environment
    try {
      const { getPlatformConnectedAccountForCommandTesting } = require('./config-loader');
      const platformName = this.extractPlatformFromProfileName(profileName);
      if (platformName) {
        return getPlatformConnectedAccountForCommandTesting(platformName, commandPath);
      }
    } catch (error) {
      // Ignore errors and return null
    }

    return null;
  }

  /**
   * Get account for a specific profile
   * @param {string} profileName - Name of the profile
   * @returns {string|null} Account ID or null if not configured
   */
  getProfileAccount(profileName) {
    if (!profileName) {
      profileName = this.defaultProfile;
    }

    if (!profileName) {
      return null;
    }

    if (!this.profiles[profileName]) {
      return null;
    }

    // First try to get from profile
    const profileAccount = this.profiles[profileName].account;
    if (profileAccount) {
      return profileAccount;
    }

    // Fallback to platform configuration
    try {
      const { getPlatformAccount } = require('./config-loader');
      const platformName = this.extractPlatformFromProfileName(profileName);
      if (platformName) {
        return getPlatformAccount(platformName);
      }
    } catch (error) {
      // Ignore errors and return null
    }

    return null;
  }

  /**
   * Extract platform name from profile name
   * @param {string} profileName - Profile name (e.g., "vet-test", "vet-prod", "daysmart-test")
   * @returns {string|null} Platform name or null if not found
   */
  extractPlatformFromProfileName(profileName) {
    if (!profileName) return null;
    
    try {
      const { getAvailablePlatforms } = require('./config-loader');
      const availablePlatforms = getAvailablePlatforms();
      // If the full profile name is a platform (e.g. daysmart-test), use it
      if (availablePlatforms.includes(profileName)) {
        return profileName;
      }
      // Otherwise take the first part before hyphen (e.g. daysmart from daysmart-prod)
      const parts = profileName.split('-');
      const platformName = parts[0];
      return availablePlatforms.includes(platformName) ? platformName : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get all available profiles
   * @returns {Object} Object with profile names as keys
   */
  getProfiles() {
    return {
      ...this.profiles,
      global: this.globalSettings
    };
  }

  /**
   * Get global settings
   * @returns {Object} Global settings object
   */
  getGlobalSettings() {
    return this.globalSettings;
  }

  /**
   * Get a specific global setting
   * @param {string} key - Setting key
   * @returns {string|null} Setting value or null if not found
   */
  getGlobalSetting(key) {
    return this.globalSettings[key] || null;
  }

  /**
   * Get default profile name
   * @returns {string|null} Default profile name
   */
  getDefaultProfile() {
    return this.defaultProfile;
  }

  /**
   * List all profiles with their details
   */
  listProfiles() {
    console.log(chalk.blue('Available Profiles:'));
    console.log('');

    if (this.defaultProfile) {
      console.log(chalk.green(`Default: ${this.defaultProfile}`));
      console.log('');
    }

    for (const [name, profile] of Object.entries(this.profiles)) {
      const isDefault = name === this.defaultProfile;
      const prefix = isDefault ? chalk.green('* ') : '  ';
      const keyPreview = profile.key ? `${profile.key.substring(0, 20)}...` : 'No key';
      
      console.log(`${prefix}${chalk.bold(name)}`);
      if (profile.description) {
        console.log(`    Description: ${profile.description}`);
      }
      console.log(`    Key: ${keyPreview}`);
      console.log('');
    }
  }

  /**
   * Validate profile configuration
   */
  validateProfiles() {
    const errors = [];

    if (!this.defaultProfile) {
      errors.push('No default profile configured');
    }

    for (const [name, profile] of Object.entries(this.profiles)) {
      if (!profile.key) {
        errors.push(`Profile '${name}' has no API key`);
      } else if (!profile.key.startsWith('sk_') && !profile.key.startsWith('rk_')) {
        errors.push(`Profile '${name}' has invalid API key format`);
      }
    }

    if (errors.length > 0) {
      throw new Error(`Profile validation failed:\n${errors.join('\n')}`);
    }
  }
}

module.exports = ProfileManager;

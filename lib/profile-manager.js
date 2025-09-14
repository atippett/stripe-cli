const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

/**
 * Profile Manager for Stripe CLI
 * Handles reading and parsing profile configuration files
 */
class ProfileManager {
  constructor() {
    this.profilePath = path.join(process.cwd(), '.profile');
    this.profiles = {};
    this.defaultProfile = null;
  }

  /**
   * Load profiles from .profile file
   */
  loadProfiles() {
    if (!fs.existsSync(this.profilePath)) {
      throw new Error(`Profile file not found: ${this.profilePath}`);
    }

    const content = fs.readFileSync(this.profilePath, 'utf8');
    this.parseProfileContent(content);
  }

  /**
   * Parse profile configuration content
   * @param {string} content - Raw profile file content
   */
  parseProfileContent(content) {
    const lines = content.split('\n');
    let currentProfile = null;
    let inDefaultSection = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Skip empty lines and comments
      if (!line || line.startsWith('#')) {
        continue;
      }

      // Check for profile section headers
      if (line.startsWith('[') && line.endsWith(']')) {
        const profileName = line.slice(1, -1);
        
        if (profileName === 'default') {
          inDefaultSection = true;
          currentProfile = null;
        } else {
          inDefaultSection = false;
          currentProfile = profileName;
          this.profiles[profileName] = {
            name: profileName,
            key: null,
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

      if (inDefaultSection && key === 'profile') {
        this.defaultProfile = value;
      } else if (currentProfile && this.profiles[currentProfile]) {
        if (key === 'key') {
          this.profiles[currentProfile].key = value;
        } else if (key === 'description') {
          this.profiles[currentProfile].description = value;
        }
      }
    }

    // Validate that default profile exists
    if (this.defaultProfile && !this.profiles[this.defaultProfile]) {
      throw new Error(`Default profile '${this.defaultProfile}' not found in profiles`);
    }
  }

  /**
   * Get API key for a specific profile
   * @param {string} profileName - Name of the profile
   * @returns {string} API key
   */
  getProfileKey(profileName) {
    if (!profileName) {
      profileName = this.defaultProfile;
    }

    if (!profileName) {
      throw new Error('No profile specified and no default profile configured');
    }

    if (!this.profiles[profileName]) {
      throw new Error(`Profile '${profileName}' not found`);
    }

    if (!this.profiles[profileName].key) {
      throw new Error(`Profile '${profileName}' has no API key configured`);
    }

    return this.profiles[profileName].key;
  }

  /**
   * Get all available profiles
   * @returns {Object} Object with profile names as keys
   */
  getProfiles() {
    return this.profiles;
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

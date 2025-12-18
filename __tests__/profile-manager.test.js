const fs = require('fs');
const path = require('path');
const ProfileManager = require('../lib/profile-manager');

// Mock the config-loader module
const mockConfigLoader = {
  getDefaultProfile: jest.fn(() => null) // Default to null for most tests
};

jest.mock('../lib/config-loader', () => mockConfigLoader);

describe('ProfileManager', () => {
  let profileManager;
  let testProfileFile;

  beforeEach(() => {
    profileManager = new ProfileManager();
    testProfileFile = path.join(__dirname, 'temp_test.profile');
    
    // Reset the mock to default behavior
    mockConfigLoader.getDefaultProfile.mockReturnValue(null);
  });

  afterEach(() => {
    // Clean up test files
    if (fs.existsSync(testProfileFile)) {
      fs.unlinkSync(testProfileFile);
    }
  });

  describe('Profile Loading', () => {
    test('should load profiles from valid .profile file', () => {
      // Mock the config loader to return 'development' for this test
      mockConfigLoader.getDefaultProfile.mockReturnValue('development');
      
      const profileContent = `[global]
profile=development

[development]
key=sk_test_1234567890abcdef
description=Development environment

[production]
key=sk_live_1234567890abcdef
description=Production environment`;

      fs.writeFileSync(testProfileFile, profileContent);
      profileManager.profilePath = testProfileFile;

      profileManager.loadProfiles();

      expect(profileManager.getDefaultProfile()).toBe('development');
      expect(profileManager.getProfileKey('development')).toBe('sk_test_1234567890abcdef');
      expect(profileManager.getProfileKey('production')).toBe('sk_live_1234567890abcdef');
    });

    test('should handle missing default profile', () => {
      const profileContent = `[development]
key=sk_test_1234567890abcdef
description=Development environment`;

      fs.writeFileSync(testProfileFile, profileContent);
      profileManager.profilePath = testProfileFile;

      profileManager.loadProfiles();

      expect(profileManager.getDefaultProfile()).toBeNull();
    });

    test('should throw error for non-existent profile file', () => {
      profileManager.profilePath = 'nonexistent.profile';

      expect(() => {
        profileManager.loadProfiles();
      }).toThrow('Secrets file not found');
    });
  });

  describe('Profile Key Retrieval', () => {
    beforeEach(() => {
      const profileContent = `[global]
profile=development

[development]
key=sk_test_1234567890abcdef
description=Development environment

[production]
key=sk_live_1234567890abcdef
description=Production environment`;

      fs.writeFileSync(testProfileFile, profileContent);
      profileManager.profilePath = testProfileFile;
      profileManager.loadProfiles();
    });

    test('should get key for specific profile', () => {
      const key = profileManager.getProfileKey('development');
      expect(key).toBe('sk_test_1234567890abcdef');
    });

    test('should get key for default profile when no profile specified', () => {
      // Mock the config loader to return 'development' for this test
      mockConfigLoader.getDefaultProfile.mockReturnValue('development');
      
      // Reload profiles to pick up the mocked default profile
      profileManager.loadProfiles();
      
      const key = profileManager.getProfileKey();
      expect(key).toBe('sk_test_1234567890abcdef');
    });

    test('should throw error for non-existent profile', () => {
      expect(() => {
        profileManager.getProfileKey('nonexistent');
      }).toThrow("Profile 'nonexistent' not found");
    });

    test('should return null for profile without key', () => {
      const profileContent = `[global]
profile=development

[development]
description=Development environment without key`;

      fs.writeFileSync(testProfileFile, profileContent);
      profileManager.profilePath = testProfileFile;
      profileManager.loadProfiles();

      const key = profileManager.getProfileKey('development');
      expect(key).toBeNull();
    });
  });

  describe('Profile Validation', () => {
    test('should validate profiles with valid keys', () => {
      // Mock the config loader to return 'development' for this test
      mockConfigLoader.getDefaultProfile.mockReturnValue('development');
      
      const profileContent = `[global]
profile=development

[development]
key=sk_test_1234567890abcdef
description=Development environment

[production]
key=sk_live_1234567890abcdef
description=Production environment`;

      fs.writeFileSync(testProfileFile, profileContent);
      profileManager.profilePath = testProfileFile;
      profileManager.loadProfiles();

      expect(() => {
        profileManager.validateProfiles();
      }).not.toThrow();
    });

    test('should throw error for invalid API key format', () => {
      const profileContent = `[global]
profile=development

[development]
key=invalid_key_format
description=Development environment`;

      fs.writeFileSync(testProfileFile, profileContent);
      profileManager.profilePath = testProfileFile;
      profileManager.loadProfiles();

      expect(() => {
        profileManager.validateProfiles();
      }).toThrow('Profile validation failed');
    });

    test('should throw error for missing default profile', () => {
      const profileContent = `[development]
key=sk_test_1234567890abcdef
description=Development environment`;

      fs.writeFileSync(testProfileFile, profileContent);
      profileManager.profilePath = testProfileFile;
      profileManager.loadProfiles();

      expect(() => {
        profileManager.validateProfiles();
      }).toThrow('Profile validation failed');
    });
  });

  describe('Profile Listing', () => {
    test('should list all profiles correctly', () => {
      const profileContent = `[global]
profile=development

[development]
key=sk_test_1234567890abcdef
description=Development environment

[production]
key=sk_live_1234567890abcdef
description=Production environment`;

      fs.writeFileSync(testProfileFile, profileContent);
      profileManager.profilePath = testProfileFile;
      profileManager.loadProfiles();

      // Mock console.log to capture output
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      profileManager.listProfiles();

      expect(consoleSpy).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Available Profiles:'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('development'));

      consoleSpy.mockRestore();
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty profile file', () => {
      // Mock the config loader to return 'vet' for this test
      mockConfigLoader.getDefaultProfile.mockReturnValue('vet');
      
      fs.writeFileSync(testProfileFile, '');
      profileManager.profilePath = testProfileFile;

      profileManager.loadProfiles();

      expect(profileManager.getProfiles()).toEqual({ global: {} });
      expect(profileManager.getDefaultProfile()).toBe('vet'); // Now comes from config.yml
    });

    test('should handle profile file with only comments', () => {
      // Mock the config loader to return 'development' for this test
      mockConfigLoader.getDefaultProfile.mockReturnValue('development');
      
      const profileContent = `# This is a comment
# Another comment
[global]
profile=development

[development]
key=sk_test_1234567890abcdef
description=Development environment`;

      fs.writeFileSync(testProfileFile, profileContent);
      profileManager.profilePath = testProfileFile;

      profileManager.loadProfiles();

      expect(profileManager.getDefaultProfile()).toBe('development');
      expect(profileManager.getProfileKey('development')).toBe('sk_test_1234567890abcdef');
    });

    test('should handle profiles with empty values', () => {
      const profileContent = `[global]
profile=development

[development]
key=sk_test_1234567890abcdef
description=

[production]
key=
description=Production environment`;

      fs.writeFileSync(testProfileFile, profileContent);
      profileManager.profilePath = testProfileFile;

      profileManager.loadProfiles();

      expect(profileManager.getProfileKey('development')).toBe('sk_test_1234567890abcdef');
      expect(profileManager.getProfileKey('production')).toBeNull();
    });
  });
});

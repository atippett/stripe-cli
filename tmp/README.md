# Temporary Files Directory

This directory is used for temporary files generated during testing and development.

## Purpose

- **Unit Tests**: Temporary CSV files created during card import tests
- **Integration Tests**: Test data files for Stripe API integration tests
- **Development**: Temporary output files and cache data

## Files

All files in this directory are temporary and should not be committed to version control. The `.gitignore` file is configured to ignore all files in this directory except for this README.

## Cleanup

Files in this directory are automatically cleaned up after tests complete. You can manually clean the directory with:

```bash
rm -rf tmp/*
```

## Structure

```
tmp/
├── README.md          # This file (committed to git)
├── temp_*.csv         # Temporary CSV files (ignored by git)
├── temp_*.profile     # Temporary profile files (ignored by git)
└── imported_cards_*.csv # Card import output files (ignored by git)
```

## Notes

- This directory is created automatically if it doesn't exist
- All temporary files are prefixed with `temp_` for easy identification
- Files are automatically removed after test completion
- The directory structure is preserved for organization

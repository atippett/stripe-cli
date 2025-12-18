# Change Impact Checklist

When making significant changes to the codebase, use this checklist to ensure all related files are updated.

## Command Structure Changes
When changing CLI commands (e.g., `cards import` → `account.import.card`):

- [ ] Update command definitions in `bin/stripe-cli.js`
- [ ] Update all test files that reference the old command
- [ ] Update documentation files (README.md, AGENTS.md, etc.)
- [ ] Update help text and descriptions
- [ ] Update integration tests
- [ ] Update any scripts or CI/CD that use the commands
- [ ] Update examples in documentation

## Configuration Changes
When changing configuration structure (e.g., `.profile` → `.secrets`, `[default]` → `[global]`):

- [ ] Update configuration loading code
- [ ] Update all tests that create test configuration files
- [ ] Update documentation about configuration
- [ ] Update example configuration files
- [ ] Update any scripts that read configuration

## API Changes
When changing function signatures or module exports:

- [ ] Update all files that import/use the changed functions
- [ ] Update tests that mock or call the functions
- [ ] Update documentation about the API
- [ ] Update type definitions if using TypeScript

## File Structure Changes
When moving or renaming files:

- [ ] Update all import statements
- [ ] Update test file paths
- [ ] Update documentation references
- [ ] Update CI/CD file paths
- [ ] Update any scripts that reference the files

## Environment Variable Changes
When changing environment variable names:

- [ ] Update all code that reads the environment variable
- [ ] Update documentation
- [ ] Update CI/CD configuration
- [ ] Update example .env files
- [ ] Update any deployment scripts

## Testing Strategy
- [ ] Run all tests after changes: `npm test`
- [ ] Run unit tests: `npm run test:unit`
- [ ] Run integration tests: `npm run test:integration`
- [ ] Check test coverage hasn't decreased
- [ ] Verify no tests are being skipped unexpectedly

## Documentation Updates
- [ ] README.md
- [ ] AGENTS.md
- [ ] Any other .md files in the project
- [ ] Inline code comments
- [ ] Help text in CLI commands
- [ ] Error messages

## Verification Steps
- [ ] All tests pass
- [ ] CLI help shows correct commands
- [ ] Documentation is consistent
- [ ] No broken links or references
- [ ] Examples in documentation work
- [ ] CI/CD pipeline passes

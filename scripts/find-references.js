#!/usr/bin/env node

/**
 * Script to find all references to a given string across the codebase
 * Usage: node scripts/find-references.js "search-term"
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const searchTerm = process.argv[2];

if (!searchTerm) {
  console.error('Usage: node scripts/find-references.js "search-term"');
  process.exit(1);
}

console.log(`🔍 Searching for references to: "${searchTerm}"`);
console.log('=' .repeat(50));

try {
  // Use ripgrep if available, otherwise fall back to grep
  let command;
  try {
    execSync('which rg', { stdio: 'ignore' });
    command = `rg --type js --type md --type yml --type yaml --type json --type txt "${searchTerm}" . --exclude-dir=node_modules --exclude-dir=coverage --exclude-dir=.git`;
  } catch {
    command = `grep -r --include="*.js" --include="*.md" --include="*.yml" --include="*.yaml" --include="*.json" --include="*.txt" "${searchTerm}" . --exclude-dir=node_modules --exclude-dir=coverage --exclude-dir=.git`;
  }

  const output = execSync(command, { encoding: 'utf8' });
  
  if (output.trim()) {
    console.log(output);
  } else {
    console.log('No references found.');
  }
} catch (error) {
  if (error.status === 1) {
    console.log('No references found.');
  } else {
    console.error('Error searching:', error.message);
    process.exit(1);
  }
}

console.log('=' .repeat(50));
console.log('✅ Search complete');

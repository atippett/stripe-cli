const chalk = require('chalk');

/**
 * Recursively print an object as indented `key: value` lines for terminal output.
 * Nested objects become bold section headers; leaf values are printed inline.
 * @param {*} obj - Object (or value) to print
 * @param {number} indent - Leading spaces (defaults to 2)
 */
function printSettingsTree(obj, indent = 2) {
  const pad = ' '.repeat(indent);
  if (obj === null || obj === undefined) {
    console.log(`${pad}${chalk.gray('(none)')}`);
    return;
  }
  Object.keys(obj).forEach((key) => {
    const value = obj[key];
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      console.log(`${pad}${chalk.bold(key)}:`);
      printSettingsTree(value, indent + 2);
    } else {
      const rendered = Array.isArray(value) ? JSON.stringify(value) : String(value);
      console.log(`${pad}${chalk.cyan(key)}: ${rendered}`);
    }
  });
}

module.exports = { printSettingsTree };

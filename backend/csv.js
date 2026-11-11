'use strict';

function csvEscape(value) {
  let text = String(value ?? '');
  // Prefix spreadsheet formula starters so exported user content stays inert.
  if (/^[\s]*[=+@-]/.test(text) || /^[\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

module.exports = { csvEscape };

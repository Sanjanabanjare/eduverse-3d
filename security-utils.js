;(function attachSecurityUtils(root, factory) {
  const utilities = factory();
  if (typeof module === 'object' && module.exports) module.exports = utilities;
  if (root) root.EduVerseSecurity = utilities;
})(typeof globalThis === 'object' ? globalThis : this, function createSecurityUtils() {
  'use strict';
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
  }
  return Object.freeze({ escapeHtml });
});

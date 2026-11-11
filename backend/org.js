'use strict';
/**
 * backend/org.js — institution-ready core helpers (Slice A).
 * Holds a reference to the store (injected via init, same pattern as live.js).
 * No circular require: server.js requires this file; this file requires nothing
 * from server.js.
 */
const { randomUUID } = require('crypto');

let store = null;
function init(s) { store = s; }

const ADMIN_ROLES = ['admin', 'super_admin', 'institution_admin'];

function effectiveRole(role) {
  // Existing `admin` accounts keep working and are treated as super_admin.
  return role === 'admin' ? 'super_admin' : role;
}

function isAdminRole(role) {
  return ADMIN_ROLES.includes(role);
}

function defaultRolePermissions() {
  return {
    super_admin: ['org.manage', 'users.manage', 'courses.manage', 'courses.publish', 'fees.manage', 'marketplace.manage', 'import.manage', 'reports.view', 'settings.manage', 'branding.manage', 'roles.manage', 'integrations.manage', 'security.view', 'backup.manage', 'family.manage', 'library.manage', 'calendar.manage', 'lang.manage', 'standards.manage', 'codelab.manage'],
    institution_admin: ['org.view', 'users.manage', 'courses.manage', 'courses.publish', 'fees.manage', 'marketplace.manage', 'import.manage', 'reports.view', 'settings.manage', 'branding.manage', 'security.view', 'integrations.manage', 'family.manage', 'library.manage', 'calendar.manage', 'lang.manage', 'standards.manage', 'codelab.manage'],
    teacher: ['courses.create', 'courses.publish', 'assignments.manage', 'reports.view', 'library.manage', 'codelab.manage'],
    student: ['courses.enroll', 'assignments.submit'],
  };
}

/** Permission check against store.rolePermissions. New endpoints only. */
function can(user, perm) {
  if (!user) return false;
  const role = effectiveRole(user.role);
  const matrix = (store && store.rolePermissions) || {};
  const perms = matrix[role] || (role === 'super_admin' ? defaultRolePermissions().super_admin : []);
  return Array.isArray(perms) && perms.includes(perm);
}

/**
 * Org isolation scope for the requesting user.
 * super_admin -> null (sees everything); everyone else -> their institutionId.
 */
function orgScope(user) {
  if (!user) return { institutionId: null };
  if (effectiveRole(user.role) === 'super_admin') return { institutionId: null };
  return { institutionId: user.institutionId || null };
}

function slugify(name) {
  return String(name || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

const SLUG_RE = /^[a-z0-9-]{2,40}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function validName(name) {
  const n = String(name || '').trim();
  return n.length >= 2 && n.length <= 120 ? n : null;
}

function validUrl(u) {
  const s = String(u || '').trim();
  if (!s) return '';
  if (s.startsWith('/')) return s.slice(0, 500);
  if (/^https:\/\//.test(s) && s.length <= 2000) return s;
  return null;
}

function validDateRange(startsAt, endsAt) {
  const s = new Date(String(startsAt || '')).getTime();
  const e = new Date(String(endsAt || '')).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return null;
  return { startsAt: new Date(s).toISOString(), endsAt: new Date(e).toISOString() };
}

function normalizeBranding(b) {
  b = b && typeof b === 'object' ? b : {};
  const logoUrl = validUrl(b.logoUrl);
  const faviconUrl = validUrl(b.faviconUrl);
  if (logoUrl === null || faviconUrl === null) return null;
  let primaryColor = '#6d28d9';
  if (b.primaryColor !== undefined && b.primaryColor !== '' && b.primaryColor !== null) {
    if (!COLOR_RE.test(String(b.primaryColor))) return null;
    primaryColor = String(b.primaryColor);
  }
  return { logoUrl, primaryColor, faviconUrl };
}

function normalizeInstitution(inst) {
  if (!inst.slug || !SLUG_RE.test(inst.slug)) {
    inst.slug = slugify(inst.name) || ('inst-' + String(inst.id || '').slice(0, 8));
  }
  if (!['active', 'suspended'].includes(inst.status)) inst.status = 'active';
  if (!inst.branding || typeof inst.branding !== 'object') {
    inst.branding = { logoUrl: '', primaryColor: '#6d28d9', faviconUrl: '' };
  } else {
    const nb = normalizeBranding(inst.branding);
    if (nb) inst.branding = nb;
  }
  return inst;
}

/** Ensure slug uniqueness within institutions; returns a unique slug. */
function uniqueSlug(base, excludeId) {
  let slug = base, n = 2;
  const taken = new Set((store.institutions || []).filter(i => i.id !== excludeId).map(i => i.slug));
  while (taken.has(slug)) slug = `${base.slice(0, 36)}-${n++}`;
  return slug;
}

/**
 * Startup migration: create the Default Institution when none exists and stamp
 * institutionId onto existing users/courses. Also normalizes legacy org rows
 * (created by the old /api/admin/org endpoint) to the new schema.
 */
function migrateOrg() {
  store.institutions ||= [];
  store.campuses ||= [];
  store.departments ||= [];
  store.academicYears ||= [];
  store.semesters ||= [];
  store.rolePermissions ||= defaultRolePermissions();
  // Slice B: backfill brand-new permissions into matrices that predate them.
  // Additive only — never removes an admin's deliberate customization, because
  // these permission strings did not exist before Slice B.
  const backfill = {
    super_admin: ['marketplace.manage', 'import.manage', 'security.view', 'backup.manage', 'integrations.manage', 'family.manage', 'library.manage', 'calendar.manage', 'lang.manage', 'standards.manage', 'codelab.manage'],
    institution_admin: ['fees.manage', 'marketplace.manage', 'import.manage', 'security.view', 'integrations.manage', 'family.manage', 'library.manage', 'calendar.manage', 'lang.manage', 'standards.manage', 'codelab.manage'],
    teacher: ['library.manage', 'codelab.manage'],
  };
  for (const [role, perms] of Object.entries(backfill)) {
    store.rolePermissions[role] ||= [];
    for (const p of perms) if (!store.rolePermissions[role].includes(p)) store.rolePermissions[role].push(p);
  }

  const seen = new Set();
  for (const inst of store.institutions) {
    normalizeInstitution(inst);
    if (seen.has(inst.slug)) inst.slug = uniqueSlug(inst.slug, inst.id);
    seen.add(inst.slug);
  }
  if (!store.institutions.length) {
    store.institutions.unshift({
      id: randomUUID(), name: 'Default Institution', slug: 'default', status: 'active',
      branding: { logoUrl: '', primaryColor: '#6d28d9', faviconUrl: '' },
      createdAt: new Date().toISOString(),
    });
  }
  const defaultId = store.institutions[0].id;
  for (const u of store.users || []) if (!u.institutionId) u.institutionId = defaultId;
  for (const c of store.courses || []) if (!c.institutionId) c.institutionId = defaultId;
  for (const d of store.departments || []) {
    if (d.campusId === undefined) d.campusId = null;
    if (d.headUserId === undefined) d.headUserId = null;
  }
}

/** Institution used by the public branding endpoint: 'default' slug first, else first active. */
function pickBrandingInstitution() {
  const list = store.institutions || [];
  return list.find(i => i.slug === 'default' && i.status === 'active')
      || list.find(i => i.status === 'active')
      || list[0] || null;
}

module.exports = {
  init, ADMIN_ROLES, effectiveRole, isAdminRole, can, orgScope,
  defaultRolePermissions, slugify, uniqueSlug, validName, validUrl, validDateRange,
  normalizeBranding, normalizeInstitution, migrateOrg, pickBrandingInstitution,
  SLUG_RE, COLOR_RE,
};

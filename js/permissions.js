// =====================================================================
// SKYNET EXPRESS – permissions.js
// Client-side mirror of the server permissions – used ONLY to show/hide UI.
// Real enforcement happens in the database (RLS + SECURITY DEFINER RPCs).
// =====================================================================
export const PERMISSION_DEFS = [
  { key: 'page_executive', label: 'Executive Dashboard', options: ['view', 'hide'], group: 'Pages' },
  { key: 'page_customers', label: 'Customer Analysis', options: ['view', 'hide'], group: 'Pages' },
  { key: 'page_sales', label: 'Sales Performance', options: ['view', 'hide'], group: 'Pages' },
  { key: 'page_country', label: 'Country Analysis', options: ['view', 'hide'], group: 'Pages' },
  { key: 'page_hub', label: 'Hub Analysis', options: ['view', 'hide'], group: 'Pages' },
  { key: 'page_shipments', label: 'Shipment Report', options: ['view', 'hide'], group: 'Pages' },
  { key: 'excel_import', label: 'Excel Import', options: ['allow', 'deny'], group: 'Features' },
  { key: 'excel_export', label: 'Excel Export', options: ['allow', 'deny'], group: 'Features' },
  { key: 'hold_change', label: 'Change Hold Status', options: ['allow', 'deny'], group: 'Features' },
  { key: 'user_management', label: 'User Management', options: ['allow', 'deny'], group: 'Features' },
  { key: 'target_management', label: 'Target Management', options: ['allow', 'deny'], group: 'Features' },
  { key: 'audit_logs', label: 'Audit Logs', options: ['allow', 'deny'], group: 'Features' },
  { key: 'app_settings', label: 'Application Settings', options: ['allow', 'deny'], group: 'Features' },
  { key: 'revenue_visibility', label: 'Revenue Visibility', options: ['allow', 'deny'], group: 'Data' },
  { key: 'weight_visibility', label: 'Weight Visibility', options: ['allow', 'deny'], group: 'Data' },
  { key: 'customer_visibility', label: 'Customer Visibility', options: ['all', 'assigned', 'own'], group: 'Data' },
  { key: 'shipment_visibility', label: 'Shipment Visibility', options: ['all', 'assigned', 'own'], group: 'Data' },
  { key: 'salesperson_visibility', label: 'Salesperson Visibility', options: ['all', 'assigned', 'own'], group: 'Data' },
];

/** Same defaults as public.default_permission() in rls-policies.sql */
export function defaultPermission(role, key) {
  const scopeKeys = ['customer_visibility', 'shipment_visibility', 'salesperson_visibility'];
  if (role === 'admin') return scopeKeys.includes(key) ? 'all' : key.startsWith('page_') ? 'view' : 'allow';
  if (role === 'manager') {
    if (scopeKeys.includes(key)) return 'assigned';
    if (key.startsWith('page_')) return 'view';
    return ['excel_export', 'revenue_visibility', 'weight_visibility', 'hold_change'].includes(key) ? 'allow' : 'deny';
  }
  if (role === 'sales') {
    if (scopeKeys.includes(key)) return 'own';
    if (['page_executive', 'page_customers', 'page_sales', 'page_shipments'].includes(key)) return 'view';
    if (key.startsWith('page_')) return 'hide';
    return ['excel_export', 'revenue_visibility', 'weight_visibility'].includes(key) ? 'allow' : 'deny';
  }
  return key.startsWith('page_') ? 'hide' : 'deny';
}

let ctx = { profile: null, permissions: {}, scope: 'none' };
export function setContext(c) { ctx = c || ctx; }
export function getContext() { return ctx; }
export function profile() { return ctx.profile || {}; }
export function can(key) { const v = ctx.permissions?.[key]; return ['allow', 'view', 'all', 'assigned', 'own'].includes(v); }
export function isAdmin() { return ctx.profile?.role === 'admin'; }

export const ROUTES = [
  { id: 'dashboard', label: 'Executive Dashboard', icon: 'layout-dashboard', section: 'Analytics', perm: () => can('page_executive'), filters: true },
  { id: 'customers', label: 'Customer Analysis', icon: 'users-round', section: 'Analytics', perm: () => can('page_customers'), filters: true },
  { id: 'sales', label: 'Sales Team Performance', icon: 'trophy', section: 'Analytics', perm: () => can('page_sales'), filters: true },
  { id: 'country-hub', label: 'Country & Hub Analysis', icon: 'globe', section: 'Analytics', perm: () => can('page_country') || can('page_hub'), filters: true },
  { id: 'shipments', label: 'Daily Sales & Shipment Report', icon: 'package-search', section: 'Analytics', perm: () => can('page_shipments'), filters: true },
  { id: 'import', label: 'Excel Data Import', icon: 'file-spreadsheet', section: 'Data', perm: () => can('excel_import') },
  { id: 'users', label: 'User Management', icon: 'user-cog', section: 'Administration', perm: () => can('user_management') },
  { id: 'targets', label: 'Sales Target Management', icon: 'target', section: 'Administration', perm: () => can('target_management') },
  { id: 'profile', label: 'My Profile', icon: 'circle-user-round', section: 'Account', perm: () => true },
  { id: 'audit', label: 'Audit Logs', icon: 'scroll-text', section: 'Administration', perm: () => can('audit_logs') },
  { id: 'settings', label: 'Application Settings', icon: 'settings', section: 'Administration', perm: () => isAdmin() || can('app_settings') },
];
export function allowedRoutes() { return ROUTES.filter((r) => r.perm()); }
export function firstAllowedRoute() { return allowedRoutes()[0]?.id || 'profile'; }

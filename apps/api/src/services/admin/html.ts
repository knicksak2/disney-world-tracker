/**
 * Server-side HTML rendering helpers and design system for the Admin Panel.
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4
 */

/**
 * Escapes HTML metacharacters in strings to prevent XSS.
 * Handles strings, numbers, null, and undefined safely.
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Returns a visible warning badge ("⚠ label") if condition is true, or empty string otherwise.
 */
export function flagged(condition: boolean, label: string): string {
  if (!condition) {
    return '';
  }
  return `<span class="badge badge-warning">⚠ ${escapeHtml(label)}</span>`;
}

/**
 * Renders an explainer callout box helping the operator understand what
 * a section monitors and what normal operating values look like.
 */
export function explainerBanner(icon: string, title: string, text: string): string {
  return `
    <div class="explainer-banner">
      <div class="explainer-icon">${icon}</div>
      <div class="explainer-content">
        <h4 class="explainer-title">${escapeHtml(title)}</h4>
        <p class="explainer-text">${escapeHtml(text)}</p>
      </div>
    </div>
  `;
}

/**
 * Renders a visual horizontal progress bar (e.g. for resource budget usage).
 */
export function progressBar(percent: number, variant: 'normal' | 'warning' | 'danger' = 'normal'): string {
  const clamped = Math.max(0, Math.min(100, percent));
  return `
    <div class="progress-bar-container">
      <div class="progress-bar-fill ${variant}" style="width: ${clamped.toFixed(1)}%;"></div>
    </div>
  `;
}

export interface TableColumn<T> {
  readonly header: string;
  readonly cell: (row: T) => string;
}

/**
 * Renders a responsive HTML table with typed rows and columns.
 */
export function table<T>(
  rows: readonly T[],
  columns: readonly TableColumn<T>[],
): string {
  const headerHtml = columns
    .map((col) => `<th>${escapeHtml(col.header)}</th>`)
    .join('');

  const bodyHtml =
    rows.length === 0
      ? `<tr><td colspan="${columns.length}" class="empty-cell">No entries found</td></tr>`
      : rows
          .map(
            (row) =>
              `<tr>${columns.map((col) => `<td>${col.cell(row)}</td>`).join('')}</tr>`,
          )
          .join('\n');

  return `<div class="table-wrapper"><table class="admin-table">
  <thead>
    <tr>${headerHtml}</tr>
  </thead>
  <tbody>
    ${bodyHtml}
  </tbody>
</table></div>`;
}

/**
 * Common HTML page shell with rich, modern styling and responsive layout for the Admin Panel.
 */
export function renderPage(title: string, bodyHtml: string, currentPath?: string): string {
  const activePath = currentPath ?? '';
  const isDashboard = activePath === '/admin' || title === 'Admin Overview' || title === 'Admin Panel';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} - Admin Panel</title>
  <style>
    :root {
      --bg: #090d16;
      --card-bg: #111827;
      --card-elevated: #162032;
      --card-hover: #1b263b;
      --border: #1f293d;
      --border-light: #2d3b55;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --text-subtle: #64748b;
      --primary: #38bdf8;
      --primary-hover: #0ea5e9;
      --primary-glow: rgba(56, 189, 248, 0.15);
      --accent-indigo: #818cf8;
      --accent-purple: #c084fc;
      --warning-bg: rgba(245, 158, 11, 0.15);
      --warning-text: #fbbf24;
      --warning-border: rgba(245, 158, 11, 0.35);
      --danger-bg: rgba(239, 68, 68, 0.15);
      --danger-text: #f87171;
      --danger-border: rgba(239, 68, 68, 0.35);
      --success-bg: rgba(16, 185, 129, 0.15);
      --success-text: #34d399;
      --success-border: rgba(16, 185, 129, 0.35);
      --info-bg: rgba(56, 189, 248, 0.12);
      --info-text: #38bdf8;
      --info-border: rgba(56, 189, 248, 0.3);
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      --font-sans: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: var(--bg);
      background-image: 
        radial-gradient(ellipse 80% 50% at 50% -20%, rgba(56, 189, 248, 0.08), transparent 70%),
        radial-gradient(circle at 100% 100%, rgba(129, 140, 248, 0.04), transparent 40%);
      background-attachment: fixed;
      color: var(--text);
      font-family: var(--font-sans);
      line-height: 1.5;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      -webkit-font-smoothing: antialiased;
    }

    /* Top Sticky Navigation Bar */
    header.admin-header {
      position: sticky;
      top: 0;
      z-index: 50;
      background: rgba(9, 13, 22, 0.88);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border-bottom: 1px solid var(--border);
      padding: 0.75rem 1.5rem;
    }

    .header-inner {
      max-width: 1400px;
      margin: 0 auto;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
    }

    .brand-group {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .brand-link {
      display: flex;
      align-items: center;
      gap: 0.65rem;
      text-decoration: none;
      color: var(--text);
    }

    .brand-icon {
      font-size: 1.4rem;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 2.25rem;
      height: 2.25rem;
      background: rgba(56, 189, 248, 0.1);
      border: 1px solid rgba(56, 189, 248, 0.25);
      border-radius: 0.5rem;
    }

    .brand-titles {
      display: flex;
      flex-direction: column;
    }

    .brand-name {
      font-size: 0.95rem;
      font-weight: 700;
      letter-spacing: -0.01em;
      color: var(--text);
    }

    .brand-tag {
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--primary);
    }

    .system-status-pill {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.2rem 0.6rem;
      background: rgba(16, 185, 129, 0.1);
      border: 1px solid rgba(16, 185, 129, 0.3);
      border-radius: 9999px;
      font-size: 0.7rem;
      font-weight: 600;
      color: #34d399;
    }

    .pulse-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #10b981;
      box-shadow: 0 0 8px #10b981;
    }

    .top-nav-actions {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .nav-link {
      font-size: 0.825rem;
      font-weight: 600;
      color: var(--text-muted);
      text-decoration: none;
      padding: 0.4rem 0.8rem;
      border-radius: 0.375rem;
      transition: all 0.15s ease;
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
    }

    .nav-link:hover {
      color: var(--text);
      background: rgba(255, 255, 255, 0.05);
      text-decoration: none;
    }

    .nav-link.active {
      color: var(--primary);
      background: rgba(56, 189, 248, 0.1);
    }

    .quick-jump-dropdown {
      position: relative;
      display: inline-block;
    }

    .quick-jump-btn {
      background: var(--card-elevated);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 0.375rem;
      padding: 0.4rem 0.85rem;
      font-size: 0.825rem;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
    }

    .quick-jump-btn:hover {
      border-color: var(--primary);
      background: var(--card-hover);
    }

    .dropdown-content {
      display: none;
      position: absolute;
      right: 0;
      top: calc(100% + 0.35rem);
      background: #111827;
      border: 1px solid var(--border-light);
      border-radius: 0.5rem;
      min-width: 260px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);
      z-index: 100;
      padding: 0.5rem;
    }

    .quick-jump-dropdown:hover .dropdown-content,
    .quick-jump-dropdown:focus-within .dropdown-content {
      display: block;
    }

    .dropdown-group-title {
      font-size: 0.68rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--primary);
      padding: 0.4rem 0.6rem 0.2rem;
    }

    .dropdown-item {
      display: block;
      padding: 0.35rem 0.6rem;
      font-size: 0.8rem;
      color: var(--text-muted);
      text-decoration: none;
      border-radius: 0.25rem;
      transition: all 0.1s;
    }

    .dropdown-item:hover {
      background: rgba(56, 189, 248, 0.12);
      color: var(--text);
      text-decoration: none;
    }

    .dropdown-item.active {
      color: var(--primary);
      font-weight: 600;
    }

    /* Main Container */
    .admin-container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 1.75rem 1.5rem 3rem;
      width: 100%;
      flex: 1;
    }

    /* Breadcrumb Trail */
    .breadcrumbs {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.8125rem;
      color: var(--text-muted);
      margin-bottom: 0.75rem;
    }

    .breadcrumbs a {
      color: var(--text-muted);
      text-decoration: none;
    }

    .breadcrumbs a:hover {
      color: var(--primary);
      text-decoration: underline;
    }

    .breadcrumb-sep {
      color: var(--text-subtle);
      font-size: 0.75rem;
    }

    .breadcrumb-current {
      color: var(--text);
      font-weight: 500;
    }

    /* Headings */
    h1 {
      font-size: 1.65rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--text);
      margin-bottom: 1rem;
    }

    h2 {
      font-size: 1.15rem;
      font-weight: 600;
      letter-spacing: -0.01em;
      margin: 0 0 0.85rem 0;
      color: var(--text);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    h3 {
      font-size: 1rem;
      font-weight: 600;
      color: var(--text);
    }

    a {
      color: var(--primary);
      text-decoration: none;
      transition: color 0.15s ease;
    }

    a:hover {
      text-decoration: underline;
      color: var(--primary-hover);
    }

    /* Cards */
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 0.75rem;
      padding: 1.35rem;
      margin-bottom: 1.5rem;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.2), 0 2px 4px -2px rgba(0, 0, 0, 0.2);
    }

    /* Explainer Banners */
    .explainer-banner {
      display: flex;
      align-items: flex-start;
      gap: 0.85rem;
      background: rgba(56, 189, 248, 0.05);
      border: 1px solid rgba(56, 189, 248, 0.2);
      border-radius: 0.5rem;
      padding: 0.9rem 1.1rem;
      margin-bottom: 1.5rem;
    }

    .explainer-icon {
      font-size: 1.25rem;
      line-height: 1;
      margin-top: 0.1rem;
    }

    .explainer-title {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--primary);
      margin-bottom: 0.2rem;
    }

    .explainer-text {
      font-size: 0.8125rem;
      color: var(--text-muted);
      line-height: 1.45;
    }

    /* Metric Cards */
    .metric-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      gap: 1rem;
      margin-bottom: 1.25rem;
    }

    .metric-card {
      background: var(--card-elevated);
      border: 1px solid var(--border);
      border-radius: 0.6rem;
      padding: 1.1rem;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      transition: transform 0.15s ease, border-color 0.15s ease;
    }

    .metric-card:hover {
      border-color: var(--border-light);
    }

    .metric-label {
      font-size: 0.725rem;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.35rem;
    }

    .metric-val {
      font-size: 1.65rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--text);
      line-height: 1.2;
    }

    .metric-sub {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-top: 0.35rem;
    }

    /* Progress Bars */
    .progress-bar-container {
      width: 100%;
      height: 6px;
      background: rgba(255, 255, 255, 0.08);
      border-radius: 9999px;
      overflow: hidden;
      margin-top: 0.6rem;
    }

    .progress-bar-fill {
      height: 100%;
      border-radius: 9999px;
      background: var(--primary);
      transition: width 0.3s ease;
    }

    .progress-bar-fill.warning {
      background: #f59e0b;
    }

    .progress-bar-fill.danger {
      background: #ef4444;
    }

    /* Tables */
    .table-wrapper {
      overflow-x: auto;
      border: 1px solid var(--border);
      border-radius: 0.5rem;
      background: var(--card-bg);
      margin: 1rem 0;
      -webkit-overflow-scrolling: touch;
    }

    .admin-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
      text-align: left;
    }

    .admin-table th, .admin-table td {
      padding: 0.7rem 0.9rem;
      border-bottom: 1px solid var(--border);
      vertical-align: middle;
    }

    .admin-table th {
      background: var(--card-elevated);
      color: var(--text-muted);
      font-weight: 600;
      text-transform: uppercase;
      font-size: 0.725rem;
      letter-spacing: 0.05em;
      white-space: nowrap;
      position: sticky;
      top: 0;
      z-index: 10;
    }

    .admin-table tbody tr:hover {
      background: rgba(56, 189, 248, 0.04);
    }

    .admin-table tbody tr:last-child td {
      border-bottom: none;
    }

    .empty-cell {
      text-align: center;
      color: var(--text-muted);
      font-style: italic;
      padding: 2rem !important;
    }

    /* Badges */
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.2rem 0.55rem;
      border-radius: 9999px;
      font-size: 0.725rem;
      font-weight: 600;
      line-height: 1;
      white-space: nowrap;
    }

    .badge-warning {
      background: var(--warning-bg);
      color: var(--warning-text);
      border: 1px solid var(--warning-border);
    }

    .badge-danger {
      background: var(--danger-bg);
      color: var(--danger-text);
      border: 1px solid var(--danger-border);
    }

    .badge-success {
      background: var(--success-bg);
      color: var(--success-text);
      border: 1px solid var(--success-border);
    }

    .badge-info {
      background: var(--info-bg);
      color: var(--info-text);
      border: 1px solid var(--info-border);
    }

    .badge-neutral {
      background: rgba(255, 255, 255, 0.05);
      color: var(--text-muted);
      border: 1px solid var(--border-light);
    }

    /* Text & Utility classes */
    .text-xs { font-size: 0.725rem; }
    .text-sm { font-size: 0.825rem; }
    .text-emerald { color: #34d399; }
    .text-amber { color: #fbbf24; }
    .text-rose { color: #f87171; }
    .text-cyan { color: #38bdf8; }
    .font-semibold { font-weight: 600; }

    /* Guide and Explainer Cards */
    .guide-card {
      background: var(--card-elevated);
      border: 1px solid var(--border);
      border-radius: 0.75rem;
      padding: 1.25rem;
      margin-bottom: 1.5rem;
    }

    .guide-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 1rem;
      margin-top: 0.85rem;
    }

    .guide-item {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 0.5rem;
      padding: 0.85rem;
    }

    .guide-item-title {
      font-size: 0.85rem;
      font-weight: 700;
      color: var(--text);
      display: flex;
      align-items: center;
      gap: 0.4rem;
      margin-bottom: 0.35rem;
    }

    .guide-item-desc {
      font-size: 0.775rem;
      color: var(--text-muted);
      line-height: 1.45;
    }

    /* Buttons */
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: var(--primary);
      color: #090d16;
      font-weight: 600;
      padding: 0.5rem 1rem;
      border-radius: 0.4rem;
      border: 1px solid transparent;
      cursor: pointer;
      font-size: 0.85rem;
      text-decoration: none;
      transition: all 0.15s ease;
      line-height: 1.25;
    }

    .btn:hover {
      background: var(--primary-hover);
      text-decoration: none;
      box-shadow: 0 0 12px var(--primary-glow);
    }

    .btn-danger {
      background: #ef4444;
      color: #fff;
    }

    .btn-danger:hover {
      background: #dc2626;
      box-shadow: 0 0 12px rgba(239, 68, 68, 0.3);
    }

    .btn-secondary {
      background: var(--card-elevated);
      color: var(--text);
      border-color: var(--border-light);
    }

    .btn-secondary:hover {
      background: var(--card-hover);
      border-color: var(--primary);
    }

    /* Code & Typography */
    .mono {
      font-family: var(--font-mono);
      font-size: 0.8rem;
    }

    code {
      font-family: var(--font-mono);
      font-size: 0.8rem;
      background: rgba(255, 255, 255, 0.06);
      padding: 0.15rem 0.35rem;
      border-radius: 0.25rem;
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: #e2e8f0;
    }

    .text-muted {
      color: var(--text-muted);
    }

    /* Forms */
    .form-group {
      margin-bottom: 1rem;
    }

    .form-input {
      background: var(--bg);
      border: 1px solid var(--border-light);
      color: var(--text);
      padding: 0.55rem 0.85rem;
      border-radius: 0.4rem;
      width: 100%;
      max-width: 420px;
      font-size: 0.875rem;
      font-family: var(--font-sans);
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }

    .form-input:focus {
      outline: none;
      border-color: var(--primary);
      box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.2);
    }

    /* Error Box */
    .error-box {
      background: rgba(239, 68, 68, 0.08);
      border: 1px solid var(--danger-border);
      border-radius: 0.75rem;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
    }

    .error-box h2 {
      color: var(--danger-text);
      margin-bottom: 0.5rem;
    }

    .error-box p {
      color: var(--text-muted);
      margin-bottom: 0.75rem;
    }

    /* Dashboard Overview Styles */
    .dashboard-hero {
      background: linear-gradient(135deg, rgba(56, 189, 248, 0.1) 0%, rgba(129, 140, 248, 0.05) 100%);
      border: 1px solid rgba(56, 189, 248, 0.25);
      border-radius: 0.85rem;
      padding: 1.75rem;
      margin-bottom: 2rem;
    }

    .dashboard-hero h1 {
      margin-bottom: 0.4rem;
    }

    .dashboard-hero p {
      color: var(--text-muted);
      font-size: 0.95rem;
      max-width: 800px;
      margin-bottom: 1.25rem;
    }

    .hero-stats-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-top: 1rem;
      padding-top: 1rem;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
    }

    .hero-stat {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .hero-stat-icon {
      font-size: 1.5rem;
    }

    .hero-stat-text {
      display: flex;
      flex-direction: column;
    }

    .hero-stat-title {
      font-size: 0.75rem;
      color: var(--text-muted);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .hero-stat-desc {
      font-size: 0.825rem;
      color: var(--text);
      font-weight: 500;
    }

    .category-section {
      margin-bottom: 2.25rem;
    }

    .category-header {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      margin-bottom: 1rem;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid var(--border);
    }

    .category-icon {
      font-size: 1.25rem;
    }

    .category-title {
      font-size: 1.1rem;
      font-weight: 700;
      color: var(--text);
      letter-spacing: -0.01em;
    }

    .category-desc {
      font-size: 0.8rem;
      color: var(--text-muted);
      margin-left: auto;
    }

    .sections-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 1rem;
    }

    .section-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 0.75rem;
      padding: 1.25rem;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      position: relative;
    }

    .section-card:hover {
      border-color: var(--primary);
      transform: translateY(-2px);
      box-shadow: 0 8px 20px -4px rgba(0, 0, 0, 0.4), 0 0 12px var(--primary-glow);
    }

    .section-card-top {
      margin-bottom: 1rem;
    }

    .section-card-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.45rem;
    }

    .section-card-icon {
      font-size: 1.2rem;
    }

    .section-card-title {
      margin: 0;
      font-size: 1rem;
      font-weight: 700;
      color: var(--text);
    }

    .section-card-title a {
      color: var(--text);
      text-decoration: none;
    }

    .section-card:hover .section-card-title a {
      color: var(--primary);
    }

    .section-card-desc {
      font-size: 0.825rem;
      color: var(--text-muted);
      line-height: 1.45;
      margin: 0;
    }

    .section-card-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 0.85rem;
      border-top: 1px solid rgba(255, 255, 255, 0.05);
      margin-top: auto;
    }

    .section-card-badge {
      font-size: 0.7rem;
      font-weight: 600;
      color: var(--text-subtle);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .section-card-cta {
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--primary);
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
    }

    @media (max-width: 768px) {
      body { padding: 0; }
      .admin-container { padding: 1rem; }
      .sections-grid { grid-template-columns: 1fr; }
      .metric-grid { grid-template-columns: 1fr 1fr; }
      .hero-stats-row { grid-template-columns: 1fr; }
      .category-desc { display: none; }
    }
  </style>
</head>
<body>
  <header class="admin-header">
    <div class="header-inner">
      <div class="brand-group">
        <a class="brand-link" href="/admin">
          <span class="brand-icon">🏰</span>
          <div class="brand-titles">
            <span class="brand-name">Disney World Tracker</span>
            <span class="brand-tag">Operator Console</span>
          </div>
        </a>
        <div class="system-status-pill">
          <span class="pulse-dot"></span>
          <span>Live Monolith</span>
        </div>
      </div>
      <nav class="top-nav-actions">
        <a class="nav-link ${isDashboard ? 'active' : ''}" href="/admin">
          ← Admin Dashboard
        </a>
        <div class="quick-jump-dropdown">
          <button type="button" class="quick-jump-btn">Jump to Section ▾</button>
          <div class="dropdown-content">
            <div class="dropdown-group-title">Data Ingestion</div>
            <a href="/admin/catalog" class="dropdown-item ${activePath === '/admin/catalog' ? 'active' : ''}">🔄 Catalog & Disney Sync</a>
            <a href="/admin/disney-transport" class="dropdown-item ${activePath === '/admin/disney-transport' ? 'active' : ''}">⚡ Disney Transport & Limits</a>
            <a href="/admin/intelligence/sampling" class="dropdown-item ${activePath === '/admin/intelligence/sampling' ? 'active' : ''}">⏱️ Sampling Pass Health</a>
            <div class="dropdown-group-title">Predictive Intelligence</div>
            <a href="/admin/intelligence/accuracy" class="dropdown-item ${activePath === '/admin/intelligence/accuracy' ? 'active' : ''}">🎯 Forecast Accuracy</a>
            <a href="/admin/intelligence/model" class="dropdown-item ${activePath === '/admin/intelligence/model' ? 'active' : ''}">🧠 Model Internals & Baselines</a>
            <a href="/admin/intelligence/derived-stats" class="dropdown-item ${activePath === '/admin/intelligence/derived-stats' ? 'active' : ''}">📊 Derived Stats Health</a>
            <div class="dropdown-group-title">Infrastructure & Health</div>
            <a href="/admin/infra" class="dropdown-item ${activePath === '/admin/infra' ? 'active' : ''}">💾 Infrastructure Budget</a>
            <a href="/admin/notifications" class="dropdown-item ${activePath === '/admin/notifications' ? 'active' : ''}">🔔 Push Delivery Visibility</a>
            <a href="/admin/config" class="dropdown-item ${activePath === '/admin/config' ? 'active' : ''}">⚙️ System Configuration</a>
            <div class="dropdown-group-title">User Operations</div>
            <a href="/admin/users" class="dropdown-item ${activePath === '/admin/users' ? 'active' : ''}">👤 User & Support Lookup</a>
            <a href="/admin/accounts/lockouts" class="dropdown-item ${activePath === '/admin/accounts/lockouts' ? 'active' : ''}">🔒 Account Lockouts</a>
            <a href="/admin/growth" class="dropdown-item ${activePath === '/admin/growth' ? 'active' : ''}">📈 Growth & Activity</a>
          </div>
        </div>
      </nav>
    </div>
  </header>

  <div class="admin-container">
    ${
      !isDashboard
        ? `<nav class="breadcrumbs" aria-label="Breadcrumb">
            <a href="/admin">Admin Dashboard</a>
            <span class="breadcrumb-sep">/</span>
            <span class="breadcrumb-current">${escapeHtml(title)}</span>
          </nav>`
        : ''
    }
    ${!isDashboard ? `<h1>${escapeHtml(title)}</h1>` : ''}
    <main>
      ${bodyHtml}
    </main>
  </div>
</body>
</html>`;
}

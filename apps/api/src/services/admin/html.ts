/**
 * Server-side HTML rendering helpers for the Admin Panel.
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

export interface TableColumn<T> {
  readonly header: string;
  readonly cell: (row: T) => string;
}

/**
 * Renders an HTML table with typed rows and columns.
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

  return `<table class="admin-table">
  <thead>
    <tr>${headerHtml}</tr>
  </thead>
  <tbody>
    ${bodyHtml}
  </tbody>
</table>`;
}

/**
 * Common HTML page shell with inline CSS styling for the Admin Panel.
 */
export function renderPage(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} - Admin Panel</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --border: #334155;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --primary: #38bdf8;
      --primary-hover: #0ea5e9;
      --warning-bg: #78350f;
      --warning-text: #fde047;
      --danger-bg: #7f1d1d;
      --danger-text: #fca5a5;
      --success-bg: #14532d;
      --success-text: #86efac;
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      --font-sans: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--font-sans);
      line-height: 1.5;
      padding: 1.5rem;
    }
    header {
      margin-bottom: 2rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    h1 { font-size: 1.5rem; font-weight: 600; color: var(--text); }
    h2 { font-size: 1.25rem; font-weight: 600; margin: 1.5rem 0 0.75rem 0; color: var(--primary); }
    a { color: var(--primary); text-decoration: none; }
    a:hover { text-decoration: underline; color: var(--primary-hover); }
    .nav-link { font-size: 0.875rem; font-weight: 500; }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 0.5rem;
      padding: 1.25rem;
      margin-bottom: 1.5rem;
    }
    .admin-table {
      width: 100%;
      border-collapse: collapse;
      margin: 1rem 0;
      font-size: 0.875rem;
    }
    .admin-table th, .admin-table td {
      padding: 0.6rem 0.75rem;
      border: 1px solid var(--border);
      text-align: left;
    }
    .admin-table th {
      background: #1e293b;
      color: var(--text-muted);
      font-weight: 600;
      text-transform: uppercase;
      font-size: 0.75rem;
      letter-spacing: 0.05em;
    }
    .admin-table tbody tr:hover {
      background: rgba(255, 255, 255, 0.03);
    }
    .empty-cell {
      text-align: center;
      color: var(--text-muted);
      font-style: italic;
      padding: 1.5rem !important;
    }
    .badge {
      display: inline-block;
      padding: 0.2rem 0.5rem;
      border-radius: 0.25rem;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .badge-warning { background: var(--warning-bg); color: var(--warning-text); }
    .badge-danger { background: var(--danger-bg); color: var(--danger-text); }
    .badge-success { background: var(--success-bg); color: var(--success-text); }
    .btn {
      display: inline-block;
      background: var(--primary);
      color: #0f172a;
      font-weight: 600;
      padding: 0.5rem 1rem;
      border-radius: 0.375rem;
      border: none;
      cursor: pointer;
      font-size: 0.875rem;
    }
    .btn:hover { background: var(--primary-hover); text-decoration: none; }
    .btn-danger { background: #ef4444; color: #fff; }
    .btn-danger:hover { background: #dc2626; }
    .mono { font-family: var(--font-mono); font-size: 0.8125rem; }
    .text-muted { color: var(--text-muted); }
    .metric-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 1.5rem;
    }
    .metric-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 0.5rem;
      padding: 1rem;
    }
    .metric-label { font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; }
    .metric-val { font-size: 1.5rem; font-weight: 700; margin-top: 0.25rem; color: var(--text); }
    .form-group { margin-bottom: 1rem; }
    .form-input {
      background: #0f172a;
      border: 1px solid var(--border);
      color: #fff;
      padding: 0.5rem;
      border-radius: 0.375rem;
      width: 100%;
      max-width: 400px;
    }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(title)}</h1>
    <nav>
      <a class="nav-link" href="/admin">← Admin Dashboard</a>
    </nav>
  </header>
  <main>
    ${bodyHtml}
  </main>
</body>
</html>`;
}

import { describe, expect, it } from 'vitest';
import { escapeHtml, flagged, renderPage, table, explainerBanner, progressBar } from '../html.js';

describe('html — unit tests', () => {
  describe('escapeHtml', () => {
    it('escapes &, <, >, ", and \'', () => {
      const input = '<script alert="xss">"Tom & Jerry" \'cats\'</script>';
      const expected = '&lt;script alert=&quot;xss&quot;&gt;&quot;Tom &amp; Jerry&quot; &#39;cats&#39;&lt;/script&gt;';
      expect(escapeHtml(input)).toBe(expected);
    });

    it('handles null and undefined safely by returning empty string', () => {
      expect(escapeHtml(null)).toBe('');
      expect(escapeHtml(undefined)).toBe('');
    });

    it('stringifies numbers correctly', () => {
      expect(escapeHtml(12345)).toBe('12345');
      expect(escapeHtml(0)).toBe('0');
    });
  });

  describe('flagged', () => {
    it('returns a warning badge when condition is true', () => {
      const res = flagged(true, 'Degraded Health');
      expect(res).toContain('⚠ Degraded Health');
      expect(res).toContain('class="badge badge-warning"');
    });

    it('returns empty string when condition is false', () => {
      expect(flagged(false, 'Degraded Health')).toBe('');
    });
  });

  describe('explainerBanner', () => {
    it('renders an explainer callout with icon, title, and escaped text', () => {
      const html = explainerBanner('🔄', 'Data Pipeline', 'Syncs <all> records.');
      expect(html).toContain('class="explainer-banner"');
      expect(html).toContain('🔄');
      expect(html).toContain('Data Pipeline');
      expect(html).toContain('Syncs &lt;all&gt; records.');
    });
  });

  describe('progressBar', () => {
    it('renders progress bar with percentage and variant', () => {
      const normal = progressBar(45.5);
      expect(normal).toContain('style="width: 45.5%;"');

      const warning = progressBar(75, 'warning');
      expect(warning).toContain('class="progress-bar-fill warning"');

      const clamped = progressBar(120, 'danger');
      expect(clamped).toContain('style="width: 100.0%;"');
    });
  });

  describe('table', () => {
    interface SampleRow {
      id: string;
      name: string;
      count: number;
    }

    const columns = [
      { header: 'ID', cell: (r: SampleRow) => r.id },
      { header: 'Name', cell: (r: SampleRow) => escapeHtml(r.name) },
      { header: 'Count', cell: (r: SampleRow) => String(r.count) },
    ];

    it('renders the correct headers and rows for non-empty input', () => {
      const rows: SampleRow[] = [
        { id: '1', name: 'Alpha', count: 10 },
        { id: '2', name: 'Beta <Tag>', count: 20 },
      ];

      const html = table(rows, columns);

      // Verify headers
      expect(html).toContain('<th>ID</th>');
      expect(html).toContain('<th>Name</th>');
      expect(html).toContain('<th>Count</th>');

      // Verify rows
      expect(html).toContain('<td>1</td><td>Alpha</td><td>10</td>');
      expect(html).toContain('<td>2</td><td>Beta &lt;Tag&gt;</td><td>20</td>');
      expect((html.match(/<tr>/g) || []).length).toBe(3); // 1 thead tr + 2 tbody tr
    });

    it('renders empty-cell placeholder for empty input with correct column span', () => {
      const html = table<SampleRow>([], columns);

      expect(html).toContain('<th>ID</th>');
      expect(html).toContain('<th>Name</th>');
      expect(html).toContain('<th>Count</th>');
      expect(html).toContain('colspan="3"');
      expect(html).toContain('No entries found');
    });
  });

  describe('renderPage', () => {
    it('renders the title and body content inside the page shell', () => {
      const title = 'System Diagnostics';
      const body = '<div class="test-body">Hello Admin World</div>';

      const html = renderPage(title, body);

      expect(html).toContain('<title>System Diagnostics - Admin Panel</title>');
      expect(html).toContain('<h1>System Diagnostics</h1>');
      expect(html).toContain('<div class="test-body">Hello Admin World</div>');
      expect(html).toContain('href="/admin"');
    });

    it('renders breadcrumbs and active nav highlights when currentPath is provided for a section', () => {
      const title = 'Catalog & Disney Sync';
      const body = '<div class="content">Section data</div>';

      const html = renderPage(title, body, '/admin/catalog');

      expect(html).toContain('class="breadcrumbs"');
      expect(html).toContain('Catalog &amp; Disney Sync');
      expect(html).toContain('class="dropdown-item active"');
    });

    it('omits breadcrumbs on dashboard landing page', () => {
      const html = renderPage('Admin Overview', '<div>Dashboard</div>', '/admin');
      expect(html).not.toContain('class="breadcrumbs"');
    });
  });
});

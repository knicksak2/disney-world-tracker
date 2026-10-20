/**
 * Pure functions for the photo harm-check probe:
 * - Corrupt JPEG generator
 * - Probe response analyzer and report formatter
 *
 * Implements: Task 6.6
 * Validates: Requirements 6.2, 6.6, 24.4
 */

export interface HarmProbeResult {
  readonly label: string;
  readonly status: number;
  readonly hasFlagged?: boolean | undefined;
  readonly hasCategories?: boolean | undefined;
  readonly hasCategoryScores?: boolean | undefined;
  readonly errorBody?: {
    readonly code?: string | undefined;
    readonly param?: string | undefined;
    readonly message?: string | undefined;
  } | undefined;
  readonly networkError?: string | undefined;
}

/**
 * Creates a deliberately corrupt JPEG of identical length that keeps
 * the initial magic bytes FF D8 FF and overwrites middle bytes.
 */
export function buildCorruptJpeg(goodJpeg: Uint8Array): Uint8Array {
  const corrupt = new Uint8Array(goodJpeg);
  if (corrupt.length >= 3) {
    corrupt[0] = 0xff;
    corrupt[1] = 0xd8;
    corrupt[2] = 0xff;
  }
  // Corrupt the middle bytes
  const start = Math.min(3, corrupt.length);
  const end = Math.max(start, corrupt.length - 2);
  for (let i = start; i < end; i++) {
    corrupt[i] = 0x00; // Zero out middle data
  }
  return corrupt;
}

/**
 * Analyze an HTTP response from the moderation endpoint.
 */
export function analyzeHarmResponse(label: string, status: number, data: unknown): HarmProbeResult {
  if (status >= 200 && status < 300) {
    const json = data as {
      results?: Array<{
        flagged?: boolean;
        categories?: Record<string, boolean>;
        category_scores?: Record<string, number>;
      }>;
    };
    const firstResult = json?.results?.[0];
    return {
      label,
      status,
      hasFlagged: typeof firstResult?.flagged === 'boolean',
      hasCategories: typeof firstResult?.categories === 'object' && firstResult?.categories !== null,
      hasCategoryScores:
        typeof firstResult?.category_scores === 'object' && firstResult?.category_scores !== null,
    };
  }

  const errJson = data as {
    error?: {
      code?: string;
      param?: string;
      message?: string;
    };
  };

  return {
    label,
    status,
    errorBody: {
      code: errJson?.error?.code,
      param: errJson?.error?.param,
      message: errJson?.error?.message,
    },
  };
}

/**
 * Formats probe check results into a clear readable report.
 */
export function formatHarmProbeReport(results: ReadonlyArray<HarmProbeResult>): string {
  const lines: string[] = [
    '========================================',
    '       PHOTO HARM PROBE REPORT          ',
    '========================================',
  ];

  for (const r of results) {
    lines.push(`--- Probe: ${r.label} ---`);
    if (r.networkError) {
      lines.push(`Status: NETWORK ERROR (${r.networkError})`);
      continue;
    }

    lines.push(`HTTP Status: ${r.status}`);
    if (r.status >= 200 && r.status < 300) {
      lines.push(`  results[0].flagged present: ${r.hasFlagged ? 'YES' : 'NO'}`);
      lines.push(`  results[0].categories present: ${r.hasCategories ? 'YES' : 'NO'}`);
      lines.push(`  results[0].category_scores present: ${r.hasCategoryScores ? 'YES' : 'NO'}`);
    } else {
      lines.push(`  error.code: ${r.errorBody?.code ?? 'none'}`);
      lines.push(`  error.param: ${r.errorBody?.param ?? 'none'}`);
      lines.push(`  error.message: ${r.errorBody?.message ?? 'none'}`);
    }
  }

  lines.push('========================================');
  return lines.join('\n');
}

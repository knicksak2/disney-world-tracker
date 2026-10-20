const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface AlbumCursorPayload {
  sortAt: string | Date;
  id: string;
}

export interface DecodedAlbumCursor {
  sortAt: Date;
  id: string;
}

export function encodeAlbumCursor(payload: AlbumCursorPayload): string {
  const sortAtIso = typeof payload.sortAt === 'string' ? payload.sortAt : payload.sortAt.toISOString();
  const raw = JSON.stringify({ s: sortAtIso, i: payload.id });
  return Buffer.from(raw, 'utf8').toString('base64url');
}

export function decodeAlbumCursor(cursor: string): DecodedAlbumCursor | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const { s, i } = parsed as { s?: unknown; i?: unknown };
    if (typeof s !== 'string' || typeof i !== 'string') {
      return null;
    }
    if (!UUID_REGEX.test(i)) {
      return null;
    }
    const date = new Date(s);
    if (isNaN(date.getTime())) {
      return null;
    }
    return { sortAt: date, id: i };
  } catch {
    return null;
  }
}

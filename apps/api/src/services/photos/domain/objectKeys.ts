const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface PhotoKeys {
  uploadFull: string;
  uploadThumb: string;
  full: string;
  thumb: string;
}

export function photoKeys(id: string): PhotoKeys {
  if (!UUID_REGEX.test(id)) {
    throw new TypeError(`Invalid photo UUID: ${id}`);
  }
  return {
    uploadFull: `u/${id}/full.jpg`,
    uploadThumb: `u/${id}/thumb.jpg`,
    full: `p/${id}/full.jpg`,
    thumb: `p/${id}/thumb.jpg`,
  };
}

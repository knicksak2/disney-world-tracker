import type { Park, WalkingSpeed } from '@dwt/shared';

export const PATH_FACTOR = 1.4;
export const DEFAULT_INTRA_PARK_MINUTES = 8;
export const TRANSIT_PENALTY_MINUTES = 45;

export const WALKING_SPEEDS_M_PER_MIN: Record<WalkingSpeed, number> = {
  slow: 50,
  moderate: 80,
  fast: 100,
};

export interface Coordinates {
  readonly lat: number;
  readonly lng: number;
}

const R_METERS = 6371000;

function toRad(degrees: number): number {
  return degrees * (Math.PI / 180);
}

export function haversineDistanceMeters(a: Coordinates, b: Coordinates): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);

  const aVal =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(a.lat)) *
      Math.cos(toRad(b.lat)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(aVal), Math.sqrt(1 - aVal));
  return R_METERS * c;
}

export interface TravelResult {
  readonly minutes: number;
  readonly kind: 'walk' | 'park_hop';
}

export function travelFromPrev(
  prevCoords: Coordinates | null,
  prevPark: Park | null,
  currCoords: Coordinates | null,
  currPark: Park | null,
  pace: WalkingSpeed,
): TravelResult {
  if (prevPark !== currPark) {
    return {
      minutes: TRANSIT_PENALTY_MINUTES,
      kind: 'park_hop',
    };
  }

  if (!prevCoords || !currCoords) {
    return {
      minutes: DEFAULT_INTRA_PARK_MINUTES,
      kind: 'walk',
    };
  }

  const distance = haversineDistanceMeters(prevCoords, currCoords);
  const pathDistance = distance * PATH_FACTOR;
  const speed = (pace && WALKING_SPEEDS_M_PER_MIN[pace]) || WALKING_SPEEDS_M_PER_MIN.moderate;

  const minutes = Math.round(pathDistance / speed);

  return {
    minutes,
    kind: 'walk',
  };
}

/**
 * Types of the Dining Plan repo (dining-plan-calculator design.md "Service, repo and routes"). The structural ports
 * the service reads the Party and the Trip's stays through are in `partyPort.ts`.
 */

import type {
  AgeBracket,
  DiningConfig,
  DiningEntryKind,
  DiningMealPeriod,
  DiningPlaceholderKind,
  DiningPlanSettings,
  TravelerPassType,
} from '@dwt/shared';

import type { EngineLocation, EnginePriceRow } from './engine/types.js';
import type { PlannedDiningItemRow } from './engine/reservations.js';

/** The Trip row fields the calculator reads. */
export interface DiningTripCore {
  readonly startDate: string;
  readonly endDate: string;
}

/** One stored Dining_Entry. */
export interface StoredDiningEntry {
  readonly id: string;
  readonly date: string;
  readonly mealPeriod: DiningMealPeriod;
  readonly kind: DiningEntryKind;
  readonly experienceId: string | null;
  readonly placeholderKind: DiningPlaceholderKind | null;
  readonly plannedItemId: string | null;
  readonly excludedKeys: readonly string[];
}

export interface DiningScenarioRecord {
  /** Defaults applied; an invalid stored key is logged and defaulted. */
  readonly settings: DiningPlanSettings;
  /** By date, then breakfast, lunch, dinner. */
  readonly entries: readonly StoredDiningEntry[];
}

/** A `trip_traveler_profiles` row: exactly one of `memberId` and `guestId` is set. */
export interface DiningProfileRow {
  readonly memberId: string | null;
  readonly guestId: string | null;
  readonly ageBracket: AgeBracket;
  readonly passType: TravelerPassType;
}

/** A catalog Experience as the calculator loads it: the engine's location plus what the stateless route checks. */
export interface DiningLocationRecord extends EngineLocation {
  readonly category: string;
  readonly active: boolean;
}

export interface DiningGlobals {
  readonly priceRows: readonly EnginePriceRow[];
  /** The stored config merged over `DINING_CONFIG_DEFAULTS`, key by key. */
  readonly config: DiningConfig;
}

/** A Dining_Entry write: the body of `PUT .../entries/:date/:mealPeriod` with its slot. */
export interface DiningEntryWrite {
  readonly date: string;
  readonly mealPeriod: DiningMealPeriod;
  readonly kind: DiningEntryKind;
  readonly experienceId: string | null;
  readonly placeholderKind: DiningPlaceholderKind | null;
  readonly excludedKeys: readonly string[];
}

/** One suggestion to import, in import order (each slot's winner first). */
export interface DiningImportItem {
  readonly plannedItemId: string;
  readonly experienceId: string;
  readonly date: string;
  readonly mealPeriod: DiningMealPeriod;
}

export interface DiningImportCounts {
  readonly created: number;
  readonly skippedExisting: number;
}

export interface DiningPlanRepo {
  /** Null when the Trip does not exist. */
  loadTripCore(tripId: string): Promise<DiningTripCore | null>;
  loadScenario(tripId: string): Promise<DiningScenarioRecord>;
  loadProfiles(tripId: string): Promise<readonly DiningProfileRow[]>;
  /** Dining reservations and plain planned Restaurant items of the Trip (design.md "Planned-restaurant import"). */
  loadPlannedDiningItems(tripId: string): Promise<readonly PlannedDiningItemRow[]>;
  /** Always two statements, even for an empty id list. Ids with no Experience are absent from the map. */
  loadLocations(experienceIds: readonly string[]): Promise<ReadonlyMap<string, DiningLocationRecord>>;
  /** Always two statements. */
  loadGlobals(): Promise<DiningGlobals>;
  saveSettings(tripId: string, settings: DiningPlanSettings): Promise<void>;
  upsertEntry(tripId: string, entry: DiningEntryWrite): Promise<void>;
  /** True when a slot was cleared. */
  deleteEntry(tripId: string, date: string, mealPeriod: DiningMealPeriod): Promise<boolean>;
  importEntries(tripId: string, items: readonly DiningImportItem[], overwrite: boolean): Promise<DiningImportCounts>;
}

/** Where an invalid stored value is reported (the repo defaults it and carries on). */
export interface DiningPlanLogger {
  warn(obj: object, msg?: string): void;
}

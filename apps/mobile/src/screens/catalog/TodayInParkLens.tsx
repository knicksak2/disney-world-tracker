// Feature: experience-detail-redesign, Task 18.3 — Today_In_Park_Lens
//
// Validates: Requirements 14.1, 14.2, 14.3, 14.4
//
// Today_In_Park_Lens contains:
//   1. LiveWaitCockpit (Ride / Character_Meet) OR DiningReservationCard (Restaurant)
//      OR ShowtimesCard (Show / Character_Meet when showtimes) OR neither (when liveSectionFor returns 'none')
//   2. LocationGroupSection with Static_Map_Preview and Get_Directions_Action for every category

import React from 'react';
import { View } from 'react-native';
import type {
  ExperienceCategory,
  LiveDetailResponseDTO,
  MenuDTO,
} from '@dwt/shared';

import { liveSectionFor, NO_LIVE_SHAPE, type LiveShape } from './gating';
import type { TagGroup } from './infoTags';
import LiveWaitCockpit, { WaitContextMode } from './LiveWaitCockpit';
import DiningReservationCard from './DiningReservationCard';
import MenuSummaryCard from './MenuSummaryCard';
import ShowtimesCard from './ShowtimesCard';
import LocationGroupSection from './LocationGroupSection';

export interface TodayInParkLensProps {
  readonly experienceId: string;
  readonly experienceName: string;
  readonly category: ExperienceCategory;
  readonly diningUrl?: string | null | undefined;
  readonly menus?: readonly MenuDTO[] | undefined;
  readonly liveDetail?: LiveDetailResponseDTO['liveDetail'] | undefined;
  readonly liveError?: boolean | undefined;
  readonly locationGroup?: TagGroup | undefined;
  readonly latitude?: number | null | undefined;
  readonly longitude?: number | null | undefined;
  readonly plannedDate?: string | null | undefined;
  readonly activeTripRange?:
    | { readonly startDate: string; readonly endDate: string }
    | null
    | undefined;
  readonly todayWdw?: string | undefined;
  readonly waitContext?: WaitContextMode | undefined;
  readonly onWaitContextChange?: ((context: WaitContextMode) => void) | undefined;
  readonly onReserve: (url: string) => void;
  readonly reservationFailed?: boolean | undefined;
  readonly onLogFoodItem?: (() => void) | undefined;
  readonly onMyLoggedItems?: (() => void) | undefined;
  readonly loggedDishesCount?: number | undefined;
  readonly isQuickService?: boolean | undefined;
}

export default function TodayInParkLens({
  experienceId,
  experienceName,
  category,
  diningUrl,
  menus,
  liveDetail,
  liveError,
  locationGroup,
  latitude,
  longitude,
  plannedDate,
  activeTripRange,
  todayWdw,
  waitContext,
  onWaitContextChange,
  onReserve,
  reservationFailed,
  onLogFoodItem,
  onMyLoggedItems,
  loggedDishesCount,
  isQuickService,
}: TodayInParkLensProps): JSX.Element {
  const liveShape: LiveShape = liveDetail
    ? {
        hasStandbyWait:
          typeof liveDetail.waitMinutes === 'number' && !Number.isNaN(liveDetail.waitMinutes),
        hasShowtimes:
          Array.isArray(liveDetail.showtimes) && liveDetail.showtimes.length > 0,
      }
    : NO_LIVE_SHAPE;

  const section = liveSectionFor(category, liveShape);

  return (
    <View testID="today-in-park-lens">
      {/* 1. Category-dispatched live / operational section (R14.1-R14.3) */}
      {!liveError && section === 'wait_status' ? (
        <LiveWaitCockpit
          experienceId={experienceId}
          liveDetail={liveDetail}
          plannedDate={plannedDate}
          activeTripRange={activeTripRange}
          todayWdw={todayWdw}
          waitContext={waitContext}
          onWaitContextChange={onWaitContextChange}
        />
      ) : section === 'dining' ? (
        <>
          <DiningReservationCard
            experienceName={experienceName}
            diningUrl={diningUrl}
            liveDetail={liveDetail}
            isQuickService={isQuickService}
            onReserve={onReserve}
            reservationFailed={reservationFailed}
            onLogFoodItem={onLogFoodItem}
            onMyLoggedItems={onMyLoggedItems}
            loggedDishesCount={loggedDishesCount}
          />
          {menus && menus.length > 0 ? (
            <MenuSummaryCard
              category={category}
              menus={menus}
              isLoading={false}
              isError={false}
              experienceId={experienceId}
            />
          ) : null}
        </>
      ) : section === 'showtimes' ? (
        <ShowtimesCard showtimes={liveDetail?.showtimes} />
      ) : null}

      {/* 2. Location_Group with Static_Map_Preview and Get_Directions_Action for every category (R14.4) */}
      <LocationGroupSection
        group={locationGroup}
        experienceName={experienceName}
        latitude={latitude}
        longitude={longitude}
      />
    </View>
  );
}

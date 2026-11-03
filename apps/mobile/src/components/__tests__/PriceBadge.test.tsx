// Feature: trip-budget, Property 39: Attribution is present and no route exports raw prices
// Validates: Requirements 5.3, 21.3, 21.4, 22.5

import React from 'react';
import { Linking } from 'react-native';
import { render, fireEvent, screen } from '@testing-library/react-native';

import {
  DISNEY_NOT_COVERED_NOTE,
  PriceBadge,
  THEMEPARKS_WIKI_CREDIT,
  THEMEPARKS_WIKI_URL,
  formatDisneySourceLine,
} from '../PriceBadge';

/** Screens and components rendering ticket or Lightning Lane prices. */
export const PRICE_SCREENS = [
  'PriceBadge',
  'TripBudgetScreen',
  'BudgetLineFormModal',
] as const;

describe('PriceBadge (Task 17.2, Requirements 5.3, 21.3, 21.4, 22.5)', () => {
  let openUrlSpy: jest.SpyInstance;

  beforeEach(() => {
    openUrlSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
  });

  afterEach(() => {
    openUrlSpy.mockRestore();
  });

  describe('price label text rendering (Requirement 5.3)', () => {
    it('renders "Your price" for your_price kind', () => {
      render(
        <PriceBadge
          priceLabelKind="your_price"
          effectivePriceSource="user_entered"
        />
      );
      expect(screen.getByText('Your price')).toBeTruthy();
      expect(screen.getByLabelText('Your price')).toBeTruthy();
    });

    it('renders "Add your price" for add_your_price kind', () => {
      render(
        <PriceBadge
          priceLabelKind="add_your_price"
          effectivePriceSource="user_entered"
        />
      );
      expect(screen.getByText('Add your price')).toBeTruthy();
      expect(screen.getByLabelText('Add your price')).toBeTruthy();
    });

    it('renders "Estimate, as of <date>" for estimate kind with date', () => {
      render(
        <PriceBadge
          priceLabelKind="estimate"
          effectivePriceSource="typical_estimate"
          asOfDate="2026-10-25"
        />
      );
      const expected = 'Estimate, as of Oct 25, 2026';
      expect(screen.getByText(expected)).toBeTruthy();
      expect(screen.getByLabelText(expected)).toBeTruthy();
    });

    it('renders "Estimate" for estimate kind without date', () => {
      render(
        <PriceBadge
          priceLabelKind="estimate"
          effectivePriceSource="typical_estimate"
        />
      );
      expect(screen.getByText('Estimate')).toBeTruthy();
      expect(screen.getByLabelText('Estimate')).toBeTruthy();
    });

    it('renders current ticket price label with date', () => {
      render(
        <PriceBadge
          priceLabelKind="current"
          effectivePriceSource="disney_ticket_calendar"
          asOfDate="2026-10-25"
        />
      );
      const expected = 'Disney price, as of Oct 25, 2026';
      expect(screen.getByText(expected)).toBeTruthy();
      expect(screen.getByLabelText(expected)).toBeTruthy();
    });

    it('renders current Lightning Lane price label with date', () => {
      render(
        <PriceBadge
          priceLabelKind="current"
          effectivePriceSource="themeparks_ll"
          asOfDate="2026-10-25"
        />
      );
      const expected = 'Lightning Lane price, as of Oct 25, 2026';
      expect(screen.getByText(expected)).toBeTruthy();
      expect(screen.getByLabelText(expected)).toBeTruthy();
    });

    it('renders current menu price label with date', () => {
      render(
        <PriceBadge
          priceLabelKind="current"
          effectivePriceSource="disney_menu"
          asOfDate="2026-10-25"
        />
      );
      const expected = 'Disney menu price (before tax), as of Oct 25, 2026';
      expect(screen.getByText(expected)).toBeTruthy();
      expect(screen.getByLabelText(expected)).toBeTruthy();
    });

    it('renders may_have_changed labels with date', () => {
      render(
        <PriceBadge
          priceLabelKind="may_have_changed"
          effectivePriceSource="disney_ticket_calendar"
          asOfDate="2026-10-25"
        />
      );
      const expectedTicket = 'Disney price, as of Oct 25, 2026 (may have changed)';
      expect(screen.getByText(expectedTicket)).toBeTruthy();
      expect(screen.getByLabelText(expectedTicket)).toBeTruthy();
    });

    it('renders may_have_changed for Lightning Lane', () => {
      render(
        <PriceBadge
          priceLabelKind="may_have_changed"
          effectivePriceSource="themeparks_ll"
          asOfDate="2026-10-25"
        />
      );
      const expectedLl = 'Lightning Lane price, as of Oct 25, 2026 (may have changed)';
      expect(screen.getByText(expectedLl)).toBeTruthy();
      expect(screen.getByLabelText(expectedLl)).toBeTruthy();
    });

    it('renders may_have_changed for menu items', () => {
      render(
        <PriceBadge
          priceLabelKind="may_have_changed"
          effectivePriceSource="disney_menu"
          asOfDate="2026-10-25"
        />
      );
      const expectedMenu = 'Disney menu price (before tax), as of Oct 25, 2026 (may have changed)';
      expect(screen.getByText(expectedMenu)).toBeTruthy();
      expect(screen.getByLabelText(expectedMenu)).toBeTruthy();
    });
  });

  describe('Attribution lines (Requirements 21.3, 21.4, Property 39)', () => {
    it('shows "Powered by ThemeParks.wiki" credit for themeparks_ll source', () => {
      render(
        <PriceBadge
          priceLabelKind="current"
          effectivePriceSource="themeparks_ll"
          asOfDate="2026-10-25"
        />
      );

      const link = screen.getByLabelText(THEMEPARKS_WIKI_CREDIT);
      expect(link).toBeTruthy();
      expect(screen.getByText(THEMEPARKS_WIKI_CREDIT)).toBeTruthy();
      expect(screen.queryByText(/Prices from Disney's website/)).toBeNull();

      fireEvent.press(link);
      expect(openUrlSpy).toHaveBeenCalledWith(THEMEPARKS_WIKI_URL);
    });

    it('shows "Powered by ThemeParks.wiki" when attribution="themeparks_wiki" is explicit', () => {
      render(
        <PriceBadge
          priceLabelKind="estimate"
          effectivePriceSource="typical_estimate"
          attribution="themeparks_wiki"
          asOfDate="2026-10-25"
        />
      );

      const link = screen.getByLabelText(THEMEPARKS_WIKI_CREDIT);
      expect(link).toBeTruthy();
      fireEvent.press(link);
      expect(openUrlSpy).toHaveBeenCalledWith(THEMEPARKS_WIKI_URL);
    });

    it('shows Disney neutral source line and not-covered note for ticket price with date', () => {
      render(
        <PriceBadge
          priceLabelKind="current"
          effectivePriceSource="disney_ticket_calendar"
          asOfDate="2026-10-25"
        />
      );

      const expectedSource =
        "Prices from Disney's website, as of Oct 25, 2026; final price at checkout may differ";
      expect(screen.getByText(expectedSource)).toBeTruthy();
      expect(screen.getByLabelText(expectedSource)).toBeTruthy();

      expect(screen.getByText(DISNEY_NOT_COVERED_NOTE)).toBeTruthy();
      expect(screen.getByLabelText(DISNEY_NOT_COVERED_NOTE)).toBeTruthy();

      expect(screen.queryByText(THEMEPARKS_WIKI_CREDIT)).toBeNull();
    });

    it('shows Disney source line without date when asOfDate is not provided', () => {
      render(
        <PriceBadge
          priceLabelKind="current"
          effectivePriceSource="disney_ticket_calendar"
        />
      );

      const expectedSource =
        "Prices from Disney's website; final price at checkout may differ";
      expect(screen.getByText(expectedSource)).toBeTruthy();
      expect(screen.getByLabelText(expectedSource)).toBeTruthy();
      expect(screen.getByText(DISNEY_NOT_COVERED_NOTE)).toBeTruthy();
    });

    it('shows Disney attribution when attribution="disney" is explicitly passed', () => {
      render(
        <PriceBadge
          priceLabelKind="current"
          effectivePriceSource="typical_estimate"
          attribution="disney"
          asOfDate="2026-10-25"
        />
      );

      expect(
        screen.getByText(
          "Prices from Disney's website, as of Oct 25, 2026; final price at checkout may differ"
        )
      ).toBeTruthy();
      expect(screen.getByText(DISNEY_NOT_COVERED_NOTE)).toBeTruthy();
    });

    it('omits attribution when showAttribution is false', () => {
      render(
        <PriceBadge
          priceLabelKind="current"
          effectivePriceSource="themeparks_ll"
          showAttribution={false}
        />
      );

      expect(screen.queryByText(THEMEPARKS_WIKI_CREDIT)).toBeNull();
      expect(screen.queryByLabelText(THEMEPARKS_WIKI_CREDIT)).toBeNull();
    });

    it('omits attribution when attribution="none"', () => {
      render(
        <PriceBadge
          priceLabelKind="current"
          effectivePriceSource="disney_ticket_calendar"
          attribution="none"
        />
      );

      expect(screen.queryByText(/Prices from Disney's website/)).toBeNull();
      expect(screen.queryByText(DISNEY_NOT_COVERED_NOTE)).toBeNull();
    });

    it('omits attribution for user_entered source by default', () => {
      render(
        <PriceBadge
          priceLabelKind="your_price"
          effectivePriceSource="user_entered"
        />
      );

      expect(screen.queryByText(THEMEPARKS_WIKI_CREDIT)).toBeNull();
      expect(screen.queryByText(/Prices from Disney's website/)).toBeNull();
    });
  });

  describe('formatDisneySourceLine helper', () => {
    it('formats with date', () => {
      expect(formatDisneySourceLine('2026-10-25')).toBe(
        "Prices from Disney's website, as of Oct 25, 2026; final price at checkout may differ"
      );
    });

    it('formats without date', () => {
      expect(formatDisneySourceLine(null)).toBe(
        "Prices from Disney's website; final price at checkout may differ"
      );
      expect(formatDisneySourceLine(undefined)).toBe(
        "Prices from Disney's website; final price at checkout may differ"
      );
    });
  });
});


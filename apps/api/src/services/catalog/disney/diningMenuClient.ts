/**
 * Public dining-menu source for demand-driven menu retrieval
 * (restaurant-menu-display).
 *
 * Background
 * ----------
 * The original reverse-engineered `Menu_Service` finder
 * (`api.wdprapps.disney.com/explorer-service/public/finder/dining-menus/{id}`)
 * rejects the app's anonymous `AUTHZ_PUBLIC-INSECURE` token with
 * `403 "Client does not have one of the required scopes"` — it needs a
 * guest-authenticated token the app does not have. However, Disney's PUBLIC
 * website serves the same menus to anonymous visitors through its own
 * dining-menu app API:
 *
 *     GET https://disneyworld.disney.go.com/dining/dinemenu/api/menu?searchTerm={term}
 *
 * where `{term}` may be the restaurant's URL slug OR its facility/Enterprise_Id
 * (all of `90001212`, `90001212;entityType=restaurant`, and the slug resolve to
 * the same menu). No Authorization header is required. Because the catalog
 * already persists the Enterprise_Id as `upstream_entity_id`, we can query by
 * that directly — no slug resolution needed.
 *
 * Response shape (undocumented; modeled defensively):
 *
 *   {
 *     name, location, destinationId,
 *     mealPeriodsList: [{ name, label, isActive? }],
 *     mealPeriods: [
 *       { name, label, experience, serviceStyle,
 *         groups: [
 *           { name, type, items: [
 *             { title, prices: [{ withoutTax, type, currency }], pricesRange, description }
 *           ]}
 *         ]}
 *     ]
 *   }
 *
 * This module exposes a {@link MenuFetchClient}-compatible `getMenus` so it drops
 * straight into `createMenuRetrieval` in place of the Facilities_Client. It maps
 * the website payload into the existing tolerant {@link RawMenu} shape, so the
 * pure `projectMenus` core (and its property test) are reused unchanged:
 *
 *   - one `RawMenu` per meal period (`menuType` = the meal period's label/name),
 *   - `cuisineType` = `null` (the website payload carries no cuisine field),
 *   - each group's `name` and item order preserved,
 *   - each item's `name` = its `title`, and `price` = a string formatted from the
 *     `prices[]` array (`null` when the item carries no structured price).
 *
 * Every request flows through the shared {@link DisneyTransport} (target `web`),
 * so it draws from the single authoritative Request_Budget and the browser-like
 * `Web_User_Agent`, never reintroducing a burst.
 */

import { createLogger } from '../../../logger.js';
import type { DisneyTransport } from './transport.js';
import type { RawMenu, RawMenuGroup, RawMenuItem } from './menu.js';

/** Public dining-menu API base the anonymous website itself calls. */
export const DISNEY_DINING_MENU_DEFAULT_BASE_URL =
  'https://disneyworld.disney.go.com/dining/dinemenu/api/menu';

/** The Menu_Service portion of a retrieval client: `getMenus(term) → RawMenu[]`. */
export interface DiningMenuClient {
  getMenus(searchTerm: string): Promise<readonly RawMenu[]>;
}

/**
 * Minimal logger surface used to make menu-source breakages observable. `warn`
 * flags an unexpected/changed upstream contract (non-JSON body, or a 200 with
 * no `mealPeriods` array); `debug` records the benign "no published menu" case.
 * A `pino` logger satisfies this structurally.
 */
export interface DiningMenuLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
  debug(obj: Record<string, unknown>, msg: string): void;
}

export interface DiningMenuClientOptions {
  /** Shared Disney transport (rate limiting + UA + retry/backoff). */
  readonly transport: DisneyTransport;
  /** Override the dining-menu API base URL; defaults to the public endpoint. */
  readonly baseUrl?: string;
  /** Logger for source-contract observability; defaults to the shared logger. */
  readonly logger?: DiningMenuLogger;
}

// ---------------------------------------------------------------------------
// Pure payload → RawMenu[] mapping
// ---------------------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** Currency-code → symbol for the common cases; falls back to a code prefix. */
function currencySymbol(currency: unknown): string {
  switch (currency) {
    case 'USD':
      return '$';
    case 'EUR':
      return '\u20ac';
    case 'GBP':
      return '\u00a3';
    default:
      return typeof currency === 'string' && currency.length > 0 ? `${currency} ` : '';
  }
}

/**
 * Format a single dinemenu item's `prices[]` array into a display price string,
 * or `null` when there is no structured price (some items embed the price in
 * the title instead, in which case the name alone is shown — R5.7).
 *
 * Examples: `[{withoutTax:20,currency:"USD"}]` → `"$20"`;
 * `[{withoutTax:12,currency:"USD"},{withoutTax:18,currency:"USD"}]` → `"$12 / $18"`.
 */
export function formatDiningPrice(prices: unknown): string | null {
  if (!Array.isArray(prices) || prices.length === 0) {
    return null;
  }
  const parts: string[] = [];
  for (const entry of prices) {
    if (!isObject(entry)) continue;
    const amount = entry['withoutTax'];
    if (typeof amount !== 'number' || !Number.isFinite(amount)) continue;
    // Trim a trailing `.0` while keeping cents when present.
    const amountStr = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
    parts.push(`${currencySymbol(entry['currency'])}${amountStr}`);
  }
  return parts.length > 0 ? parts.join(' / ') : null;
}

function mapItem(raw: unknown): RawMenuItem | null {
  if (!isObject(raw)) return null;
  const name = asString(raw['title']) ?? asString(raw['name']);
  if (name === undefined) return null;
  return { name, price: formatDiningPrice(raw['prices']) };
}

function mapGroup(raw: unknown): RawMenuGroup | null {
  if (!isObject(raw)) return null;
  const itemsRaw = Array.isArray(raw['items']) ? raw['items'] : [];
  const items = itemsRaw.map(mapItem).filter((i): i is RawMenuItem => i !== null);
  return { name: asString(raw['name']) ?? '', items };
}

/**
 * Pure, total mapping of the website dining-menu payload into the tolerant
 * {@link RawMenu}[] shape consumed by `projectMenus`. One `RawMenu` per meal
 * period, preserving meal-period, group, and item order. Any unexpected shape
 * (including the `{statusCode:404}` "no menu" body) yields `[]`.
 */
export function projectDiningMenuPayload(body: unknown): readonly RawMenu[] {
  if (!isObject(body)) return [];
  const mealPeriods = body['mealPeriods'];
  if (!Array.isArray(mealPeriods)) return [];

  const menus: RawMenu[] = [];
  for (const mp of mealPeriods) {
    if (!isObject(mp)) continue;
    const menuType = asString(mp['label']) ?? asString(mp['name']) ?? '';
    const groupsRaw = Array.isArray(mp['groups']) ? mp['groups'] : [];
    const groups = groupsRaw.map(mapGroup).filter((g): g is RawMenuGroup => g !== null);
    menus.push({ menuType, cuisineType: null, groups });
  }
  return menus;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * Build a {@link DiningMenuClient} whose `getMenus(searchTerm)` fetches a
 * restaurant's menus from the public website dining-menu API through the shared
 * transport and projects them to {@link RawMenu}[]. `searchTerm` is the
 * restaurant's Enterprise_Id (`upstream_entity_id`), which the endpoint accepts
 * directly.
 *
 * An HTTP 404 (restaurant with no published menu) is treated as "no menus"
 * (`[]`) rather than an error, so the enclosing retrieval seam caches an empty
 * result instead of logging a failure. Any other transport error propagates to
 * the seam, which degrades to the prior cache without throwing (R3.3–R3.5).
 */
export function createDiningMenuClient(options: DiningMenuClientOptions): DiningMenuClient {
  const base = (options.baseUrl ?? DISNEY_DINING_MENU_DEFAULT_BASE_URL).replace(/\/+$/, '');
  const logger = options.logger ?? createLogger();

  return {
    async getMenus(searchTerm: string): Promise<readonly RawMenu[]> {
      const url = `${base}?searchTerm=${encodeURIComponent(searchTerm)}`;
      let text: string;
      try {
        const response = await options.transport.request({
          target: 'web',
          url,
          method: 'GET',
          accept: 'application/json',
        });
        text = response.text;
      } catch (err) {
        // A 404 means the restaurant has no published menu — treat as empty
        // rather than an upstream failure. Anything else is a real error the
        // caller (retrieval seam) will handle by degrading to cache + logging.
        if (isHttpStatus(err, 404)) {
          logger.debug({ searchTerm }, 'dining-menu: 404, no published menu');
          return [];
        }
        throw err;
      }

      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        // A 2xx that is not JSON means the endpoint contract changed (or an
        // edge/interstitial page was served). Flag it — this is the failure
        // mode that would otherwise masquerade as "every restaurant has no
        // menu" without any error surfacing.
        logger.warn(
          { searchTerm, bodyPreview: text.slice(0, 200) },
          'dining-menu: response was not JSON; menu source contract may have changed',
        );
        return [];
      }

      // The website returns `{ statusCode: 404 }` for an unknown/menuless term.
      if (isObject(body) && body['statusCode'] === 404) {
        logger.debug({ searchTerm }, 'dining-menu: statusCode 404, no published menu');
        return [];
      }

      // A 200 whose body carries no `mealPeriods` array is not the documented
      // shape. Distinguish it from a legitimately empty menu (an EMPTY
      // `mealPeriods` array) so a silent upstream change is caught early.
      if (!isObject(body) || !Array.isArray(body['mealPeriods'])) {
        logger.warn(
          {
            searchTerm,
            bodyKeys: isObject(body) ? Object.keys(body) : typeof body,
          },
          'dining-menu: response missing `mealPeriods` array; menu source contract may have changed',
        );
        return [];
      }

      return projectDiningMenuPayload(body);
    },
  };
}

/** True when `err` is a DisneyTransportError-like value carrying `status`. */
function isHttpStatus(err: unknown, status: number): boolean {
  return isObject(err) && 'status' in err && (err as { status?: unknown }).status === status;
}

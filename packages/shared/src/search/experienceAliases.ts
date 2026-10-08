/**
 * Curated acronym, nickname, and colloquial alias dictionary for Disney World experiences.
 *
 * Implements:
 *   - experience-search-aliases Property 1 (Requirements 1.1-1.5)
 */

import { normalizeSearchText } from './normalization.js';

export interface SearchAliasEntry {
  /**
   * One or more normalized substrings or patterns identifying the target Experience(s).
   * E.g. ['rise of the resistance'] or ['seven dwarfs mine train'].
   */
  readonly targetSubstrings: readonly string[];
  /**
   * Colloquial acronyms, nicknames, and community search phrases.
   */
  readonly aliases: readonly string[];
}

/**
 * Curated Disney World attraction and dining aliases.
 */
export const CURATED_EXPERIENCE_ALIASES: readonly SearchAliasEntry[] = [
  // Magic Kingdom Headliners & Classics
  {
    targetSubstrings: ['seven dwarfs mine train'],
    aliases: ['7dmt', 'sdmt', 'mine train', 'dwarfs mine train', 'seven dwarfs'],
  },
  {
    targetSubstrings: ['space mountain'],
    aliases: ['space mtn', 'space'],
  },
  {
    targetSubstrings: ['big thunder mountain railroad'],
    aliases: ['btmrr', 'btm', 'big thunder', 'thunder mountain'],
  },
  {
    targetSubstrings: ['tomorrowland transit authority peoplemover', 'peoplemover'],
    aliases: ['people mover', 'peoplemover', 'tta', 'transit authority', 'blue line'],
  },
  {
    targetSubstrings: ['tron lightcycle'],
    aliases: ['tron', 'lightcycle', 'light cycle'],
  },
  {
    targetSubstrings: ['haunted mansion'],
    aliases: ['hm', 'mansion', '999 happy haunts'],
  },
  {
    targetSubstrings: ['pirates of the caribbean'],
    aliases: ['potc', 'pirates', 'jack sparrow'],
  },
  {
    targetSubstrings: ['peter pans flight', 'peter pan'],
    aliases: ['peter pan'],
  },
  {
    targetSubstrings: ['it is a small world', 'its a small world', 'small world'],
    aliases: ['iasw', 'small world'],
  },
  {
    targetSubstrings: ['jungle cruise'],
    aliases: ['jc', 'jungle cruise', 'skipper tour'],
  },
  {
    targetSubstrings: ['buzz lightyear'],
    aliases: ['space ranger spin', 'buzz ranger', 'zurg'],
  },
  {
    targetSubstrings: ['mad tea party'],
    aliases: ['tea cups', 'teacups', 'spinning tea cups'],
  },
  {
    targetSubstrings: ['many adventures of winnie the pooh'],
    aliases: ['winnie the pooh', 'pooh ride'],
  },
  {
    targetSubstrings: ['walt disneys carousel of progress', 'carousel of progress'],
    aliases: ['cop', 'carousel of progress'],
  },
  {
    targetSubstrings: ['enchanted tiki room', 'tiki room'],
    aliases: ['tiki room', 'tiki birds'],
  },
  {
    targetSubstrings: ['country bear'],
    aliases: ['cbj', 'country bears', 'bear jamboree'],
  },
  {
    targetSubstrings: ['hall of presidents'],
    aliases: ['hop', 'hall of presidents'],
  },
  {
    targetSubstrings: ['mickeys philharmagic', 'philharmagic'],
    aliases: ['philharmagic'],
  },
  {
    targetSubstrings: ['tianas bayou adventure', 'tiana'],
    aliases: ['tiana', 'bayou adventure', 'tianas bayou'],
  },
  {
    targetSubstrings: ['under the sea journey of the little mermaid', 'little mermaid'],
    aliases: ['little mermaid', 'under the sea'],
  },

  // EPCOT Headliners & Pavilions
  {
    targetSubstrings: ['guardians of the galaxy cosmic rewind', 'cosmic rewind'],
    aliases: ['gotg', 'cosmic rewind', 'guardians', 'cosmic'],
  },
  {
    targetSubstrings: ['test track'],
    aliases: ['tt', 'test track'],
  },
  {
    targetSubstrings: ['soarin'],
    aliases: ['soarin', 'soaring'],
  },
  {
    targetSubstrings: ['spaceship earth'],
    aliases: ['se', 'spaceship earth', 'epcot ball', 'the ball'],
  },
  {
    targetSubstrings: ['remys ratatouille adventure', 'ratatouille'],
    aliases: ['remy', 'ratatouille', 'remys'],
  },
  {
    targetSubstrings: ['frozen ever after'],
    aliases: ['fea', 'frozen ride', 'elsa ride'],
  },
  {
    targetSubstrings: ['living with the land'],
    aliases: ['lwtl', 'living with the land', 'greenhouse ride'],
  },
  {
    targetSubstrings: ['mission space'],
    aliases: ['mission space', 'orange mission', 'green mission'],
  },
  {
    targetSubstrings: ['journey into imagination with figment', 'figment'],
    aliases: ['figment', 'imagination ride'],
  },
  {
    targetSubstrings: ['gran fiesta tour'],
    aliases: ['three caballeros', 'mexico boat ride'],
  },
  {
    targetSubstrings: ['seas with nemo and friends'],
    aliases: ['nemo ride', 'the seas'],
  },

  // Disney's Hollywood Studios Headliners
  {
    targetSubstrings: ['star wars rise of the resistance', 'rise of the resistance'],
    aliases: ['rotr', 'rise', 'rise of the resistance'],
  },
  {
    targetSubstrings: ['millennium falcon smugglers run', 'smugglers run'],
    aliases: ['mfsr', 'smugglers run', 'falcon', 'millennium falcon'],
  },
  {
    targetSubstrings: ['slinky dog dash'],
    aliases: ['sdd', 'slinky', 'slinky dog'],
  },
  {
    targetSubstrings: ['twilight zone tower of terror', 'tower of terror'],
    aliases: ['tot', 'tower of terror', 'tower', 'hollywood tower hotel'],
  },
  {
    targetSubstrings: ['rock and roller coaster starring aerosmith', 'rock and roller coaster'],
    aliases: ['rnrc', 'rock n roller', 'rock and roller', 'aerosmith'],
  },
  {
    targetSubstrings: ['mickey and minnies runaway railway', 'runaway railway'],
    aliases: ['mmrr', 'runaway railway'],
  },
  {
    targetSubstrings: ['toy story mania'],
    aliases: ['tsm', 'tsmm', 'toy story mania', 'midway mania'],
  },
  {
    targetSubstrings: ['alien swirling saucers'],
    aliases: ['alien swirling saucers', 'swirling saucers'],
  },
  {
    targetSubstrings: ['star tours'],
    aliases: ['star tours'],
  },
  {
    targetSubstrings: ['muppet vision 3d', 'muppetvision'],
    aliases: ['muppets', 'muppet vision', 'kermit'],
  },
  {
    targetSubstrings: ['indiana jones epic stunt spectacular'],
    aliases: ['indy', 'indiana jones'],
  },
  {
    targetSubstrings: ['fantasmic'],
    aliases: ['fantasmic'],
  },

  // Disney's Animal Kingdom Headliners
  {
    targetSubstrings: ['avatar flight of passage', 'flight of passage'],
    aliases: ['fop', 'flight of passage', 'banshee ride'],
  },
  {
    targetSubstrings: ['navi river journey'],
    aliases: ['nrj', 'river journey', 'navi', 'shaman ride'],
  },
  {
    targetSubstrings: ['expedition everest legend of the forbidden mountain', 'expedition everest'],
    aliases: ['ee', 'everest', 'expedition everest', 'yeti'],
  },
  {
    targetSubstrings: ['kilimanjaro safaris'],
    aliases: ['ks', 'safari', 'safaris', 'kilimanjaro'],
  },
  {
    targetSubstrings: ['dinosaur'],
    aliases: ['dinosaur', 'countdown to extinction'],
  },
  {
    targetSubstrings: ['kali river rapids'],
    aliases: ['kali', 'river rapids', 'kali rapids'],
  },
  {
    targetSubstrings: ['festival of the lion king'],
    aliases: ['fotlk', 'lion king show'],
  },
  {
    targetSubstrings: ['its tough to be a bug', 'tough to be a bug'],
    aliases: ['ittbab', 'tough to be a bug'],
  },

  // Dining & Snack Hotspots Across Property
  {
    targetSubstrings: ['aloha isle', 'pineapple lanai', 'sunshine tree terrace', 'swirls on the water'],
    aliases: ['dole whip', 'dolewhip'],
  },
  {
    targetSubstrings: ['be our guest restaurant', 'be our guest'],
    aliases: ['bog', 'be our guest', 'beast castle'],
  },
  {
    targetSubstrings: ['cinderellas royal table', 'cinderella royal table'],
    aliases: ['crt', 'royal table', 'cinderellas table', 'castle dining'],
  },
  {
    targetSubstrings: ['space 220'],
    aliases: ['space 220', 'space restaurant'],
  },
  {
    targetSubstrings: ['columbia harbour house'],
    aliases: ['chh', 'columbia harbour', 'harbour house'],
  },
  {
    targetSubstrings: ['caseys corner'],
    aliases: ['caseys', 'corn dog nuggets'],
  },
  {
    targetSubstrings: ['ogas cantina'],
    aliases: ['ogas', 'ogas cantina', 'cantina', 'star wars bar'],
  },
  {
    targetSubstrings: ['sci fi dine in'],
    aliases: ['sci fi', 'scifi', 'sci fi dine in'],
  },
  {
    targetSubstrings: ['50s prime time cafe'],
    aliases: ['50s prime time', 'prime time cafe'],
  },
  {
    targetSubstrings: ['woodys lunch box'],
    aliases: ['woodys lunch box', 'woodys', 'totchos'],
  },
  {
    targetSubstrings: ['satuli canteen'],
    aliases: ['satuli', 'satuli canteen', 'avatar bowls'],
  },
  {
    targetSubstrings: ['yak and yeti restaurant', 'yak and yeti'],
    aliases: ['yak and yeti'],
  },
  {
    targetSubstrings: ['flame tree barbecue'],
    aliases: ['flame tree', 'flame tree bbq'],
  },
  {
    targetSubstrings: ['ohana'],
    aliases: ['ohana', 'lilo stitch breakfast'],
  },
  {
    targetSubstrings: ['trader sams grog grotto', 'trader sam'],
    aliases: ['trader sams', 'trader sam', 'grog grotto'],
  },
  {
    targetSubstrings: ['chef mickeys', 'chef mickey'],
    aliases: ['chef mickeys', 'chef mickey'],
  },
  {
    targetSubstrings: ['california grill'],
    aliases: ['cal grill', 'california grill'],
  },
  {
    targetSubstrings: ['topolinos terrace'],
    aliases: ['topolinos', 'topolino'],
  },
  {
    targetSubstrings: ['sanaa'],
    aliases: ['sanaa', 'bread service'],
  },
  {
    targetSubstrings: ['beaches and cream soda shop'],
    aliases: ['beaches and cream', 'kitchen sink'],
  },
  {
    targetSubstrings: ['gideons bakehouse'],
    aliases: ['gideons', 'gideons cookies'],
  },
  {
    targetSubstrings: ['chef art smiths homecomin', 'homecomin'],
    aliases: ['homecomin', 'homecoming', 'art smith'],
  },
];

export interface AliasMatchResult {
  readonly isMatch: boolean;
  readonly isExact: boolean;
}

/**
 * Checks whether an experience's normalized name matches any alias for the given query.
 *
 * Returns:
 * - isMatch: true if the query matches an alias pointing to this experience.
 * - isExact: true if normalizedQuery exactly equals a normalized alias.
 */
export function checkExperienceAliasMatch(
  normalizedName: string,
  normalizedQuery: string,
): AliasMatchResult {
  if (normalizedQuery.length === 0) {
    return { isMatch: false, isExact: false };
  }

  let foundPartial = false;

  for (const entry of CURATED_EXPERIENCE_ALIASES) {
    // Check if this entry points to the experience being evaluated
    const targetsExperience = entry.targetSubstrings.some((target) => {
      const normTarget = normalizeSearchText(target);
      return normalizedName.includes(normTarget);
    });

    if (!targetsExperience) {
      continue;
    }

    // Check each alias in this entry
    for (const alias of entry.aliases) {
      const normAlias = normalizeSearchText(alias);

      if (normAlias === normalizedQuery) {
        return { isMatch: true, isExact: true };
      }

      // Check prefix matching (query length >= 3 for prefix) or query contains the alias
      if (
        (normalizedQuery.length >= 3 && normAlias.startsWith(normalizedQuery)) ||
        (normAlias.length >= 4 && normalizedQuery.includes(normAlias))
      ) {
        foundPartial = true;
      }
    }
  }

  return { isMatch: foundPartial, isExact: false };
}

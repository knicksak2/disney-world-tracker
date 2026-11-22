/**
 * Avatar preset artwork registry.
 *
 * Each avatar in the fixed 24-preset set (see `AVATAR_PRESET_IDS` in
 * `@dwt/shared`) is an original, park- and magic-themed illustration drawn with
 * `react-native-svg`. The artwork is deliberately original — no copyrighted
 * characters or trademarked shapes — leaning on classic theme-park, fantasy,
 * adventure, wildlife, and snack motifs.
 *
 * The Profile stores only the chosen preset *id*; this module is where an id
 * becomes pixels. `AVATAR_PRESET_COMPONENTS` maps every id to a component that
 * renders a circular badge at the requested `size`. `renderAvatarPreset` is a
 * small helper for the common "render this id, or null" case.
 *
 * Notes for maintainers:
 *   - Gradient ids are prefixed per preset so two badges rendered in the same
 *     tree (e.g. the picker grid) never collide on a shared gradient id.
 *   - Blur/glow SVG filters are intentionally avoided; filter support in
 *     react-native-svg is inconsistent across iOS/Android, so the designs rely
 *     on solid gradients, stars, and sparkle marks instead.
 *   - Adding a preset is a three-step change: add the id to
 *     `AVATAR_PRESET_IDS` (shared), the DB CHECK (migration), and a component
 *     here.
 */

import React from 'react';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  Line,
  LinearGradient,
  Path,
  Polygon,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';

import type { AvatarPresetId } from '@dwt/shared';

/** Props accepted by every preset component. */
export interface AvatarPresetProps {
  /** Rendered width/height in px. Defaults to 96. */
  readonly size?: number;
}

const DEFAULT_SIZE = 96;

// ---------------------------------------------------------------------------
// Shared gradient fragments
// ---------------------------------------------------------------------------
//
// Each returns a gradient element for inclusion inside a preset's <Defs>. The
// `id` is supplied by the caller (prefixed with the preset id) so references
// stay unique across simultaneously-rendered badges.

function Twilight({ id }: { id: string }): JSX.Element {
  return (
    <RadialGradient id={id} cx="50%" cy="20%" r="90%">
      <Stop offset="0%" stopColor="#3b2f7a" />
      <Stop offset="55%" stopColor="#2a2065" />
      <Stop offset="100%" stopColor="#140f38" />
    </RadialGradient>
  );
}

function Rose({ id }: { id: string }): JSX.Element {
  return (
    <RadialGradient id={id} cx="50%" cy="25%" r="90%">
      <Stop offset="0%" stopColor="#ff8fb4" />
      <Stop offset="100%" stopColor="#d63a6b" />
    </RadialGradient>
  );
}

function Teal({ id }: { id: string }): JSX.Element {
  return (
    <RadialGradient id={id} cx="50%" cy="25%" r="90%">
      <Stop offset="0%" stopColor="#66e0d6" />
      <Stop offset="100%" stopColor="#1f8f97" />
    </RadialGradient>
  );
}

function Dusk({ id }: { id: string }): JSX.Element {
  return (
    <RadialGradient id={id} cx="50%" cy="20%" r="95%">
      <Stop offset="0%" stopColor="#ff9e6d" />
      <Stop offset="50%" stopColor="#c65b9a" />
      <Stop offset="100%" stopColor="#3d2a6b" />
    </RadialGradient>
  );
}

function Royal({ id }: { id: string }): JSX.Element {
  return (
    <RadialGradient id={id} cx="50%" cy="22%" r="92%">
      <Stop offset="0%" stopColor="#7b52c9" />
      <Stop offset="55%" stopColor="#4c2889" />
      <Stop offset="100%" stopColor="#221048" />
    </RadialGradient>
  );
}

function Emerald({ id }: { id: string }): JSX.Element {
  return (
    <RadialGradient id={id} cx="50%" cy="22%" r="92%">
      <Stop offset="0%" stopColor="#5ee3a8" />
      <Stop offset="55%" stopColor="#1e9c6e" />
      <Stop offset="100%" stopColor="#0d523a" />
    </RadialGradient>
  );
}

function Sunset({ id }: { id: string }): JSX.Element {
  return (
    <RadialGradient id={id} cx="50%" cy="20%" r="95%">
      <Stop offset="0%" stopColor="#ffc764" />
      <Stop offset="52%" stopColor="#ff7366" />
      <Stop offset="100%" stopColor="#b02e59" />
    </RadialGradient>
  );
}

function Ocean({ id }: { id: string }): JSX.Element {
  return (
    <RadialGradient id={id} cx="50%" cy="20%" r="92%">
      <Stop offset="0%" stopColor="#58d5ff" />
      <Stop offset="55%" stopColor="#1d74c9" />
      <Stop offset="100%" stopColor="#10326e" />
    </RadialGradient>
  );
}

function Cosmos({ id }: { id: string }): JSX.Element {
  return (
    <RadialGradient id={id} cx="50%" cy="22%" r="92%">
      <Stop offset="0%" stopColor="#2c5eb8" />
      <Stop offset="55%" stopColor="#1a286e" />
      <Stop offset="100%" stopColor="#0b0e30" />
    </RadialGradient>
  );
}

function Gold({ id }: { id: string }): JSX.Element {
  return (
    <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <Stop offset="0%" stopColor="#ffe89a" />
      <Stop offset="50%" stopColor="#ffd23f" />
      <Stop offset="100%" stopColor="#f2a71b" />
    </LinearGradient>
  );
}

function Pearl({ id }: { id: string }): JSX.Element {
  return (
    <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <Stop offset="0%" stopColor="#ffffff" />
      <Stop offset="100%" stopColor="#cdd6ff" />
    </LinearGradient>
  );
}

/** A four-point sparkle centered at (cx, cy) with the given radius. */
function Sparkle({
  cx,
  cy,
  r,
  fill = '#ffffff',
}: {
  cx: number;
  cy: number;
  r: number;
  fill?: string;
}): JSX.Element {
  const points = `${cx},${cy - r} ${cx + r * 0.28},${cy - r * 0.28} ${cx + r},${cy} ${cx + r * 0.28},${cy + r * 0.28} ${cx},${cy + r} ${cx - r * 0.28},${cy + r * 0.28} ${cx - r},${cy} ${cx - r * 0.28},${cy - r * 0.28}`;
  return <Polygon points={points} fill={fill} />;
}

/** Wrap a viewBox 0 0 120 120 drawing at the requested rendered size. */
function Badge({
  size,
  children,
  label,
}: {
  size: number;
  children: React.ReactNode;
  label: string;
}): JSX.Element {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      accessibilityRole="image"
      accessibilityLabel={label}
    >
      {children}
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Presets — Magic & Fantasy
// ---------------------------------------------------------------------------

function Castle({ size = DEFAULT_SIZE }: AvatarPresetProps): JSX.Element {
  return (
    <Badge size={size} label="Magic castle avatar">
      <Defs>
        <Twilight id="castle-sky" />
        <Gold id="castle-gold" />
        <Pearl id="castle-pearl" />
      </Defs>
      <Circle cx={60} cy={60} r={60} fill="url(#castle-sky)" />
      <G fill="#fff">
        <Circle cx={24} cy={26} r={1.3} />
        <Circle cx={96} cy={30} r={1.6} />
        <Circle cx={82} cy={18} r={1} />
        <Circle cx={34} cy={16} r={1} />
        <Circle cx={100} cy={58} r={1.2} />
        <Circle cx={18} cy={52} r={1.2} />
      </G>
      <G stroke="#ffd23f" strokeWidth={1.6} strokeLinecap="round" opacity={0.85}>
        <Line x1={90} y1={40} x2={90} y2={30} />
        <Line x1={90} y1={40} x2={97} y2={33} />
        <Line x1={90} y1={40} x2={99} y2={40} />
        <Line x1={90} y1={40} x2={97} y2={47} />
        <Line x1={90} y1={40} x2={83} y2={33} />
        <Line x1={90} y1={40} x2={81} y2={40} />
      </G>
      <G fill="url(#castle-pearl)">
        <Rect x={36} y={60} width={48} height={34} />
        <Rect x={30} y={50} width={9} height={44} />
        <Rect x={81} y={50} width={9} height={44} />
        <Rect x={46} y={52} width={8} height={42} />
        <Rect x={66} y={52} width={8} height={42} />
        <Rect x={55} y={40} width={10} height={54} />
      </G>
      <G fill="url(#castle-gold)">
        <Polygon points="34.5,50 30,38 39,38" />
        <Polygon points="85.5,50 81,38 90,38" />
        <Polygon points="50,52 46,42 54,42" />
        <Polygon points="70,52 66,42 74,42" />
        <Polygon points="60,40 54,24 66,24" />
      </G>
      <Rect x={59.2} y={14} width={1.6} height={12} fill="#fff" />
      <Polygon points="60.8,14 60.8,19 67,16.5" fill="#ff8fb4" />
      <G fill="#5b6ee8">
        <Rect x={43} y={68} width={6} height={9} rx={3} />
        <Rect x={71} y={68} width={6} height={9} rx={3} />
      </G>
      <Path d="M55 78 h10 v16 h-10 a5 5 0 0 1 0 -16 z" fill="url(#castle-gold)" />
      <Sparkle cx={74} cy={58} r={4} />
      <Sparkle cx={44} cy={46} r={3} />
    </Badge>
  );
}

function WishingStar({ size = DEFAULT_SIZE }: AvatarPresetProps): JSX.Element {
  return (
    <Badge size={size} label="Wishing star avatar">
      <Defs>
        <Twilight id="star-sky" />
        <Gold id="star-gold" />
        <LinearGradient id="star-tail" x1="0" y1="1" x2="1" y2="0">
          <Stop offset="0%" stopColor="#ff8fb4" stopOpacity={0.2} />
          <Stop offset="45%" stopColor="#ffc764" stopOpacity={0.75} />
          <Stop offset="100%" stopColor="#fff6d0" stopOpacity={0.95} />
        </LinearGradient>
      </Defs>
      <Circle cx={60} cy={60} r={60} fill="url(#star-sky)" />
      <G fill="#fff" opacity={0.9}>
        <Circle cx={24} cy={30} r={1.3} />
        <Circle cx={94} cy={28} r={1.4} />
        <Circle cx={22} cy={64} r={1.1} />
        <Circle cx={92} cy={82} r={1.2} />
      </G>
      {/* Sweeping tapered stardust comet tail */}
      <Path
        d="M18 92 C34 88 50 76 62 44 L75 56 C58 82 38 92 18 92 Z"
        fill="url(#star-tail)"
      />
      <Path
        d="M24 89 C38 83 53 71 65 47 L71 53 C56 76 40 86 24 89 Z"
        fill="url(#star-gold)"
        opacity={0.85}
      />
      <Path
        d="M30 85 Q48 75 64 51"
        stroke="#fff9e6"
        strokeWidth={2.4}
        fill="none"
        strokeLinecap="round"
        opacity={0.9}
      />
      {/* Trailing stardust sparkles */}
      <Sparkle cx={28} cy={75} r={3.2} fill="#ffe89a" />
      <Sparkle cx={45} cy={88} r={2.8} fill="#ff8fb4" />
      <Circle cx={37} cy={82} r={1.8} fill="#fff9e6" />
      <Circle cx={52} cy={73} r={1.6} fill="#fff9e6" />
      {/* Classic 5-point golden wishing star */}
      <G transform="rotate(12 68 46)">
        <Polygon
          points="68,20 74.8,36.7 92.7,38 78.9,49.5 83.3,67 68,57.5 52.7,67 57.1,49.5 43.3,38 61.2,36.7"
          fill="url(#star-gold)"
          stroke="#fff8db"
          strokeWidth={1.6}
          strokeLinejoin="round"
        />
        <Polygon
          points="68,28 72.2,38.8 83.6,39.7 74.9,47 77.6,58 68,52 58.4,58 61.1,47 52.4,39.7 63.8,38.8"
          fill="#fff9e6"
          opacity={0.45}
        />
      </G>
      <Sparkle cx={36} cy={38} r={3.4} fill="#ffffff" />
      <Sparkle cx={88} cy={72} r={2.8} fill="#ffe89a" />
    </Badge>
  );
}

function Fireworks({ size = DEFAULT_SIZE }: AvatarPresetProps): JSX.Element {
  return (
    <Badge size={size} label="Fireworks avatar">
      <Defs>
        <Twilight id="fw-sky" />
        <Gold id="fw-gold" />
      </Defs>
      <Circle cx={60} cy={60} r={60} fill="url(#fw-sky)" />
      <G fill="#fff" opacity={0.85}>
        <Circle cx={20} cy={24} r={1} />
        <Circle cx={102} cy={30} r={1.1} />
        <Circle cx={14} cy={58} r={1} />
        <Circle cx={108} cy={66} r={1} />
      </G>
      <G stroke="url(#fw-gold)" strokeWidth={2} strokeLinecap="round" opacity={0.95}>
        <Line x1={52} y1={40} x2={52} y2={18} />
        <Line x1={52} y1={40} x2={67} y2={25} />
        <Line x1={52} y1={40} x2={74} y2={40} />
        <Line x1={52} y1={40} x2={67} y2={55} />
        <Line x1={52} y1={40} x2={52} y2={60} />
        <Line x1={52} y1={40} x2={37} y2={55} />
        <Line x1={52} y1={40} x2={30} y2={40} />
        <Line x1={52} y1={40} x2={37} y2={25} />
      </G>
      <G fill="#ffe89a">
        <Circle cx={52} cy={17} r={2.2} />
        <Circle cx={68} cy={24} r={2.2} />
        <Circle cx={75} cy={40} r={2.2} />
        <Circle cx={68} cy={56} r={2.2} />
        <Circle cx={52} cy={62} r={2.2} />
        <Circle cx={36} cy={56} r={2.2} />
        <Circle cx={29} cy={40} r={2.2} />
        <Circle cx={36} cy={24} r={2.2} />
      </G>
      <G stroke="#ff8fb4" strokeWidth={1.6} strokeLinecap="round" opacity={0.9}>
        <Line x1={88} y1={34} x2={88} y2={20} />
        <Line x1={88} y1={34} x2={98} y2={24} />
        <Line x1={88} y1={34} x2={102} y2={34} />
        <Line x1={88} y1={34} x2={98} y2={44} />
        <Line x1={88} y1={34} x2={88} y2={48} />
        <Line x1={88} y1={34} x2={78} y2={44} />
        <Line x1={88} y1={34} x2={74} y2={34} />
        <Line x1={88} y1={34} x2={78} y2={24} />
      </G>
      <G stroke="#66e0d6" strokeWidth={1.5} strokeLinecap="round" opacity={0.85}>
        <Line x1={28} y1={50} x2={28} y2={38} />
        <Line x1={28} y1={50} x2={37} y2={41} />
        <Line x1={28} y1={50} x2={40} y2={50} />
        <Line x1={28} y1={50} x2={37} y2={59} />
        <Line x1={28} y1={50} x2={28} y2={62} />
        <Line x1={28} y1={50} x2={19} y2={59} />
        <Line x1={28} y1={50} x2={16} y2={50} />
        <Line x1={28} y1={50} x2={19} y2={41} />
      </G>
      <G fill="#0d0b1f" opacity={0.92}>
        <Rect x={40} y={86} width={40} height={24} />
        <Rect x={36} y={80} width={7} height={30} />
        <Rect x={77} y={80} width={7} height={30} />
        <Rect x={55} y={74} width={10} height={36} />
        <Polygon points="39.5,80 36,72 43,72" />
        <Polygon points="80.5,80 77,72 84,72" />
        <Polygon points="60,74 55,62 65,62" />
      </G>
      <G fill="#ffd23f" opacity={0.9}>
        <Rect x={46} y={90} width={4} height={6} rx={2} />
        <Rect x={70} y={90} width={4} height={6} rx={2} />
        <Rect x={58} y={82} width={4} height={6} rx={2} />
      </G>
    </Badge>
  );
}

function MagicWand({ size = DEFAULT_SIZE }: AvatarPresetProps): JSX.Element {
  return (
    <Badge size={size} label="Magic wand avatar">
      <Defs>
        <Dusk id="wand-bg" />
        <Gold id="wand-gold" />
      </Defs>
      <Circle cx={60} cy={60} r={60} fill="url(#wand-bg)" />
      <G fill="#fff" opacity={0.9}>
        <Circle cx={24} cy={30} r={1.3} />
        <Circle cx={94} cy={86} r={1.3} />
        <Circle cx={28} cy={84} r={1} />
      </G>
      {/* Pin-library fairyWand multi-cell motif (from gold_land_fantasyland) */}
      <G transform="translate(22, 22) scale(0.148)">
        <Path
          d="M247.7 24.4 L271.4 24.4 L345.4 91.7 L375.3 91.7 L458.8 54.1 L421.0 140.3 L421.0 166.9 L490.3 243.6 L436.8 237.4 L411.6 237.4 L410.0 264.0 L421.0 289.1 L433.6 304.7 L447.8 314.1 L468.3 320.4 L433.6 320.4 L424.2 323.5 L400.5 337.6 L378.5 356.4 L397.4 331.3 L410.0 300.0 L406.8 234.2 L375.3 234.2 L332.8 304.7 L332.8 329.8 L350.1 331.3 L350.1 386.2 L354.8 403.4 L362.7 417.5 L389.5 442.5 L369.0 436.3 L329.6 437.8 L310.7 455.1 L298.1 480.1 L298.1 434.7 L293.4 422.2 L279.2 409.7 L250.9 398.7 L298.1 400.3 L315.5 392.4 L337.5 367.4 L340.7 359.5 L340.7 332.9 L318.6 331.3 L306.0 270.3 L302.9 267.1 L277.7 267.1 L50.9 491.1 L19.4 491.1 L19.4 472.3 L257.2 237.4 L255.6 210.8 L181.6 195.1 L232.0 165.3 L265.0 150.0 L280.0 137.0 L276.0 105.0 L272.0 75.0 L268.0 52.0 L254.0 46.0 L236.0 52.0 L222.0 78.0 L218.0 105.0 L232.0 142.0 L236.0 148.0 L224.0 136.0 L211.5 121.5 L192.6 113.6 L165.8 113.6 L139.1 121.5 L107.6 137.1 L146.9 99.6 L156.4 83.9 L158.0 49.4 L151.7 25.9 L158.0 36.9 L173.7 51.0 L209.9 49.4 L246.2 25.9 Z"
          fill="#6e3b0c"
          stroke="#fff6d0"
          strokeWidth={24}
          strokeLinejoin="round"
        />
        <Path
          d="M250.53 22.03 c-57.055 45.157 -80.673 37.81 -100.31 0.22 16.598 61.517 10.408 66.415 -44.72 116.594 67.324 -35.666 96.206 -34.238 130.97 7.187 -34.906 -53.112 -30.954 -75.35 14.06 -124 z"
          fill="#d8b4fe"
        />
        <Path
          d="M268.937 22.156 L280.625 137.094 L180.75 195.188 L278.5 216.281 c-9.58 8.352 -20.214 19.028 -31.28 30.095 l-0.032 0.03 L18.563 472.438 v19.438 h32.156 L273.343 272.5 c10.26 -10.263 18.902 -19.538 25.78 -27.75 l18.938 87.75 58.094 -99.875 114.938 11.688 -77.03 -86.094 46.655 -105.69 -105.69 46.657 -86.092 -77.03 z"
          fill="url(#wand-gold)"
        />
        <Path
          d="M81.625 158.344 c24.955 27.012 26.97 43.684 24.25 72.062 14.775 -34.45 22.072 -45.66 55.625 -64.312 -34.56 11.183 -45.5 10.22 -79.875 -7.75 z"
          fill="#ffffff"
        />
        <Path
          d="M407.219 253.344 c9.27 51.694 -4.61 73.708 -32.845 106.687 43.3 -37.043 57.852 -44.284 96.844 -38.75 -38.597 -11.457 -47.426 -20.624 -64 -67.936 z"
          fill="#ff8fb4"
        />
        <Path
          d="M351.561 326.156 c-18.705 68.79 -45.304 83.944 -107.625 70.125 54.126 20.1 56.34 21.07 53.532 85.25 24.757 -55.42 46.49 -52.217 95.06 -37.217 -41.775 -31.838 -45.71 -48.97 -40.967 -118.157 z"
          fill="#ffffff"
        />
      </G>
    </Badge>
  );
}

function RoyalCrown({ size = DEFAULT_SIZE }: AvatarPresetProps): JSX.Element {
  return (
    <Badge size={size} label="Royal crown avatar">
      <Defs>
        <Royal id="crown-bg" />
        <Gold id="crown-gold" />
        <Pearl id="crown-pearl" />
      </Defs>
      <Circle cx={60} cy={60} r={60} fill="url(#crown-bg)" />
      <G fill="#fff" opacity={0.85}>
        <Circle cx={24} cy={34} r={1.2} />
        <Circle cx={96} cy={32} r={1.3} />
        <Circle cx={26} cy={78} r={1} />
        <Circle cx={94} cy={76} r={1} />
      </G>
      {/* velvet inner cushion */}
      <Path d="M34 68 C34 46 86 46 86 68 z" fill="#b8295b" />
      {/* gold crown body */}
      <Path
        d="M27 48 L33 74 L87 74 L93 48 L75 61 L60 36 L45 61 Z"
        fill="url(#crown-gold)"
        stroke="#fff4c4"
        strokeWidth={1.2}
      />
      {/* band base */}
      <Rect x={32} y={73} width={56} height={11} rx={4} fill="url(#crown-gold)" />
      <Line x1={35} y1={74} x2={85} y2={74} stroke="#d98714" strokeWidth={1.5} />
      {/* tip pearls */}
      <Circle cx={27} cy={46} r={4} fill="url(#crown-pearl)" />
      <Circle cx={60} cy={33} r={4.8} fill="url(#crown-pearl)" />
      <Circle cx={93} cy={46} r={4} fill="url(#crown-pearl)" />
      {/* band gems */}
      <Polygon points="60,74 64,78.5 60,83 56,78.5" fill="#52d69b" />
      <Circle cx={44} cy={78.5} r={3} fill="#ff5c8d" />
      <Circle cx={76} cy={78.5} r={3} fill="#ff5c8d" />
      <Sparkle cx={43} cy={40} r={3} />
      <Sparkle cx={82} cy={36} r={2.6} />
    </Badge>
  );
}

function CrystalBall({ size = DEFAULT_SIZE }: AvatarPresetProps): JSX.Element {
  return (
    <Badge size={size} label="Crystal ball avatar">
      <Defs>
        <Cosmos id="crys-bg" />
        <RadialGradient id="crys-orb" cx="42%" cy="35%" r="65%">
          <Stop offset="0%" stopColor="#e8f9ff" />
          <Stop offset="45%" stopColor="#9484ff" />
          <Stop offset="100%" stopColor="#3c2685" />
        </RadialGradient>
        <Gold id="crys-gold" />
      </Defs>
      <Circle cx={60} cy={60} r={60} fill="url(#crys-bg)" />
      <G fill="#fff" opacity={0.85}>
        <Circle cx={22} cy={34} r={1.2} />
        <Circle cx={98} cy={36} r={1.2} />
        <Circle cx={24} cy={74} r={1} />
        <Circle cx={96} cy={72} r={1.1} />
      </G>
      {/* orb */}
      <Circle cx={60} cy={52} r={28} fill="url(#crys-orb)" />
      {/* nebula swirls inside orb */}
      <Path
        d="M38 56 Q52 44 66 54 T84 48"
        stroke="#66e0d6"
        strokeWidth={3}
        fill="none"
        strokeLinecap="round"
        opacity={0.65}
      />
      <Path
        d="M42 64 Q58 58 72 64"
        stroke="#ff8fb4"
        strokeWidth={2.5}
        fill="none"
        strokeLinecap="round"
        opacity={0.6}
      />
      <Sparkle cx={56} cy={47} r={3.5} fill="#fff" />
      <Circle cx={68} cy={58} r={1.6} fill="#ffe89a" />
      {/* specular highlight */}
      <Path
        d="M41 42 A21 21 0 0 1 58 30"
        stroke="#ffffff"
        strokeWidth={3}
        fill="none"
        strokeLinecap="round"
        opacity={0.75}
      />
      {/* ornate pedestal */}
      <Path d="M44 77 h32 l-4 7 h-24 z" fill="url(#crys-gold)" />
      <Path d="M37 84 h46 l3 9 H34 z" fill="#593680" stroke="url(#crys-gold)" strokeWidth={1.6} />
      <Circle cx={60} cy={88.5} r={2.5} fill="#66e0d6" />
      <Sparkle cx={86} cy={28} r={3} fill="#ffe89a" />
    </Badge>
  );
}

function EnchantedRose({ size = DEFAULT_SIZE }: AvatarPresetProps): JSX.Element {
  return (
    <Badge size={size} label="Enchanted rose avatar">
      <Defs>
        <Twilight id="rose-bg" />
        <Gold id="rose-gold" />
        <LinearGradient id="rose-petal" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#ff7aa8" />
          <Stop offset="100%" stopColor="#c81e52" />
        </LinearGradient>
      </Defs>
      <Circle cx={60} cy={60} r={60} fill="url(#rose-bg)" />
      <G fill="#fff" opacity={0.8}>
        <Circle cx={22} cy={36} r={1.2} />
        <Circle cx={98} cy={40} r={1.2} />
      </G>
      {/* glass cloche dome behind */}
      <Path
        d="M36 86 V50 A24 24 0 0 1 84 50 V86 Z"
        fill="#cdd6ff"
        opacity={0.14}
        stroke="#e6ecff"
        strokeWidth={1.6}
      />
      <Circle cx={60} cy={23} r={3.2} fill="url(#rose-gold)" />
      {/* stem & leaves */}
      <Path d="M60 56 Q58 70 60 85" stroke="#2ebd78" strokeWidth={3} fill="none" strokeLinecap="round" />
      <Path d="M60 72 Q48 68 46 61 Q54 61 60 68 Z" fill="#3cd68c" />
      <Path d="M60 69 Q71 65 74 58 Q66 58 60 65 Z" fill="#2ebd78" />
      {/* rose blossom */}
      <Circle cx={54} cy={47} r={7.5} fill="#b81748" />
      <Circle cx={66} cy={47} r={7.5} fill="#b81748" />
      <Circle cx={60} cy={46} r={9.5} fill="url(#rose-petal)" />
      <Path
        d="M55 43 Q60 39 65 43 Q65 49 60 50 Q56 49 56 45"
        stroke="#ffd4e3"
        strokeWidth={1.5}
        fill="none"
        strokeLinecap="round"
      />
      {/* falling glowing petal & base */}
      <Ellipse cx={70} cy={80} rx={3.5} ry={2} fill="#ff618f" transform="rotate(-22 70 80)" />
      <Rect x={32} y={85} width={56} height={9} rx={4.5} fill="url(#rose-gold)" />
      {/* dome glass highlight */}
      <Path
        d="M41 74 V50 A19 19 0 0 1 54 32"
        stroke="#ffffff"
        strokeWidth={2}
        fill="none"
        strokeLinecap="round"
        opacity={0.55}
      />
      <Sparkle cx={48} cy={40} r={2.8} fill="#ffe89a" />
      <Sparkle cx={72} cy={55} r={2.6} fill="#ffe89a" />
    </Badge>
  );
}

function SkyLantern({ size = DEFAULT_SIZE }: AvatarPresetProps): JSX.Element {
  return (
    <Badge size={size} label="Sky lantern avatar">
      <Defs>
        <Dusk id="lantern-bg" />
        <LinearGradient id="lantern-glow" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#ff944d" />
          <Stop offset="55%" stopColor="#ffd159" />
          <Stop offset="100%" stopColor="#fff7c2" />
        </LinearGradient>
        <Gold id="lantern-gold" />
      </Defs>
      <Circle cx={60} cy={60} r={60} fill="url(#lantern-bg)" />
      {/* distant small lanterns */}
      <G opacity={0.7}>
        <Rect x={24} y={44} width={8} height={11} rx={3} fill="#ffd873" />
        <Rect x={89} y={36} width={7} height={10} rx={3} fill="#ffd873" />
        <Rect x={82} y={66} width={6} height={8} rx={2.5} fill="#ffe89a" />
      </G>
      {/* hero paper lantern */}
      <Path
        d="M44 30 Q60 22 76 30 L80 56 Q78 73 71 78 H49 Q42 73 40 56 Z"
        fill="url(#lantern-glow)"
        stroke="#ff7a45"
        strokeWidth={1.2}
      />
      {/* lantern ribs */}
      <Path d="M41 44 Q60 40 79 44" stroke="#f2912b" strokeWidth={1.3} fill="none" opacity={0.7} />
      <Path d="M41 59 Q60 55 79 59" stroke="#f2912b" strokeWidth={1.3} fill="none" opacity={0.7} />
      <Path d="M53 26 Q50 52 52 78" stroke="#f2912b" strokeWidth={1.2} fill="none" opacity={0.5} />
      <Path d="M67 26 Q70 52 68 78" stroke="#f2912b" strokeWidth={1.2} fill="none" opacity={0.5} />
      {/* glowing base rim & flame */}
      <Ellipse cx={60} cy={78} rx={11} ry={3} fill="#c44528" />
      <Circle cx={60} cy={76} r={3.5} fill="#ffffff" />
      {/* embers & sparkles */}
      <Circle cx={55} cy={87} r={1.6} fill="#ffe89a" />
      <Circle cx={64} cy={91} r={1.4} fill="#ffe89a" />
      <Sparkle cx={33} cy={28} r={3} />
      <Sparkle cx={86} cy={24} r={2.5} />
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Presets — Rides, Voyages & Transit
// ---------------------------------------------------------------------------

function RollerCoaster({ size = DEFAULT_SIZE }: AvatarPresetProps): JSX.Element {
  return (
    <Badge size={size} label="Roller coaster avatar">
      <Defs>
        <Sunset id="coaster-bg" />
        <Gold id="coaster-gold" />
        <Pearl id="coaster-pearl" />
      </Defs>
      <Circle cx={60} cy={60} r={60} fill="url(#coaster-bg)" />
      <G fill="#fff" opacity={0.85}>
        <Circle cx={22} cy={34} r={1.2} />
        <Circle cx={94} cy={28} r={1.3} />
      </G>
      {/* Pin-library coasterLoop multi-cell motif (from gold_coaster_royalty) */}
      <G transform="translate(24, 24) scale(0.14)">
        <Path
          d="M187.7 170.7 L512 512 H460.8 L409.6 460.8 V512 H375.5 V426.7 L307.2 350 V512 H273.1 V324.3 L204.8 247.5 V512 H170.7 V213.3 S128 162.1 102.4 162.1 V512 H68.3 V162.1 C34.1 162.1 0 196.3 0 196.3 V145.1 S34.1 119.5 85.3 119.5 C153.6 119.5 187.7 170.7 187.7 170.7"
          fill="#2d1b4e"
          stroke="#fff4c4"
          strokeWidth={22}
          strokeLinejoin="round"
        />
        <Path
          d="M170.7 85.3 L204.8 119.5 S238.9 85.3 273.1 119.5 S273.1 187.7 273.1 187.7 L358.4 273.1 S392.5 238.9 426.7 273.1 S426.7 341.3 426.7 341.3 L477.9 392.5 S529.1 273.1 443.7 187.7 C375.5 238.9 307.2 153.6 358.4 102.4 C392.5 68.3 238.9 0 238.9 0 S171.3 85.3 170.7 85.3"
          fill="url(#coaster-gold)"
          stroke="#2d1b4e"
          strokeWidth={12}
          strokeLinejoin="round"
        />
        <Path
          d="M187.7 170.7 L512 512 H460.8 L409.6 460.8 V512 H375.5 V426.7 L307.2 350 V512 H273.1 V324.3 L204.8 247.5 V512 H170.7 V213.3 S128 162.1 102.4 162.1 V512 H68.3 V162.1 C34.1 162.1 0 196.3 0 196.3 V145.1 S34.1 119.5 85.3 119.5 C153.6 119.5 187.7 170.7 187.7 170.7"
          fill="url(#coaster-pearl)"
        />
        <Path
          d="M238.9 187.7 C256 187.7 273.1 170.7 273.1 153.6 S256 119.5 238.9 119.5 S204.8 136.5 204.8 153.6 S221.9 187.7 238.9 187.7"
          fill="#ff3b6b"
        />
        <Path
          d="M392.5 341.3 C409.6 341.3 426.7 324.3 426.7 307.2 S409.6 273.1 392.5 273.1 S358.4 290.1 358.4 307.2 S375.5 341.3 392.5 341.3"
          fill="#27b5b0"
        />
      </G>
      <Sparkle cx={88} cy={38} r={3.2} />
      <Sparkle cx={26} cy={56} r={2.6} />
    </Badge>
  );
}

function FerrisWheel({ size = DEFAULT_SIZE }: AvatarPresetProps): JSX.Element {
  return (
    <Badge size={size} label="Ferris wheel avatar">
      <Defs>
        <Twilight id="ferris-bg" />
        <Gold id="ferris-gold" />
        <Pearl id="ferris-pearl" />
      </Defs>
      <Circle cx={60} cy={60} r={60} fill="url(#ferris-bg)" />
      <G fill="#fff" opacity={0.85}>
        <Circle cx={22} cy={30} r={1.2} />
        <Circle cx={96} cy={32} r={1.3} />
        <Circle cx={20} cy={72} r={1} />
      </G>
      {/* A-frame stand */}
      <G stroke="url(#ferris-pearl)" strokeWidth={3.2} strokeLinecap="round">
        <Line x1={60} y1={54} x2={42} y2={94} />
        <Line x1={60} y1={54} x2={78} y2={94} />
        <Line x1={38} y1={94} x2={82} y2={94} />
      </G>
      {/* wheel spokes */}
      <G stroke="#a8b6ff" strokeWidth={1.6}>
        <Line x1={60} y1={24} x2={60} y2={84} />
        <Line x1={30} y1={54} x2={90} y2={54} />
        <Line x1={39} y1={33} x2={81} y2={75} />
        <Line x1={81} y1={33} x2={39} y2={75} />
      </G>
      {/* concentric wheel rims */}
      <Circle cx={60} cy={54} r={30} fill="none" stroke="url(#ferris-gold)" strokeWidth={3} />
      <Circle cx={60} cy={54} r={19} fill="none" stroke="#ff8fb4" strokeWidth={1.8} />
      {/* 8 colorful gondolas */}
      <Circle cx={60} cy={24} r={4.5} fill="#ff8fb4" stroke="#fff" strokeWidth={1} />
      <Circle cx={81} cy={33} r={4.5} fill="#66e0d6" stroke="#fff" strokeWidth={1} />
      <Circle cx={90} cy={54} r={4.5} fill="#ffd23f" stroke="#fff" strokeWidth={1} />
      <Circle cx={81} cy={75} r={4.5} fill="#ff8fb4" stroke="#fff" strokeWidth={1} />
      <Circle cx={60} cy={84} r={4.5} fill="#66e0d6" stroke="#fff" strokeWidth={1} />
      <Circle cx={39} cy={75} r={4.5} fill="#ffd23f" stroke="#fff" strokeWidth={1} />
      <Circle cx={30} cy={54} r={4.5} fill="#66e0d6" stroke="#fff" strokeWidth={1} />
      <Circle cx={39} cy={33} r={4.5} fill="#ffd23f" stroke="#fff" strokeWidth={1} />
      {/* central hub */}
      <Circle cx={60} cy={54} r={5.5} fill="url(#ferris-gold)" stroke="#fff" strokeWidth={1.2} />
      <Sparkle cx={86} cy={22} r={3} />
    </Badge>
  );
}

function Teacup({ size = DEFAULT_SIZE }: AvatarPresetProps): JSX.Element {
  return (
    <Badge size={size} label="Teacup ride avatar">
      <Defs>
        <Teal id="cup-bg" />
        <Gold id="cup-gold" />
        <Pearl id="cup-pearl" />
      </Defs>
      <Circle cx={60} cy={60} r={60} fill="url(#cup-bg)" />
      <G fill="#fff" opacity={0.85}>
        <Circle cx={24} cy={30} r={1.2} />
        <Circle cx={94} cy={32} r={1.2} />
        <Circle cx={26} cy={76} r={1} />
      </G>
      {/* Clean MingCute teacup-fill handle */}
      <Path
        d="M79 47 H85.5 A8.5 8.5 0 0 1 85.5 64 H77.5"
        stroke="url(#cup-gold)"
        strokeWidth={6}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Clean MingCute teacup-fill cup bowl silhouette */}
      <Path
        d="M30 42 A5 5 0 0 1 35 37 H77 A5 5 0 0 1 82 42 V53 C82 68 70.5 78 56 78 C41.5 78 30 68 30 53 Z"
        fill="url(#cup-pearl)"
      />
      {/* Subtle golden rim band at top of cup */}
      <Path
        d="M30 42 A5 5 0 0 1 35 37 H77 A5 5 0 0 1 82 42 V44 H30 Z"
        fill="url(#cup-gold)"
      />
      {/* Simple, clean pastel accent on the cup body */}
      <Polygon points="56,51 60.5,56.5 56,62 51.5,56.5" fill="#ff6b9d" />
      <Circle cx={43} cy={56.5} r={2.8} fill="url(#cup-gold)" />
      <Circle cx={69} cy={56.5} r={2.8} fill="url(#cup-gold)" />
      {/* Connected pill saucer base (MingCute teacup-fill proportion) */}
      <Rect x={34} y={77} width={44} height={6.5} rx={3.25} fill="url(#cup-gold)" />
      <Rect x={36} y={77} width={40} height={2.5} rx={1.25} fill="#fff8db" opacity={0.65} />
      <Sparkle cx={56} cy={26} r={3} />
    </Badge>
  );
}

function Carousel({ size = DEFAULT_SIZE }: AvatarPresetProps): JSX.Element {
  return (
    <Badge size={size} label="Carousel avatar">
      <Defs>
        <Rose id="car-bg" />
        <Gold id="car-gold" />
        <Pearl id="car-pearl" />
      </Defs>
      <Circle cx={60} cy={60} r={60} fill="url(#car-bg)" />
      <G fill="#fff" opacity={0.85}>
        <Circle cx={22} cy={34} r={1.2} />
        <Circle cx={96} cy={36} r={1.2} />
      </G>
      {/* Pin-library leaping carouselHorse multi-cell motif (from gold_gentle_rides_all) */}
      <G transform="translate(21, 20) scale(1.22)">
        <Path
          d="M60.352 51.271 c-0.243 -0.232 -1.311 -1.457 -1.476 -5.144 -0.246 -5.458 -2.141 -6.42 -4.592 -7.111 -0.406 -0.115 -0.792 -0.225 -1.176 -0.386 -1.139 -0.477 -2.395 -2.309 -3.086 -3.556 0.395 -1.518 0.941 -4.704 -0.334 -7.642 1.706 -0.049 3.842 -0.301 6.481 -2.419 6.822 -5.471 0.867 -12.89 0.867 -12.89 -0.386 4.101 -4.71 3.773 -9.02 7.229 -1.331 1.067 -2.276 2.315 -2.97 3.578 -0.969 -0.422 -2.049 -0.742 -3.26 -0.94 -0.938 -0.154 -1.865 -0.233 -2.752 -0.233 -3.044 -0.001 -5.27 0.91 -7.058 1.641 -0.728 0.298 -1.367 0.548 -1.979 0.721 v-22.119 h-4 v19.868 c-1.052 -2.404 -4.033 -2.508 -4.033 -2.508 0.023 -1.513 4.028 -1.218 1.737 -2.646 -3.815 -2.379 -7.631 -1.585 -7.631 -1.585 0.563 -1.077 6.098 -3.246 0.264 -3.005 -3.804 0.158 -5.74 1.124 -6.666 2.228 -2.728 0.049 -4.285 1.208 -4.456 1.343 l-1.982 1.576 2.019 1.528 0.55 0.417 c-0.064 0.265 -0.075 0.541 -0.022 0.806 -0.675 3.158 -1.597 6.003 -2.171 6.557 -1.348 1.056 -1.899 2.585 -1.454 4.074 0.583 1.95 2.695 3.19 4.4 3.263 l0.038 0.002 h0.037 c0.385 0 0.688 -0.1 0.957 -0.272 0.138 0.113 0.273 0.194 0.383 0.25 0.345 0.171 0.704 0.258 1.072 0.258 1.568 0 2.613 -1.461 2.928 -3.132 0.066 -0.054 0.136 -0.113 0.208 -0.176 0.389 2.073 1.188 4.347 2.767 6.213 -0.118 0.226 -0.234 0.405 -0.323 0.491 -6.806 3.41 -7.671 4.196 -7.622 9.941 0.002 0.367 0.006 0.763 0.006 1.19 0 4.87 -1.122 6.791 -1.133 6.81 l-0.915 1.364 1.183 1.107 c0.491 0.485 1.8 1.301 5.05 1.301 h1.368 l0.402 -1.364 c0.019 -0.061 0.169 -0.585 0.351 -1.436 0.602 0.397 1.753 0.848 3.919 0.848 h1.369 l0.403 -1.365 c0.044 -0.148 1.068 -3.679 0.802 -7.828 -0.037 -0.573 0.05 -0.981 0.259 -1.215 0.577 -0.643 2.277 -0.643 2.917 -0.643 1.007 0 1.871 -0.282 2.613 -0.699 0 0 0.178 -0.073 0.409 -0.148 v16.587 h4 v-12.437 c0.282 0.024 0.572 0.039 0.868 0.039 1.928 0 4.186 -0.492 4.758 -1.866 0.236 -0.584 0.072 -1.238 -0.504 -1.95 -0.336 -0.421 -0.834 -0.894 -1.483 -1.403 -0.3 -0.235 -0.601 -0.453 -0.884 -0.648 0.816 -0.192 1.653 -0.442 2.511 -0.747 1.552 2.047 3.946 4.308 6.964 4.308 0.719 0 2.012 0 2.455 0.118 0.133 0.325 0.299 1.171 0.447 1.925 l0.031 0.165 c0.779 3.982 2.904 6.909 2.994 7.031 l1.848 2.515 1.299 -2.863 1.574 -3.471 0.134 -0.295 c1.159 3.533 2.907 5.937 2.997 6.059 l1.846 2.51 1.299 -2.859 1.967 -4.331 0.879 -1.94 -1.648 -0.589"
          fill="url(#car-gold)"
          stroke="url(#car-gold)"
          strokeWidth={1.15}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <Path
          d="M60.352 51.271 c-0.243 -0.232 -1.311 -1.457 -1.476 -5.144 -0.246 -5.458 -2.141 -6.42 -4.592 -7.111 -0.406 -0.115 -0.792 -0.225 -1.176 -0.386 -1.139 -0.477 -2.395 -2.309 -3.086 -3.556 0.395 -1.518 0.941 -4.704 -0.334 -7.642 1.706 -0.049 3.842 -0.301 6.481 -2.419 6.822 -5.471 0.867 -12.89 0.867 -12.89 -0.386 4.101 -4.71 3.773 -9.02 7.229 -1.331 1.067 -2.276 2.315 -2.97 3.578 -0.969 -0.422 -2.049 -0.742 -3.26 -0.94 -0.938 -0.154 -1.865 -0.233 -2.752 -0.233 -3.044 -0.001 -5.27 0.91 -7.058 1.641 -0.728 0.298 -1.367 0.548 -1.979 0.721 v-22.119 h-4 v19.868 c-1.052 -2.404 -4.033 -2.508 -4.033 -2.508 0.023 -1.513 4.028 -1.218 1.737 -2.646 -3.815 -2.379 -7.631 -1.585 -7.631 -1.585 0.563 -1.077 6.098 -3.246 0.264 -3.005 -3.804 0.158 -5.74 1.124 -6.666 2.228 -2.728 0.049 -4.285 1.208 -4.456 1.343 l-1.982 1.576 2.019 1.528 0.55 0.417 c-0.064 0.265 -0.075 0.541 -0.022 0.806 -0.675 3.158 -1.597 6.003 -2.171 6.557 -1.348 1.056 -1.899 2.585 -1.454 4.074 0.583 1.95 2.695 3.19 4.4 3.263 l0.038 0.002 h0.037 c0.385 0 0.688 -0.1 0.957 -0.272 0.138 0.113 0.273 0.194 0.383 0.25 0.345 0.171 0.704 0.258 1.072 0.258 1.568 0 2.613 -1.461 2.928 -3.132 0.066 -0.054 0.136 -0.113 0.208 -0.176 0.389 2.073 1.188 4.347 2.767 6.213 -0.118 0.226 -0.234 0.405 -0.323 0.491 -6.806 3.41 -7.671 4.196 -7.622 9.941 0.002 0.367 0.006 0.763 0.006 1.19 0 4.87 -1.122 6.791 -1.133 6.81 l-0.915 1.364 1.183 1.107 c0.491 0.485 1.8 1.301 5.05 1.301 h1.368 l0.402 -1.364 c0.019 -0.061 0.169 -0.585 0.351 -1.436 0.602 0.397 1.753 0.848 3.919 0.848 h1.369 l0.403 -1.365 c0.044 -0.148 1.068 -3.679 0.802 -7.828 -0.037 -0.573 0.05 -0.981 0.259 -1.215 0.577 -0.643 2.277 -0.643 2.917 -0.643 1.007 0 1.871 -0.282 2.613 -0.699 0 0 0.178 -0.073 0.409 -0.148 v16.587 h4 v-12.437 c0.282 0.024 0.572 0.039 0.868 0.039 1.928 0 4.186 -0.492 4.758 -1.866 0.236 -0.584 0.072 -1.238 -0.504 -1.95 -0.336 -0.421 -0.834 -0.894 -1.483 -1.403 -0.3 -0.235 -0.601 -0.453 -0.884 -0.648 0.816 -0.192 1.653 -0.442 2.511 -0.747 1.552 2.047 3.946 4.308 6.964 4.308 0.719 0 2.012 0 2.455 0.118 0.133 0.325 0.299 1.171 0.447 1.925 l0.031 0.165 c0.779 3.982 2.904 6.909 2.994 7.031 l1.848 2.515 1.299 -2.863 1.574 -3.471 0.134 -0.295 c1.159 3.533 2.907 5.937 2.997 6.059 l1.846 2.51 1.299 -2.859 1.967 -4.331 0.879 -1.94 -1.648 -0.589"
          fill="#fbf7ee"
        />
        <Path
          d="M36.499 23.938 c0.773 -0.152 1.61 -0.246 2.537 -0.246 0.758 0 1.576 0.063 2.465 0.208 7.075 1.158 7.438 6.271 7.021 9.232 h-12.023 v-9.194"
          fill="#4a2a7a"
        />
        <Path
          d="M25.09 29.95 l0.431 -0.161 v3.344 h-8.949 l6.323 -2.361 c0.62 -0.014 1.379 -0.212 2.195 -0.822"
          fill="#4a2a7a"
        />
        <Path
          d="M14.12 31.066 c-0.434 -1.906 -0.458 -3.7 -0.412 -4.793 l0.409 -0.141 -1.18 -3.404 c0.342 -0.229 0.566 -0.619 0.566 -1.062 0 -0.468 -0.254 -0.874 -0.63 -1.095 l0.26 -3.317 c1.8 7.756 7.059 4.975 7.059 4.975 -2.103 3.719 0.336 5.45 0.548 5.03 0.716 -1.426 1.095 -1.155 1.247 -0.351 0.053 0.283 -0.063 0.772 -0.208 1.296 l-7.659 2.862"
          fill="#4a2a7a"
        />
        <Path
          d="M23.671 40.745 c0 0 -1.82 2.769 -5.296 2.769 -2.17 0 -6.589 0.104 -6.281 4.904 0.166 2.567 -0.105 4.932 -0.393 6.582 -0.798 0.047 -1.991 -0.024 -3.495 -0.5 0.335 -1.26 0.65 -3.146 0.65 -5.819 0 -5.729 -0.594 -5.805 6.618 -9.417 1.021 -0.51 1.665 -2.653 1.665 -2.653 -0.242 -0.216 -0.461 -0.447 -0.67 -0.684 h9.066 c0.134 2.623 2.108 4.759 4.665 5.137 v1.153 c-0.489 0.049 -0.961 0.082 -1.391 0.082 -3.583 0 -5.138 -1.554 -5.138 -1.554"
          fill="#4a2a7a"
        />
        <Path
          d="M55.753 54.275 c-0.607 -1.298 -1.23 -2.935 -1.592 -4.775 -0.877 -4.493 -0.836 -4.692 -5.934 -4.692 -5.096 0 -8.867 -5.791 -8.867 -5.791 -2.978 1.641 -5.472 2.525 -7.541 2.95 v-0.903 c2.556 -0.376 4.531 -2.513 4.666 -5.137 h11.875 c0.656 1.205 2.208 3.725 4.057 4.497 2.452 1.029 4.355 0.204 4.607 5.795 0.113 2.529 0.621 4.146 1.142 5.164 -0.471 0.908 -1.252 2.088 -2.413 2.892"
          fill="#4a2a7a"
        />
      </G>
      <Sparkle cx={84} cy={26} r={3} />
    </Badge>
  );
}

function PirateShip({ size = DEFAULT_SIZE }: AvatarPresetProps): JSX.Element {
  return (
    <Badge size={size} label="Pirate galleon avatar">
      <Defs>
        <Ocean id="pirate-bg" />
        <Gold id="pirate-gold" />
        <Pearl id="pirate-pearl" />
      </Defs>
      <Circle cx={60} cy={60} r={60} fill="url(#pirate-bg)" />
      {/* crescent moon */}
      <Path d="M88 26 A8 8 0 1 0 96 36 A6.5 6.5 0 1 1 88 26 Z" fill="#ffe89a" />
      <G fill="#fff" opacity={0.8}>
        <Circle cx={26} cy={32} r={1.2} />
        <Circle cx={38} cy={22} r={1} />
      </G>
      {/* masts & yards */}
      <Rect x={62.5} y={22} width={3} height={47} fill="#5c3317" />
      <Rect x={41} y={33} width={2.5} height={36} fill="#5c3317" />
      <Line x1={48} y1={34} x2={80} y2={34} stroke="#5c3317" strokeWidth={2} strokeLinecap="round" />
      <Line x1={45} y1={49} x2={83} y2={49} stroke="#5c3317" strokeWidth={2} strokeLinecap="round" />
      <Line x1={30} y1={41} x2={54} y2={41} stroke="#5c3317" strokeWidth={1.8} strokeLinecap="round" />
      {/* full square-rigged billowing sails centered across masts */}
      <Path d="M49 34 Q64 31 79 34 Q82 41 78 47 Q64 44 50 47 Q46 41 49 34 Z" fill="url(#pirate-pearl)" />
      <Path d="M46 49 Q64 46 82 49 Q85 57 81 64 Q64 61 47 64 Q43 57 46 49 Z" fill="#f7f0de" />
      <Path d="M31 41 Q42 39 53 41 Q55 50 52 58 Q42 56 32 58 Q29 50 31 41 Z" fill="#fff8e8" />
      {/* jib sail at bow */}
      <Polygon points="23,66 41,45 41,65" fill="#fff4d9" opacity={0.95} />
      {/* pennant flag */}
      <Polygon points="64,22 77,25.5 64,29" fill="#ff5277" />
      {/* wooden hull & raised stern */}
      <Path
        d="M25 67 L75 67 L79 62 L93 62 L84 84 L36 84 Z"
        fill="#8c4a26"
        stroke="#592c12"
        strokeWidth={1.4}
      />
      <Path d="M29 72 H89" stroke="url(#pirate-gold)" strokeWidth={2.4} />
      <G fill="#ffe89a">
        <Circle cx={48} cy={77} r={1.8} />
        <Circle cx={60} cy={77} r={1.8} />
        <Circle cx={72} cy={77} r={1.8} />
      </G>
      {/* stylized waves */}
      <Path
        d="M20 84 Q30 79 40 84 T60 84 T80 84 T100 84"
        stroke="#92f2ff"
        strokeWidth={3.5}
        fill="none"
        strokeLinecap="round"
      />
      <Path
        d="M26 91 Q37 87 48 91 T70 91 T94 91"
        stroke="#ffffff"
        strokeWidth={2.2}
        fill="none"
        strokeLinecap="round"
        opacity={0.7}
      />
    </Badge>
  );
}

function SteamTrain({ size = DEFAULT_SIZE }: AvatarPresetProps): JSX.Element {
  return (
    <Badge size={size} label="Steam train avatar">
      <Defs>
        <Emerald id="train-bg" />
        <Gold id="train-gold" />
        <Pearl id="train-pearl" />
      </Defs>
      <Circle cx={60} cy={60} r={60} fill="url(#train-bg)" />
      {/* steam clouds */}
      <G fill="#ffffff" opacity={0.9}>
        <Circle cx={39} cy={38} r={5.5} />
        <Circle cx={47} cy={31} r={7} />
        <Circle cx={58} cy={27} r={8.5} />
        <Circle cx={69} cy={28} r={6} />
      </G>
      {/* rail track */}
      <Line x1={22} y1={88} x2={98} y2={88} stroke="#d4e6ff" strokeWidth={3} strokeLinecap="round" />
      {/* cab */}
      <Rect x={66} y={44} width={22} height={34} rx={3} fill="#d63a5b" />
      <Rect x={63} y={41} width={28} height={5} rx={2.5} fill="url(#train-gold)" />
      <Rect x={71} y={50} width={12} height={11} rx={2.5} fill="#ffe89a" />
      {/* boiler & funnel */}
      <Rect x={34} y={54} width={34} height={24} rx={4} fill="#28355c" />
      <Rect x={36} y={62} width={30} height={4} fill="url(#train-gold)" />
      <Polygon points="36,54 34,43 44,43 42,54" fill="url(#train-gold)" />
      <Path d="M52 54 A4.5 4.5 0 0 1 61 54 Z" fill="url(#train-gold)" />
      {/* cowcatcher */}
      <Polygon points="34,70 23,82 34,82" fill="#d63a5b" />
      {/* wheels */}
      <Circle cx={42} cy={80} r={6.5} fill="url(#train-pearl)" stroke="#28355c" strokeWidth={2} />
      <Circle cx={57} cy={80} r={6.5} fill="url(#train-pearl)" stroke="#28355c" strokeWidth={2} />
      <Circle cx={77} cy={79} r={8} fill="url(#train-pearl)" stroke="url(#train-gold)" strokeWidth={2.5} />
      <Circle cx={77} cy={79} r={2.5} fill="#28355c" />
      <Sparkle cx={88} cy={32} r={2.8} />
    </Badge>
  );
}

function Monorail({ size = DEFAULT_SIZE }: AvatarPresetProps): JSX.Element {
  return (
    <Badge size={size} label="Park monorail avatar">
      <Defs>
        <Dusk id="mono-bg" />
        <Gold id="mono-gold" />
        <Pearl id="mono-pearl" />
      </Defs>
      <Circle cx={60} cy={60} r={60} fill="url(#mono-bg)" />
      <G fill="#fff" opacity={0.85}>
        <Circle cx={26} cy={28} r={1.2} />
        <Circle cx={94} cy={30} r={1.2} />
      </G>
      {/* elevated beam & pylon */}
      <Line x1={16} y1={84} x2={104} y2={60} stroke="#443470" strokeWidth={8.5} strokeLinecap="round" />
      <Line x1={16} y1={84} x2={104} y2={60} stroke="#6d59a8" strokeWidth={3.5} strokeLinecap="round" />
      <Rect x={32} y={81} width={8} height={24} rx={3} fill="#443470" />
      {/* streamlined nose & fuselage */}
      <Path
        d="M28 66 Q24 59 33 56 L88 45 Q104 42 106 51 Q107 58 98 60 L37 72 Q29 73 28 66 z"
        fill="url(#mono-pearl)"
      />
      {/* teal & gold sleek stripe */}
      <Path
        d="M29 63 L103 49 Q105 52 104 54 L31 68 Q28 66 29 63 z"
        fill="#27b5b0"
      />
      <Path
        d="M31 66 L104 52 L103 54.5 L32 68.5 z"
        fill="url(#mono-gold)"
      />
      {/* panoramic cockpit windshield */}
      <Path d="M88 45 Q103 42 105 49 L93 52 Z" fill="#2c245c" />
      <G fill="#3a4db8">
        <Rect x={42} y={56} width={9} height={5.5} rx={2} transform="rotate(-11 46 59)" />
        <Rect x={56} y={53} width={9} height={5.5} rx={2} transform="rotate(-11 60 56)" />
        <Rect x={70} y={50} width={9} height={5.5} rx={2} transform="rotate(-11 74 53)" />
      </G>
      <Sparkle cx={40} cy={40} r={3} />
    </Badge>
  );
}

function HotAirBalloon({ size = DEFAULT_SIZE }: AvatarPresetProps): JSX.Element {
  return (
    <Badge size={size} label="Hot-air balloon avatar">
      <Defs>
        <Dusk id="hab-bg" />
        <Gold id="hab-gold" />
        <Pearl id="hab-pearl" />
      </Defs>
      <Circle cx={60} cy={60} r={60} fill="url(#hab-bg)" />
      <G fill="#fff" opacity={0.85}>
        <Circle cx={26} cy={34} r={1.2} />
        <Circle cx={94} cy={44} r={1.2} />
        <Circle cx={30} cy={82} r={1} />
      </G>
      <Path
        d="M60 26 C40 26 32 44 32 54 C32 66 44 76 60 80 C76 76 88 66 88 54 C88 44 80 26 60 26 z"
        fill="url(#hab-pearl)"
      />
      <Path
        d="M60 26 C54 40 54 66 60 80 C66 66 66 40 60 26 z"
        fill="#ff8fb4"
        opacity={0.9}
      />
      <Path d="M44 30 C40 46 42 68 52 78 L52 30 z" fill="#5b6ee8" opacity={0.55} />
      <Path d="M76 30 C80 46 78 68 68 78 L68 30 z" fill="#26a69a" opacity={0.55} />
      <G stroke="#fff" strokeWidth={1.2}>
        <Line x1={52} y1={79} x2={55} y2={88} />
        <Line x1={68} y1={79} x2={65} y2={88} />
      </G>
      <Path d="M54 88 h12 l-2 8 h-8 z" fill="url(#hab-gold)" />
      <Sparkle cx={40} cy={30} r={3} />
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Presets — Space, Adventure & Wildlife
// ---------------------------------------------------------------------------

function RocketShip({ size = DEFAULT_SIZE }: AvatarPresetProps): JSX.Element {
  return (
    <Badge size={size} label="Space rocket avatar">
      <Defs>
        <Cosmos id="rocket-bg" />
        <Gold id="rocket-gold" />
        <Pearl id="rocket-pearl" />
      </Defs>
      <Circle cx={60} cy={60} r={60} fill="url(#rocket-bg)" />
      <G fill="#fff" opacity={0.9}>
        <Circle cx={24} cy={68} r={1.2} />
        <Circle cx={94} cy={40} r={1.3} />
        <Circle cx={88} cy={82} r={1.1} />
        <Circle cx={38} cy={22} r={1} />
      </G>
      {/* tiny ringed planet */}
      <Circle cx={27} cy={36} r={5.5} fill="#ff8fb4" />
      <Ellipse
        cx={27}
        cy={36}
        rx={10}
        ry={2.8}
        fill="none"
        stroke="#ffe89a"
        strokeWidth={1.5}
        transform="rotate(-18 27 36)"
      />
      {/* angled rocket */}
      <G transform="rotate(35 60 60)">
        {/* flame */}
        <Polygon points="54,82 66,82 60,101" fill="#ff6b4a" />
        <Polygon points="56.5,82 63.5,82 60,94" fill="url(#rocket-gold)" />
        {/* side fins */}
        <Polygon points="49,64 39,80 51,78" fill="#ff5478" />
        <Polygon points="71,64 81,80 69,78" fill="#ff5478" />
        {/* fuselage */}
        <Path
          d="M60 22 C48 36 48 64 52 80 H68 C72 64 72 36 60 22 Z"
          fill="url(#rocket-pearl)"
        />
        {/* nosecone tip */}
        <Path d="M60 22 C54 29 52 35 51.5 38 H68.5 C68 35 66 29 60 22 Z" fill="#ff5478" />
        {/* porthole */}
        <Circle cx={60} cy={52} r={7.5} fill="#28355c" stroke="#ffd23f" strokeWidth={2} />
        <Circle cx={60} cy={52} r={4.5} fill="#5ce1e6" />
        <Circle cx={58.5} cy={50.5} r={1.5} fill="#ffffff" />
      </G>
      <Sparkle cx={86} cy={24} r={3} />
    </Badge>
  );
}

function SafariLion({ size = DEFAULT_SIZE }: AvatarPresetProps): JSX.Element {
  return (
    <Badge size={size} label="Safari lion avatar">
      <Defs>
        <Sunset id="lion-bg" />
        <Gold id="lion-gold" />
      </Defs>
      <Circle cx={60} cy={60} r={60} fill="url(#lion-bg)" />
      <G fill="#fff" opacity={0.85}>
        <Circle cx={24} cy={34} r={1.2} />
        <Circle cx={96} cy={32} r={1.2} />
      </G>
      {/* Pin-library lion multi-cell motif (from silver_wildlife_spotter) */}
      <G transform="translate(22, 22) scale(0.148)">
        <Path
          d="M123.885 20.447 c-10.348 0.467 -21.337 3.146 -32.194 5.366 l62.492 65.628 -21.645 0.188 c-29.376 0.187 -75.695 6.154 -103.555 22.303 l31.756 51.576 -40.625 21.098 v56.577 l46.54 26.32 -46.54 40.076 v32.268 c28.217 -1.233 60.63 0.636 89.135 -8.907 l31.902 -10.658 -21.828 25.586 c-18.76 22 -29.782 55.133 -50.736 87.713 31.91 -2.394 63.352 -7.65 96.8 -25.81 l16.026 -8.683 -9.746 77.124 c26.333 -12.19 52.103 -28.923 71.178 -49.055 22.683 -23.94 35.713 -50.49 33.36 -72.71 l-0.074 -0.75 c-18.488 -12.687 -32.26 -31.173 -39.236 -54.18 -8.414 -27.753 -5.867 -62.33 6.643 -101.145 -26.406 -4.04 -46.536 -14.637 -57.307 -30.11 -12.33 -17.716 -14.222 -39.26 -7.738 -57.018 6.483 -17.758 22.29 -32.165 43.437 -33.4 20.558 -1.195 44.48 10.033 69.972 36.102 11.368 4.11 21.73 8.034 31.14 11.94 2.434 -21.395 -1.46 -38.033 -10.408 -52.9 -8.41 -13.975 -23.217 -26.43 -41.1 -38.582 l4.27 42.888 -16.425 -10.985 C222.37 43.57 168.973 18.49 123.885 20.597 l0.002 -0.225 z"
          fill="url(#lion-gold)"
          stroke="#7a320a"
          strokeWidth={8}
          strokeLinejoin="round"
        />
        <Path
          d="M224.272 98.444 c-0.436 0.008 -0.866 0 -1.29 0 h-0.002 c-13.54 0.785 -22.545 9.105 -26.937 21.135 -4.393 12.03 -3.243 27.353 5.51 39.93 8.755 12.576 25.128 23.158 53.548 24.784 l12.595 0.69 -4.344 11.827 c-14.837 40.46 -16.242 73.928 -8.577 99.212 7.66 25.267 24.04 42.795 47.305 52.56 h0.037 l108.59 38.474 c5.65 -11.9 11.672 -23.813 17.988 -35.71 a40.58 40.58 0 0 1 -16.32 3.41 c-22.52 0 -40.78 -18.262 -40.78 -40.782 0 -22.518 18.26 -40.78 40.78 -40.78 20.66 0 37.697 15.373 40.373 35.3 10.666 -18.062 21.885 -36 33.48 -53.683 l-103.224 -52.377 -4.746 -5.732 c-3.93 -13.556 -11.515 -23.32 -26.39 -33.324 -14.876 -10.002 -37.034 -19.57 -67.784 -30.623 l-2.08 -0.767 -1.53 -1.607 c-23.283 -24.532 -42.7 -32.278 -56.202 -32.024 z"
          fill="#8c3d0f"
          stroke="#ffe89a"
          strokeWidth={5.5}
          strokeLinejoin="round"
        />
        <Path
          d="M343.312 188.374 c8.272 0 14.657 6.387 14.657 14.657 0 8.274 -6.387 14.688 -14.658 14.688 -8.27 0 -14.687 -6.414 -14.687 -14.687 0 -8.27 6.416 -14.655 14.687 -14.655 z"
          fill="#fff8db"
        />
      </G>
      <Sparkle cx={88} cy={40} r={2.8} />
    </Badge>
  );
}

function SeaTurtle({ size = DEFAULT_SIZE }: AvatarPresetProps): JSX.Element {
  return (
    <Badge size={size} label="Sea turtle avatar">
      <Defs>
        <Ocean id="turtle-bg" />
        <LinearGradient id="turtle-shell" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor="#4de3a4" />
          <Stop offset="100%" stopColor="#1c8264" />
        </LinearGradient>
      </Defs>
      <Circle cx={60} cy={60} r={60} fill="url(#turtle-bg)" />
      {/* ocean bubbles */}
      <G fill="#bdf5ff" opacity={0.7}>
        <Circle cx={28} cy={30} r={3} />
        <Circle cx={34} cy={22} r={2} />
        <Circle cx={94} cy={74} r={2.5} />
        <Circle cx={26} cy={82} r={2} />
      </G>
      {/* symmetric sea turtle rotated diagonally up-right */}
      <G transform="rotate(36 60 62)">
        {/* four distinct flippers */}
        <Ellipse cx={39} cy={50} rx={12} ry={5.5} fill="#3cd69e" transform="rotate(-24 39 50)" />
        <Ellipse cx={81} cy={50} rx={12} ry={5.5} fill="#3cd69e" transform="rotate(24 81 50)" />
        <Ellipse cx={46} cy={83} rx={9} ry={4.8} fill="#2cb384" transform="rotate(32 46 83)" />
        <Ellipse cx={74} cy={83} rx={9} ry={4.8} fill="#2cb384" transform="rotate(-32 74 83)" />
        {/* cute head & tail */}
        <Polygon points="57,84 63,84 60,92" fill="#2cb384" />
        <Circle cx={60} cy={33} r={9.5} fill="#46e0a8" />
        <Circle cx={56.5} cy={29.5} r={1.8} fill="#14332a" />
        <Circle cx={63.5} cy={29.5} r={1.8} fill="#14332a" />
        <Circle cx={56} cy={29} r={0.7} fill="#fff" />
        <Circle cx={63} cy={29} r={0.7} fill="#fff" />
        {/* oval shell & scutes */}
        <Ellipse
          cx={60}
          cy={62}
          rx={18}
          ry={21}
          fill="url(#turtle-shell)"
          stroke="#ffe082"
          strokeWidth={2}
        />
        <Polygon points="60,51 67,56 67,67 60,72 53,67 53,56" fill="#ffe082" opacity={0.85} />
        <G stroke="#ffe082" strokeWidth={1.4} opacity={0.7}>
          <Line x1={60} y1={51} x2={60} y2={41} />
          <Line x1={67} y1={56} x2={76} y2={52} />
          <Line x1={67} y1={67} x2={76} y2={71} />
          <Line x1={53} y1={56} x2={44} y2={52} />
          <Line x1={53} y1={67} x2={44} y2={71} />
        </G>
      </G>
      <Sparkle cx={86} cy={26} r={3} />
    </Badge>
  );
}

function TropicalHibiscus({ size = DEFAULT_SIZE }: AvatarPresetProps): JSX.Element {
  return (
    <Badge size={size} label="Tropical hibiscus avatar">
      <Defs>
        <Teal id="hib-bg" />
        <LinearGradient id="hib-petal" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor="#ff94b8" />
          <Stop offset="100%" stopColor="#e8306a" />
        </LinearGradient>
        <Gold id="hib-gold" />
      </Defs>
      <Circle cx={60} cy={60} r={60} fill="url(#hib-bg)" />
      {/* tropical leaves behind */}
      <Path d="M36 62 Q18 42 26 24 Q44 30 46 54 Z" fill="#18875e" />
      <Path d="M74 68 Q98 62 96 86 Q78 88 68 74 Z" fill="#25ad7a" />
      {/* 5 overlapping petals */}
      <Circle cx={60} cy={41} r={16} fill="url(#hib-petal)" />
      <Circle cx={78} cy={54} r={16} fill="url(#hib-petal)" />
      <Circle cx={71} cy={75} r={16} fill="url(#hib-petal)" />
      <Circle cx={49} cy={75} r={16} fill="url(#hib-petal)" />
      <Circle cx={42} cy={54} r={16} fill="url(#hib-petal)" />
      {/* center glow */}
      <Circle cx={60} cy={60} r={10} fill="#b5174b" />
      {/* petal vein highlights */}
      <G stroke="#ffd4e3" strokeWidth={1.4} strokeLinecap="round" opacity={0.55}>
        <Line x1={60} y1={52} x2={60} y2={35} />
        <Line x1={67} y1={58} x2={83} y2={52} />
        <Line x1={64} y1={67} x2={75} y2={80} />
        <Line x1={55} y1={67} x2={44} y2={80} />
        <Line x1={52} y1={58} x2={37} y2={52} />
      </G>
      {/* golden stamen */}
      <Line x1={60} y1={60} x2={75} y2={39} stroke="url(#hib-gold)" strokeWidth={3} strokeLinecap="round" />
      <Circle cx={76} cy={37} r={2.8} fill="#ffe89a" />
      <Circle cx={71} cy={40} r={2.2} fill="#ffe89a" />
      <Circle cx={78} cy={43} r={2.2} fill="#ffe89a" />
      <Sparkle cx={32} cy={86} r={3} />
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Presets — Park Snacks & Treats
// ---------------------------------------------------------------------------

function PineappleWhip({ size = DEFAULT_SIZE }: AvatarPresetProps): JSX.Element {
  return (
    <Badge size={size} label="Pineapple whip avatar">
      <Defs>
        <Teal id="whip-bg" />
        <Gold id="whip-gold" />
        <Pearl id="whip-pearl" />
      </Defs>
      <Circle cx={60} cy={60} r={60} fill="url(#whip-bg)" />
      <G fill="#fff" opacity={0.85}>
        <Circle cx={24} cy={32} r={1.2} />
        <Circle cx={96} cy={36} r={1.2} />
      </G>
      {/* cup */}
      <Path d="M40 65 H80 L73 95 H47 Z" fill="url(#whip-pearl)" />
      <Path d="M43 74 H77 L75 83 H45 Z" fill="#ff6e54" />
      <Rect x={38} y={62} width={44} height={5.5} rx={2.8} fill="#ffffff" />
      {/* swirled soft-serve peak */}
      <Ellipse cx={60} cy={57} rx={18} ry={8} fill="url(#whip-gold)" />
      <Ellipse cx={60} cy={47} rx={14.5} ry={7} fill="#ffe066" />
      <Ellipse cx={60} cy={38} rx={10.5} ry={6} fill="url(#whip-gold)" />
      <Path d="M53 34 Q58 23 65 25 Q61 29 65 34 Z" fill="#ffeb85" />
      {/* maraschino cherry topper & stem */}
      <Path d="M62 21 Q67 14 73 16" stroke="#c81e52" strokeWidth={1.8} fill="none" strokeLinecap="round" />
      <Circle cx={60} cy={23} r={4.5} fill="#ef3b5d" />
      <Circle cx={58.6} cy={21.6} r={1.2} fill="#ffffff" opacity={0.85} />
      {/* swirl highlights */}
      <Path d="M47 56 Q60 60 72 56" stroke="#fff8cc" strokeWidth={1.6} fill="none" strokeLinecap="round" />
      <Path d="M50 47 Q60 50 70 47" stroke="#fff8cc" strokeWidth={1.5} fill="none" strokeLinecap="round" />
      <Sparkle cx={35} cy={38} r={3} />
    </Badge>
  );
}

function Pretzel({ size = DEFAULT_SIZE }: AvatarPresetProps): JSX.Element {
  return (
    <Badge size={size} label="Park pretzel avatar">
      <Defs>
        <Rose id="pretzel-bg" />
        <LinearGradient id="pretzel-crust" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor="#f5b858" />
          <Stop offset="55%" stopColor="#d47d24" />
          <Stop offset="100%" stopColor="#8f4910" />
        </LinearGradient>
      </Defs>
      <Circle cx={60} cy={60} r={60} fill="url(#pretzel-bg)" />
      <G fill="#fff" opacity={0.85}>
        <Circle cx={24} cy={32} r={1.2} />
        <Circle cx={96} cy={34} r={1.2} />
      </G>
      {/* Pin-library pretzel motif */}
      <G transform="translate(22, 23) scale(0.148)">
        <Path
          d="M182.28 90.005c16.1 2.682 25.418 4.934 45.862 11.656 18.57-14.474 47.956-26.908 75.748-26.14 47.97 1.604 91.01 34.895 103.698 72.094 10.918 32.01 4.29 72.454-14.532 110.358-16.682 34.096-52.988 76.062-87.875 95.46-18.8 10.23-36.618 17.343-61.39 20.86-7.537 15.89-13.888 32.806-19.816 43.902 36.3-2.454 71.64-11.743 101.282-27.87 35.382-19.252 66.99-50.606 90.443-87.303.14.016.264.027.405.042 12.194-19.643 12.988-23.107 22.043-42.573 17.01-40.85 23.166-85.462 9.192-126.434-19.178-56.227-77.212-99.728-142.825-100.862-54.15-.677-95.57 27.644-122.236 56.81zm-24.74 16.682c-35.74 2.213-70.47 15.18-92.31 38.583-24.54 26.3-40.146 63.025-45.328 100.794-5.182 37.768.08 77.63 23.783 107.632 23.524 29.778 57.79 48.086 95.225 57.47 12.147-20.055 13.965-24.698 20.045-38.67-34.498-6.97-64.44-22.213-82.313-44.835-13.958-17.667-19.21-46.14-15.13-75.887 4.083-29.75 17.517-59.727 34.425-77.848 8.587-9.204 29.154-19.31 50.7-23.445 15.104-2.44 43.587-.884 55.766 6.466 11.815 7.865 17.974 21.69 19.38 24.932 14.802 10.438 32.785 21.642 44.82 26.406-.413-20.385-4.292-39.918-13.815-57.406-8.91-16.364-22.303-27.454-37.628-34.494l.002-.002c-14.2-7.48-36.045-11.835-57.625-9.695zm-3.39 60.957c.743 10.735 3.627 21.485 9.283 31.87 12.423 22.812 32.96 39.463 56.815 52.54l-.002.006c20.21 10.896 23.6 11.366 44.373 19.584l.01.004c29.57 9.695 57.504 16.927 84.567 21.885 14.18-19.153 15.862-23.037 24.42-38.434-34.93-5.817-72.66-14.643-103.123-26.27-24.107-9.222-33.5-15.21-46.285-24.225-10.895-9.673-22.79-18.91-26.78-32.147-13.554-2.775-29.795-5.5-43.28-4.814zm302.078 96.67c-9.334 19.797-11.152 25.408-20.2 40.623 21.918 1.843 35.99 2.283 35.99 2.283 11.698.5 21.547-8.664 21.89-20.37.342-11.704-8.954-21.428-20.662-21.613 0 0-6.613-.25-17.018-.923zm-240.033 5.99c-5.348 21.46-12.844 43.655-21.297 64.732-5.088 12.688-10.427 24.798-15.71 36.2-8.94 20.01-10.283 24.81-22.512 45.296-9.815 18.414-16.83 30.11-16.83 30.11-6.24 9.934-3.132 23.053 6.902 29.132 10.033 6.08 23.1 2.76 29.017-7.37 19.563-33.868 34.868-62.688 50.352-99.25a670.254 670.254 0 0 0 7.764-18.485c8.118-20.244 15.652-41.69 21.464-63.343-17.052-6.69-22.696-8.36-39.15-17.023z"
          fill="#54270a"
          stroke="#fff0c4"
          strokeWidth={22}
          strokeLinejoin="round"
        />
        <Path
          d="M182.28 90.005c16.1 2.682 25.418 4.934 45.862 11.656 18.57-14.474 47.956-26.908 75.748-26.14 47.97 1.604 91.01 34.895 103.698 72.094 10.918 32.01 4.29 72.454-14.532 110.358-16.682 34.096-52.988 76.062-87.875 95.46-18.8 10.23-36.618 17.343-61.39 20.86-7.537 15.89-13.888 32.806-19.816 43.902 36.3-2.454 71.64-11.743 101.282-27.87 35.382-19.252 66.99-50.606 90.443-87.303.14.016.264.027.405.042 12.194-19.643 12.988-23.107 22.043-42.573 17.01-40.85 23.166-85.462 9.192-126.434-19.178-56.227-77.212-99.728-142.825-100.862-54.15-.677-95.57 27.644-122.236 56.81zm-24.74 16.682c-35.74 2.213-70.47 15.18-92.31 38.583-24.54 26.3-40.146 63.025-45.328 100.794-5.182 37.768.08 77.63 23.783 107.632 23.524 29.778 57.79 48.086 95.225 57.47 12.147-20.055 13.965-24.698 20.045-38.67-34.498-6.97-64.44-22.213-82.313-44.835-13.958-17.667-19.21-46.14-15.13-75.887 4.083-29.75 17.517-59.727 34.425-77.848 8.587-9.204 29.154-19.31 50.7-23.445 15.104-2.44 43.587-.884 55.766 6.466 11.815 7.865 17.974 21.69 19.38 24.932 14.802 10.438 32.785 21.642 44.82 26.406-.413-20.385-4.292-39.918-13.815-57.406-8.91-16.364-22.303-27.454-37.628-34.494l.002-.002c-14.2-7.48-36.045-11.835-57.625-9.695zm-3.39 60.957c.743 10.735 3.627 21.485 9.283 31.87 12.423 22.812 32.96 39.463 56.815 52.54l-.002.006c20.21 10.896 23.6 11.366 44.373 19.584l.01.004c29.57 9.695 57.504 16.927 84.567 21.885 14.18-19.153 15.862-23.037 24.42-38.434-34.93-5.817-72.66-14.643-103.123-26.27-24.107-9.222-33.5-15.21-46.285-24.225-10.895-9.673-22.79-18.91-26.78-32.147-13.554-2.775-29.795-5.5-43.28-4.814zm302.078 96.67c-9.334 19.797-11.152 25.408-20.2 40.623 21.918 1.843 35.99 2.283 35.99 2.283 11.698.5 21.547-8.664 21.89-20.37.342-11.704-8.954-21.428-20.662-21.613 0 0-6.613-.25-17.018-.923zm-240.033 5.99c-5.348 21.46-12.844 43.655-21.297 64.732-5.088 12.688-10.427 24.798-15.71 36.2-8.94 20.01-10.283 24.81-22.512 45.296-9.815 18.414-16.83 30.11-16.83 30.11-6.24 9.934-3.132 23.053 6.902 29.132 10.033 6.08 23.1 2.76 29.017-7.37 19.563-33.868 34.868-62.688 50.352-99.25a670.254 670.254 0 0 0 7.764-18.485c8.118-20.244 15.652-41.69 21.464-63.343-17.052-6.69-22.696-8.36-39.15-17.023z"
          fill="url(#pretzel-crust)"
        />
      </G>
      {/* coarse white salt crystals on the pretzel loops */}
      <G fill="#ffffff">
        <Circle cx={42} cy={43} r={1.5} />
        <Circle cx={75} cy={35} r={1.5} />
        <Circle cx={86} cy={52} r={1.5} />
        <Circle cx={33} cy={62} r={1.5} />
        <Circle cx={58} cy={62} r={1.5} />
        <Circle cx={73} cy={78} r={1.5} />
      </G>
      <Sparkle cx={86} cy={26} r={2.8} />
    </Badge>
  );
}

function Popcorn({ size = DEFAULT_SIZE }: AvatarPresetProps): JSX.Element {
  return (
    <Badge size={size} label="Popcorn avatar">
      <Defs>
        <Teal id="pop-bg" />
        <Pearl id="pop-pearl" />
      </Defs>
      <Circle cx={60} cy={60} r={60} fill="url(#pop-bg)" />
      <G fill="#fff8e1">
        <Circle cx={48} cy={40} r={9} />
        <Circle cx={60} cy={34} r={9} />
        <Circle cx={72} cy={40} r={9} />
        <Circle cx={54} cy={44} r={8} />
        <Circle cx={66} cy={44} r={8} />
      </G>
      <Path d="M44 48 h32 l-5 42 h-22 z" fill="url(#pop-pearl)" />
      <G fill="#ef5350">
        <Rect x={48} y={48} width={5} height={42} />
        <Rect x={58} y={48} width={5} height={42} />
        <Rect x={68} y={48} width={5} height={42} />
      </G>
      <Sparkle cx={52} cy={40} r={3} fill="#ffd23f" />
    </Badge>
  );
}

function TurkeyLeg({ size = DEFAULT_SIZE }: AvatarPresetProps): JSX.Element {
  return (
    <Badge size={size} label="Turkey leg avatar">
      <Defs>
        <Royal id="turkey-bg" />
      </Defs>
      <Circle cx={60} cy={60} r={60} fill="url(#turkey-bg)" />
      <G fill="#fff" opacity={0.8}>
        <Circle cx={28} cy={30} r={1.2} />
        <Circle cx={92} cy={34} r={1.2} />
      </G>
      <Line x1={44} y1={86} x2={66} y2={52} stroke="#f4e6c8" strokeWidth={8} strokeLinecap="round" />
      <G fill="#fff8e6">
        <Circle cx={42} cy={88} r={6} />
        <Circle cx={48} cy={90} r={6} />
      </G>
      <Path
        d="M60 34 C78 30 92 44 88 62 C85 76 70 82 58 76 C48 71 46 60 50 50 C53 42 56 37 60 34 z"
        fill="#a5642e"
      />
      <Path
        d="M64 40 C76 38 84 48 82 58"
        stroke="#c9843f"
        strokeWidth={4}
        fill="none"
        strokeLinecap="round"
      />
      <Ellipse
        cx={72}
        cy={50}
        rx={6}
        ry={9}
        fill="#c98a4a"
        opacity={0.6}
        transform="rotate(20 72 50)"
      />
      <Sparkle cx={78} cy={36} r={3} fill="#ffffff" />
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** Map of every preset id to its badge component. */
export const AVATAR_PRESET_COMPONENTS: Record<
  AvatarPresetId,
  (props: AvatarPresetProps) => JSX.Element
> = {
  castle: Castle,
  'wishing-star': WishingStar,
  fireworks: Fireworks,
  'magic-wand': MagicWand,
  'royal-crown': RoyalCrown,
  'crystal-ball': CrystalBall,
  'enchanted-rose': EnchantedRose,
  'sky-lantern': SkyLantern,
  'roller-coaster': RollerCoaster,
  'ferris-wheel': FerrisWheel,
  teacup: Teacup,
  carousel: Carousel,
  'pirate-ship': PirateShip,
  'steam-train': SteamTrain,
  monorail: Monorail,
  'hot-air-balloon': HotAirBalloon,
  'rocket-ship': RocketShip,
  'safari-lion': SafariLion,
  'sea-turtle': SeaTurtle,
  'tropical-hibiscus': TropicalHibiscus,
  'pineapple-whip': PineappleWhip,
  pretzel: Pretzel,
  popcorn: Popcorn,
  'turkey-leg': TurkeyLeg,
};

/** Human-readable label per preset, for accessibility and the picker. */
export const AVATAR_PRESET_LABELS: Record<AvatarPresetId, string> = {
  castle: 'Magic castle',
  'wishing-star': 'Wishing star',
  fireworks: 'Fireworks',
  'magic-wand': 'Magic wand',
  'royal-crown': 'Royal crown',
  'crystal-ball': 'Crystal ball',
  'enchanted-rose': 'Enchanted rose',
  'sky-lantern': 'Sky lantern',
  'roller-coaster': 'Roller coaster',
  'ferris-wheel': 'Ferris wheel',
  teacup: 'Teacup ride',
  carousel: 'Carousel',
  'pirate-ship': 'Pirate galleon',
  'steam-train': 'Steam train',
  monorail: 'Park monorail',
  'hot-air-balloon': 'Hot-air balloon',
  'rocket-ship': 'Space rocket',
  'safari-lion': 'Safari lion',
  'sea-turtle': 'Sea turtle',
  'tropical-hibiscus': 'Tropical hibiscus',
  'pineapple-whip': 'Pineapple whip',
  pretzel: 'Park pretzel',
  popcorn: 'Popcorn',
  'turkey-leg': 'Turkey leg',
};

/**
 * Render the badge for `preset` at `size`, or `null` when no preset is set.
 * Safe against unknown ids (returns `null`) so a stale id read from the API
 * degrades to the placeholder rather than crashing.
 */
export function renderAvatarPreset(
  preset: AvatarPresetId | null,
  size = DEFAULT_SIZE,
): JSX.Element | null {
  if (preset === null) return null;
  const Component = AVATAR_PRESET_COMPONENTS[preset];
  if (!Component) return null;
  return <Component size={size} />;
}

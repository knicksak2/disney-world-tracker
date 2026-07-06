/**
 * Avatar preset artwork registry.
 *
 * Each avatar in the fixed preset set (see `AVATAR_PRESET_IDS` in
 * `@dwt/shared`) is an original, Disney-*themed* illustration drawn with
 * `react-native-svg`. The artwork is deliberately original — no copyrighted
 * characters or trademarked shapes — leaning on the "magical" aesthetic
 * (twilight skies, gold accents, sparkle, fireworks) rather than any specific
 * property.
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
// Presets
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
      </Defs>
      <Circle cx={60} cy={60} r={60} fill="url(#star-sky)" />
      <G fill="#fff" opacity={0.9}>
        <Circle cx={30} cy={34} r={1.3} />
        <Circle cx={90} cy={80} r={1.3} />
        <Circle cx={26} cy={72} r={1} />
        <Circle cx={94} cy={40} r={1} />
      </G>
      <Path
        d="M28 92 Q50 78 62 56"
        stroke="url(#star-gold)"
        strokeWidth={3}
        fill="none"
        strokeLinecap="round"
        opacity={0.8}
      />
      <G fill="#ffe89a">
        <Circle cx={30} cy={90} r={1.6} />
        <Circle cx={40} cy={84} r={1.3} />
        <Circle cx={50} cy={74} r={1.1} />
      </G>
      <Polygon
        points="66,30 73,52 96,52 77,66 84,88 66,74 48,88 55,66 36,52 59,52"
        fill="url(#star-gold)"
        stroke="#fff6d0"
        strokeWidth={1}
      />
      <Circle cx={66} cy={58} r={4} fill="#fff" opacity={0.8} />
    </Badge>
  );
}

function EarBalloon({ size = DEFAULT_SIZE }: AvatarPresetProps): JSX.Element {
  return (
    <Badge size={size} label="Ear balloon avatar">
      <Defs>
        <Rose id="balloon-bg" />
        <Gold id="balloon-gold" />
        <Pearl id="balloon-pearl" />
      </Defs>
      <Circle cx={60} cy={60} r={60} fill="url(#balloon-bg)" />
      <G fill="#fff" opacity={0.85}>
        <Circle cx={24} cy={30} r={1.3} />
        <Circle cx={96} cy={34} r={1.3} />
        <Circle cx={100} cy={70} r={1} />
        <Circle cx={20} cy={66} r={1} />
      </G>
      <G fill="url(#balloon-pearl)">
        <Circle cx={60} cy={58} r={23} />
        <Circle cx={43} cy={39} r={12.5} />
        <Circle cx={77} cy={39} r={12.5} />
      </G>
      <Polygon points="57,80 63,80 60,86" fill="url(#balloon-pearl)" />
      <Path
        d="M60 86 q7 11 -2 22"
        stroke="url(#balloon-gold)"
        strokeWidth={2.5}
        fill="none"
        strokeLinecap="round"
      />
      <Ellipse cx={51} cy={51} rx={5} ry={8} fill="#fff" opacity={0.7} />
      <Sparkle cx={74} cy={34} r={3} />
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
      {/* main gold burst */}
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
      {/* pink burst */}
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
      {/* teal burst */}
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
      {/* castle silhouette */}
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
        <Circle cx={28} cy={30} r={1.3} />
        <Circle cx={92} cy={86} r={1.3} />
        <Circle cx={30} cy={88} r={1} />
      </G>
      <Rect
        x={60}
        y={52}
        width={6}
        height={42}
        rx={3}
        fill="url(#wand-gold)"
        transform="rotate(32 63 73)"
      />
      <Polygon
        points="46,30 51,44 65,44 54,52 58,66 46,58 34,66 38,52 27,44 41,44"
        fill="url(#wand-gold)"
        stroke="#fff6d0"
        strokeWidth={1}
      />
      <Sparkle cx={74} cy={40} r={4} />
      <Sparkle cx={82} cy={62} r={3} />
      <Circle cx={70} cy={72} r={1.6} fill="#fff" />
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
        <Circle cx={26} cy={30} r={1.2} />
        <Circle cx={94} cy={36} r={1.2} />
      </G>
      <Path d="M34 56 h52 v6 a26 20 0 0 1 -52 0 z" fill="url(#cup-pearl)" />
      <Path
        d="M86 60 a10 10 0 0 1 0 18"
        stroke="#fff"
        strokeWidth={5}
        fill="none"
      />
      <Ellipse cx={60} cy={56} rx={26} ry={8} fill="url(#cup-gold)" />
      <Ellipse cx={60} cy={55} rx={18} ry={5} fill="#fff" />
      <Rect x={40} y={86} width={40} height={6} rx={3} fill="url(#cup-pearl)" />
      <G fill="#ff8fb4">
        <Circle cx={52} cy={70} r={2.5} />
        <Circle cx={68} cy={72} r={2.5} />
        <Circle cx={60} cy={66} r={2.5} />
      </G>
      <Sparkle cx={60} cy={40} r={3} />
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
        <Circle cx={24} cy={34} r={1.2} />
        <Circle cx={96} cy={38} r={1.2} />
      </G>
      <Path d="M30 52 Q60 22 90 52 z" fill="url(#car-gold)" />
      <Path d="M30 52 Q60 22 90 52" fill="none" stroke="#fff" strokeWidth={2} />
      <G fill="#ff8fb4">
        <Path d="M30 52 q7.5 -12 15 0 z" />
        <Path d="M45 52 q7.5 -14 15 0 z" />
        <Path d="M60 52 q7.5 -14 15 0 z" />
        <Path d="M75 52 q7.5 -12 15 0 z" />
      </G>
      <Circle cx={60} cy={24} r={3} fill="#fff" />
      <Rect x={59} y={20} width={2} height={8} fill="url(#car-gold)" />
      <Rect x={34} y={86} width={52} height={6} rx={3} fill="url(#car-pearl)" />
      <G stroke="url(#car-gold)" strokeWidth={3}>
        <Line x1={42} y1={54} x2={42} y2={86} />
        <Line x1={60} y1={54} x2={60} y2={86} />
        <Line x1={78} y1={54} x2={78} y2={86} />
      </G>
      <G fill="#fff">
        <Circle cx={42} cy={70} r={4} />
        <Circle cx={78} cy={70} r={4} />
      </G>
      <Circle cx={60} cy={70} r={5} fill="#fff" />
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

function Monorail({ size = DEFAULT_SIZE }: AvatarPresetProps): JSX.Element {
  return (
    <Badge size={size} label="Monorail avatar">
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
      <Line x1={14} y1={84} x2={106} y2={60} stroke="#4a3a7a" strokeWidth={9} strokeLinecap="round" />
      <Line x1={14} y1={84} x2={106} y2={60} stroke="#6b57a8" strokeWidth={4} strokeLinecap="round" />
      <Rect x={30} y={82} width={8} height={26} rx={3} fill="#4a3a7a" />
      <Path
        d="M30 66 Q26 60 34 57 L92 45 Q104 43 106 52 Q107 58 99 60 L38 72 Q31 73 30 66 z"
        fill="url(#mono-pearl)"
      />
      <Path
        d="M31 63 L104 49 Q106 52 105 55 L33 69 Q30 66 31 63 z"
        fill="url(#mono-gold)"
      />
      <Path d="M92 45 Q104 43 106 52 Q107 55 103 57 L96 52 z" fill="#ff8fb4" />
      <G fill="#5b6ee8">
        <Rect x={44} y={58} width={9} height={6} rx={2} transform="rotate(-8 48 61)" />
        <Rect x={58} y={55} width={9} height={6} rx={2} transform="rotate(-8 62 58)" />
        <Rect x={72} y={52} width={9} height={6} rx={2} transform="rotate(-8 76 55)" />
      </G>
      <Sparkle cx={40} cy={42} r={3} />
    </Badge>
  );
}

function TurkeyLeg({ size = DEFAULT_SIZE }: AvatarPresetProps): JSX.Element {
  return (
    <Badge size={size} label="Turkey leg avatar">
      <Defs>
        <Teal id="turkey-bg" />
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

function IceCreamBar({ size = DEFAULT_SIZE }: AvatarPresetProps): JSX.Element {
  return (
    <Badge size={size} label="Ice cream bar avatar">
      <Defs>
        <Rose id="icb-bg" />
      </Defs>
      <Circle cx={60} cy={60} r={60} fill="url(#icb-bg)" />
      <G fill="#fff" opacity={0.85}>
        <Circle cx={26} cy={30} r={1.2} />
        <Circle cx={94} cy={36} r={1.2} />
      </G>
      <Rect x={57} y={78} width={6} height={26} rx={3} fill="#e8c990" />
      <G fill="#4a2c1a">
        <Circle cx={60} cy={58} r={22} />
        <Circle cx={42} cy={40} r={12} />
        <Circle cx={78} cy={40} r={12} />
      </G>
      <G fill="#6b4326" opacity={0.9}>
        <Circle cx={60} cy={58} r={17} />
        <Circle cx={43} cy={41} r={8.5} />
        <Circle cx={77} cy={41} r={8.5} />
      </G>
      <Ellipse cx={52} cy={50} rx={6} ry={9} fill="#fff" opacity={0.22} />
      <Sparkle cx={74} cy={36} r={3} />
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
  'ear-balloon': EarBalloon,
  fireworks: Fireworks,
  'magic-wand': MagicWand,
  teacup: Teacup,
  carousel: Carousel,
  'hot-air-balloon': HotAirBalloon,
  popcorn: Popcorn,
  monorail: Monorail,
  'turkey-leg': TurkeyLeg,
  'ice-cream-bar': IceCreamBar,
};

/** Human-readable label per preset, for accessibility and the picker. */
export const AVATAR_PRESET_LABELS: Record<AvatarPresetId, string> = {
  castle: 'Magic castle',
  'wishing-star': 'Wishing star',
  'ear-balloon': 'Ear balloon',
  fireworks: 'Fireworks',
  'magic-wand': 'Magic wand',
  teacup: 'Teacup ride',
  carousel: 'Carousel',
  'hot-air-balloon': 'Hot-air balloon',
  popcorn: 'Popcorn',
  monorail: 'Monorail',
  'turkey-leg': 'Turkey leg',
  'ice-cream-bar': 'Ice cream bar',
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

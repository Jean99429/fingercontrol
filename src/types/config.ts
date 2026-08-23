export type Finger = 'index' | 'middle' | 'ring' | 'pinky';

export type HandType = 'Left' | 'Right';

export type GestureState = 'IDLE' | 'APPROACHING' | 'ARMING' | 'ACTIVE' | 'RELEASING';

export type AudioMode = 'off' | 'tts' | 'file';

export type EffectId =
  | 'particle-disassembly'
  | 'ascii-dither'
  | 'rgb-time-echo'
  | 'glyph-dissolve'
  | 'dither'
  | 'data-slice'
  | 'pixel-sort'
  | 'dot-matrix'
  | 'negative-threshold'
  | 'optical-distortion';

export interface EffectMeta {
  id: EffectId;
  name: string;
  shortLabel: string;
  description: string;
  isMvp: boolean;
}

export interface LeftSlot {
  id: string;
  enabled: boolean;
  finger: Finger;
  text: string;
  audioMode: AudioMode;
  ttsVoice?: string;
  ttsRate: number;
  ttsVolume: number;
  ttsPitch?: number;
  audioFileName?: string;
  audioDataUrl?: string;
}

export interface RightSlot {
  id: string;
  enabled: boolean;
  finger: Finger;
  effectId: EffectId;
}

export interface FingercontrolConfig {
  version: 1;
  leftSlots: LeftSlot[];
  rightSlots: RightSlot[];
  soundEnabled: boolean;
  trackingVisible: boolean;
  preferredDeviceId?: string;
}

export interface FingertipPoint {
  x: number; // 0..1 normalized
  y: number; // 0..1 normalized
  z?: number;
}

export interface HandGestureData {
  hand: HandType;
  detected: boolean;
  fingertips: {
    thumb: FingertipPoint;
    index: FingertipPoint;
    middle: FingertipPoint;
    ring: FingertipPoint;
    pinky: FingertipPoint;
  };
  state: GestureState;
  activeFinger: Finger | null;
  proximityDistance: number; // normalized
  pinchCenter: FingertipPoint | null;
  dragOffset: { dx: number; dy: number }; // delta from pinch start
  holdDurationMs: number;
  effectConfirmedTimestamp: number;
  rawLandmarks?: FingertipPoint[];
}

export const EFFECT_LIBRARY: EffectMeta[] = [
  {
    id: 'particle-disassembly',
    name: 'PARTICLE DISASSEMBLY',
    shortLabel: 'PARTICLE',
    description: 'Deconstructs person into monochrome particles dispersing from pinch origin; re-converges on release.',
    isMvp: true,
  },
  {
    id: 'ascii-dither',
    name: 'ASCII / DITHER',
    shortLabel: 'ASCII',
    description: 'Renders person as dense ASCII matrix + ordered halftone dots driven by camera luminance and hand height.',
    isMvp: true,
  },
  {
    id: 'rgb-time-echo',
    name: 'RGB TIME ECHO',
    shortLabel: 'RGB ECHO',
    description: 'Chromatic aberration splitting (R/G/B) with temporal ghosting trails following hand motion vector.',
    isMvp: true,
  },
  {
    id: 'glyph-dissolve',
    name: 'GLYPH DISSOLVE',
    shortLabel: 'GLYPH',
    description: 'Converts silhouette into dot matrix glyphs that disintegrate and scatter into typographic fragments.',
    isMvp: true,
  },
  {
    id: 'dither',
    name: 'DITHER (BAYER 8X8)',
    shortLabel: 'DITHER',
    description: 'High-contrast 1-bit ordered Bayer matrix retro digital rasterization.',
    isMvp: false,
  },
  {
    id: 'data-slice',
    name: 'DATA SLICE',
    shortLabel: 'DATA SLICE',
    description: 'Horizontal scanline slicing, displacement jitter, and glitch phase offsets driven by hand coords.',
    isMvp: false,
  },
  {
    id: 'pixel-sort',
    name: 'PIXEL SORT',
    shortLabel: 'PIXEL SORT',
    description: 'Real-time directional luminance sorting streaks stretching across performer contours.',
    isMvp: false,
  },
  {
    id: 'dot-matrix',
    name: 'DOT MATRIX',
    shortLabel: 'DOT MATRIX',
    description: 'Precision LED monochrome halftone dot grid with dot radius modulated by luminance.',
    isMvp: false,
  },
  {
    id: 'negative-threshold',
    name: 'NEGATIVE THRESHOLD',
    shortLabel: 'NEGATIVE',
    description: 'High-contrast solarized monochrome invert with real-time threshold beam scanning.',
    isMvp: false,
  },
  {
    id: 'optical-distortion',
    name: 'OPTICAL DISTORTION',
    shortLabel: 'DISTORTION',
    description: 'Radial refractive liquid lens bubble centered on pinch point with chromatic dispersion rim.',
    isMvp: false,
  },
];

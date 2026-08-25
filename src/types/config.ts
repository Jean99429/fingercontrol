export type Hand = 'left' | 'right';
export type Finger = 'index' | 'middle' | 'ring' | 'pinky';

export type GestureState = 'IDLE' | 'APPROACHING' | 'ARMING' | 'ACTIVE' | 'RELEASING';

export interface ContentSlot {
  id: string;
  hand: Hand;
  finger: Finger;
  enabled: boolean;
  text: string;
  audioFile?: File;
  audioFileName?: string;
  audioBuffer?: AudioBuffer;
}

export interface GestureEvent {
  id: string;
  hand: Hand;
  finger: Finger;
  startTime: number; // in seconds relative to video
  releaseTime: number; // in seconds relative to video
  x: number; // 0..1 normalized
  y: number; // 0..1 normalized
  text: string;
}

export interface VideoAlignmentConfig {
  autoDetectBorder: boolean;
  scaleX: number; // 0.2 to 2.0 (default 1.0)
  scaleY: number; // 0.2 to 2.0 (default 1.0)
  offsetX: number; // -0.5 to 0.5 (default 0)
  offsetY: number; // -0.5 to 0.5 (default 0)
  cropLeft: number; // 0 to 0.4 (default 0)
  cropRight: number; // 0 to 0.4 (default 0)
  cropTop: number; // 0 to 0.4 (default 0)
  cropBottom: number; // 0 to 0.4 (default 0)
}

export interface FingercontrolConfig {
  version: 2;
  mirroredVideo: boolean;
  trackingVisible: boolean;
  slots: ContentSlot[];
  alignment?: VideoAlignmentConfig;
}

export interface FingertipPoint {
  x: number; // 0..1 normalized
  y: number; // 0..1 normalized
  z?: number;
}

export interface HandGestureData {
  hand: Hand;
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
  dragOffset: { dx: number; dy: number };
  holdDurationMs: number;
  triggerTimestamp: number;
  rawLandmarks?: FingertipPoint[];
  boundingBox?: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
}

export interface VideoAnalysisFrame {
  timestamp: number; // in seconds
  leftHand: HandGestureData;
  rightHand: HandGestureData;
}

import { FilesetResolver, HandLandmarker, HandLandmarkerResult } from '@mediapipe/tasks-vision';
import { Finger, HandGestureData, HandType, FingertipPoint, GestureState } from '../types/config';

export class GestureRecognizerManager {
  private handLandmarker: HandLandmarker | null = null;
  private isInitializing: boolean = false;
  private isLoaded: boolean = false;

  // Track state for both hands
  private states: Record<HandType, {
    state: GestureState;
    activeFinger: Finger | null;
    armStartTime: number;
    lastTriggerTime: number;
    pinchStartPos: FingertipPoint | null;
    currentPinchPos: FingertipPoint | null;
    effectConfirmedTimestamp: number;
    cooldownUntil: number;
  }> = {
    Left: {
      state: 'IDLE',
      activeFinger: null,
      armStartTime: 0,
      lastTriggerTime: 0,
      pinchStartPos: null,
      currentPinchPos: null,
      effectConfirmedTimestamp: 0,
      cooldownUntil: 0,
    },
    Right: {
      state: 'IDLE',
      activeFinger: null,
      armStartTime: 0,
      lastTriggerTime: 0,
      pinchStartPos: null,
      currentPinchPos: null,
      effectConfirmedTimestamp: 0,
      cooldownUntil: 0,
    },
  };

  // Callbacks
  private onTriggerCallback?: (hand: HandType, finger: Finger, pinchPos: FingertipPoint) => void;
  private onReleaseCallback?: (hand: HandType, finger: Finger) => void;

  public setCallbacks(
    onTrigger: (hand: HandType, finger: Finger, pinchPos: FingertipPoint) => void,
    onRelease: (hand: HandType, finger: Finger) => void
  ) {
    this.onTriggerCallback = onTrigger;
    this.onReleaseCallback = onRelease;
  }

  public async initialize(): Promise<boolean> {
    if (this.isLoaded) return true;
    if (this.isInitializing) return false;

    this.isInitializing = true;
    try {
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
      );

      this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      this.isLoaded = true;
      this.isInitializing = false;
      return true;
    } catch (err) {
      console.warn('GPU delegate failed or initial load error, attempting CPU fallback:', err);
      try {
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
        );

        this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
            delegate: 'CPU',
          },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.4,
          minHandPresenceConfidence: 0.4,
          minTrackingConfidence: 0.4,
        });

        this.isLoaded = true;
        this.isInitializing = false;
        return true;
      } catch (fallbackErr) {
        console.error('HandLandmarker initialization failed completely:', fallbackErr);
        this.isInitializing = false;
        return false;
      }
    }
  }

  public isReady(): boolean {
    return this.isLoaded && this.handLandmarker !== null;
  }

  public reset(): void {
    for (const hand of ['Left', 'Right'] as HandType[]) {
      const s = this.states[hand];
      if (s.state === 'ACTIVE' && s.activeFinger && this.onReleaseCallback) {
        this.onReleaseCallback(hand, s.activeFinger);
      }
      this.states[hand] = {
        state: 'IDLE',
        activeFinger: null,
        armStartTime: 0,
        lastTriggerTime: 0,
        pinchStartPos: null,
        currentPinchPos: null,
        effectConfirmedTimestamp: 0,
        cooldownUntil: 0,
      };
    }
  }

  public processVideoFrame(
    video: HTMLVideoElement,
    timestamp: number,
    isMirrored: boolean = true
  ): { Left: HandGestureData; Right: HandGestureData } {
    const defaultData = (hand: HandType): HandGestureData => ({
      hand,
      detected: false,
      fingertips: {
        thumb: { x: 0, y: 0 },
        index: { x: 0, y: 0 },
        middle: { x: 0, y: 0 },
        ring: { x: 0, y: 0 },
        pinky: { x: 0, y: 0 },
      },
      state: this.states[hand].state,
      activeFinger: this.states[hand].activeFinger,
      proximityDistance: 1.0,
      pinchCenter: this.states[hand].currentPinchPos,
      dragOffset: { dx: 0, dy: 0 },
      holdDurationMs: 0,
      effectConfirmedTimestamp: this.states[hand].effectConfirmedTimestamp,
    });

    const result: { Left: HandGestureData; Right: HandGestureData } = {
      Left: defaultData('Left'),
      Right: defaultData('Right'),
    };

    if (!this.handLandmarker || video.readyState < 2) {
      return result;
    }

    try {
      const detections: HandLandmarkerResult = this.handLandmarker.detectForVideo(video, timestamp);

      if (detections && detections.landmarks && detections.landmarks.length > 0) {
        for (let i = 0; i < detections.landmarks.length; i++) {
          const rawLandmarks = detections.landmarks[i];
          const handednessCategory = detections.handednesses?.[i]?.[0]?.categoryName;

          // In mirrored video mode (standard selfie mirror):
          // MediaPipe sees the camera image. When the user raises their left hand,
          // in mirrored view it appears on the screen's left side.
          // MediaPipe identifies handedness from hand anatomy.
          let handType: HandType = 'Right';
          if (handednessCategory === 'Left') {
            handType = 'Left';
          } else if (handednessCategory === 'Right') {
            handType = 'Right';
          } else {
            // Fallback based on horizontal position in mirrored view
            const wristX = isMirrored ? 1 - rawLandmarks[0].x : rawLandmarks[0].x;
            handType = wristX < 0.5 ? 'Left' : 'Right';
          }

          // Map landmarks to screen space (mirrored horizontally)
          const transformPoint = (p: { x: number; y: number; z: number }): FingertipPoint => ({
            x: isMirrored ? 1 - p.x : p.x,
            y: p.y,
            z: p.z,
          });

          const landmarks = rawLandmarks.map(transformPoint);

          // 5 Fingertips: 4 (thumb), 8 (index), 12 (middle), 16 (ring), 20 (pinky)
          const thumbTip = landmarks[4];
          const indexTip = landmarks[8];
          const middleTip = landmarks[12];
          const ringTip = landmarks[16];
          const pinkyTip = landmarks[20];

          // Hand scale: distance between wrist (0) and middle MCP (9)
          const wrist = landmarks[0];
          const middleMcp = landmarks[9];
          const handScale = Math.max(0.08, Math.hypot(middleMcp.x - wrist.x, middleMcp.y - wrist.y));

          // Calculate normalized distance from thumb tip to each fingertip
          const distToIndex = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y) / handScale;
          const distToMiddle = Math.hypot(thumbTip.x - middleTip.x, thumbTip.y - middleTip.y) / handScale;
          const distToRing = Math.hypot(thumbTip.x - ringTip.x, thumbTip.y - ringTip.y) / handScale;
          const distToPinky = Math.hypot(thumbTip.x - pinkyTip.x, thumbTip.y - pinkyTip.y) / handScale;

          const fingerDists: { finger: Finger; dist: number; tip: FingertipPoint }[] = [
            { finger: 'index', dist: distToIndex, tip: indexTip },
            { finger: 'middle', dist: distToMiddle, tip: middleTip },
            { finger: 'ring', dist: distToRing, tip: ringTip },
            { finger: 'pinky', dist: distToPinky, tip: pinkyTip },
          ];

          // Sort by nearest to thumb
          fingerDists.sort((a, b) => a.dist - b.dist);
          const nearest = fingerDists[0];

          // Hysteresis & thresholds normalized to hand scale
          const approachThreshold = 0.70;
          const pinchOnThreshold = 0.38;
          const pinchOffThreshold = 0.52;
          const ARM_DURATION_MS = 180; // Hold required before active
          const now = performance.now();

          const handState = this.states[handType];
          let currentState = handState.state;
          let activeFinger = handState.activeFinger;

          const midPoint: FingertipPoint = {
            x: (thumbTip.x + nearest.tip.x) / 2,
            y: (thumbTip.y + nearest.tip.y) / 2,
          };

          // State Machine
          if (now < handState.cooldownUntil && currentState === 'IDLE') {
            // In cooldown
          } else if (currentState === 'IDLE') {
            if (nearest.dist < pinchOnThreshold) {
              currentState = 'ARMING';
              activeFinger = nearest.finger;
              handState.armStartTime = now;
              handState.pinchStartPos = midPoint;
            } else if (nearest.dist < approachThreshold) {
              currentState = 'APPROACHING';
              activeFinger = nearest.finger;
            } else {
              activeFinger = null;
            }
          } else if (currentState === 'APPROACHING') {
            if (nearest.dist < pinchOnThreshold) {
              currentState = 'ARMING';
              activeFinger = nearest.finger;
              handState.armStartTime = now;
              handState.pinchStartPos = midPoint;
            } else if (nearest.dist >= approachThreshold) {
              currentState = 'IDLE';
              activeFinger = null;
            } else {
              activeFinger = nearest.finger;
            }
          } else if (currentState === 'ARMING') {
            if (nearest.dist > pinchOffThreshold) {
              // Released before arm threshold
              currentState = 'IDLE';
              activeFinger = null;
            } else {
              // Check arm timer
              const holdTime = now - handState.armStartTime;
              if (holdTime >= ARM_DURATION_MS) {
                currentState = 'ACTIVE';
                handState.lastTriggerTime = now;
                handState.effectConfirmedTimestamp = now;
                if (this.onTriggerCallback && activeFinger) {
                  this.onTriggerCallback(handType, activeFinger, midPoint);
                }
              }
            }
          } else if (currentState === 'ACTIVE') {
            if (nearest.dist > pinchOffThreshold || nearest.finger !== activeFinger) {
              // Released!
              currentState = 'RELEASING';
              if (this.onReleaseCallback && activeFinger) {
                this.onReleaseCallback(handType, activeFinger);
              }
              handState.cooldownUntil = now + 250; // brief cooldown
              currentState = 'IDLE';
              activeFinger = null;
              handState.pinchStartPos = null;
            }
          }

          handState.state = currentState;
          handState.activeFinger = activeFinger;
          handState.currentPinchPos = midPoint;

          // Drag offset delta calculation
          let dx = 0;
          let dy = 0;
          if (handState.pinchStartPos) {
            dx = midPoint.x - handState.pinchStartPos.x;
            dy = midPoint.y - handState.pinchStartPos.y;
          }

          result[handType] = {
            hand: handType,
            detected: true,
            fingertips: {
              thumb: thumbTip,
              index: indexTip,
              middle: middleTip,
              ring: ringTip,
              pinky: pinkyTip,
            },
            state: currentState,
            activeFinger,
            proximityDistance: nearest.dist,
            pinchCenter: midPoint,
            dragOffset: { dx, dy },
            holdDurationMs: currentState === 'ARMING' ? now - handState.armStartTime : 0,
            effectConfirmedTimestamp: handState.effectConfirmedTimestamp,
            rawLandmarks: landmarks,
          };
        }
      }
    } catch (e) {
      console.warn('Hand tracking frame processing error:', e);
    }

    return result;
  }
}

export const gestureRecognizer = new GestureRecognizerManager();

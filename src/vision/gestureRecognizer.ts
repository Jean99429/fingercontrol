import { FilesetResolver, HandLandmarker, HandLandmarkerResult } from '@mediapipe/tasks-vision';
import {
  Finger,
  HandGestureData,
  Hand,
  FingertipPoint,
  GestureState,
  GestureEvent,
  VideoAnalysisFrame,
  ContentSlot,
} from '../types/config';

function withTimeout<T>(promise: Promise<T>, ms: number, fallbackValue: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      console.warn(`Vision task timed out after ${ms}ms, using fallback`);
      resolve(fallbackValue);
    }, ms);

    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        console.warn('Vision task error:', err);
        resolve(fallbackValue);
      });
  });
}

export interface HandTrackerState {
  state: GestureState;
  activeFinger: Finger | null;
  isPinching: boolean;
  pinchStartPos: FingertipPoint | null;
  currentPinchPos: FingertipPoint | null;
  triggerTimestamp: number;
  cooldownUntil: number;
}

export class GestureRecognizerManager {
  private handLandmarker: HandLandmarker | null = null;
  private isInitializing: boolean = false;
  private isLoaded: boolean = false;

  // Track state for left and right hands
  private states: Record<Hand, HandTrackerState> = {
    left: {
      state: 'IDLE',
      activeFinger: null,
      isPinching: false,
      pinchStartPos: null,
      currentPinchPos: null,
      triggerTimestamp: 0,
      cooldownUntil: 0,
    },
    right: {
      state: 'IDLE',
      activeFinger: null,
      isPinching: false,
      pinchStartPos: null,
      currentPinchPos: null,
      triggerTimestamp: 0,
      cooldownUntil: 0,
    },
  };

  // Two-hand heart gesture tracking
  private heartGestureStartTime: number = 0;
  private heartGestureActive: boolean = false;

  // Callbacks
  private onTriggerCallback?: (hand: Hand, finger: Finger, pinchPos: FingertipPoint, timestamp: number) => void;
  private onReleaseCallback?: (hand: Hand, finger: Finger, timestamp: number) => void;
  private onHeartGestureCallback?: (timestamp: number) => void;

  public setCallbacks(
    onTrigger: (hand: Hand, finger: Finger, pinchPos: FingertipPoint, timestamp: number) => void,
    onRelease: (hand: Hand, finger: Finger, timestamp: number) => void,
    onHeartGesture?: (timestamp: number) => void
  ) {
    this.onTriggerCallback = onTrigger;
    this.onReleaseCallback = onRelease;
    this.onHeartGestureCallback = onHeartGesture;
  }

  public async initialize(): Promise<boolean> {
    if (this.isLoaded && this.handLandmarker) return true;
    if (this.isInitializing) return false;

    this.isInitializing = true;

    const loadTask = async (): Promise<boolean> => {
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
          minHandDetectionConfidence: 0.4,
          minHandPresenceConfidence: 0.4,
          minTrackingConfidence: 0.4,
        });

        this.isLoaded = true;
        return true;
      } catch (gpuErr) {
        console.warn('MediaPipe GPU load failed, falling back to CPU delegate:', gpuErr);
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
            minHandDetectionConfidence: 0.35,
            minHandPresenceConfidence: 0.35,
            minTrackingConfidence: 0.35,
          });

          this.isLoaded = true;
          return true;
        } catch (cpuErr) {
          console.warn('MediaPipe CPU load failed:', cpuErr);
          return false;
        }
      }
    };

    const success = await withTimeout(loadTask(), 4500, false);
    this.isInitializing = false;
    return success;
  }

  public isReady(): boolean {
    return this.isLoaded && this.handLandmarker !== null;
  }

  public reset(): void {
    this.heartGestureStartTime = 0;
    this.heartGestureActive = false;
    for (const hand of ['left', 'right'] as Hand[]) {
      const s = this.states[hand];
      if (s.state === 'ACTIVE' && s.activeFinger && this.onReleaseCallback) {
        this.onReleaseCallback(hand, s.activeFinger, performance.now());
      }
      this.states[hand] = {
        state: 'IDLE',
        activeFinger: null,
        isPinching: false,
        pinchStartPos: null,
        currentPinchPos: null,
        triggerTimestamp: 0,
        cooldownUntil: 0,
      };
    }
  }

  /**
   * Process a single video frame (live camera or video playback)
   */
  public processVideoFrame(
    video: HTMLVideoElement | HTMLCanvasElement,
    timestampMs: number,
    isMirrored: boolean = true
  ): { left: HandGestureData; right: HandGestureData } {
    const defaultData = (hand: Hand): HandGestureData => ({
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
      triggerTimestamp: this.states[hand].triggerTimestamp,
    });

    const result: { left: HandGestureData; right: HandGestureData } = {
      left: defaultData('left'),
      right: defaultData('right'),
    };

    if (!this.handLandmarker) {
      return result;
    }

    if (video instanceof HTMLVideoElement && video.readyState < 2) {
      return result;
    }

    try {
      const detections: HandLandmarkerResult = this.handLandmarker.detectForVideo(video, timestampMs);

      if (detections && detections.landmarks && detections.landmarks.length > 0) {
        for (let i = 0; i < detections.landmarks.length; i++) {
          const rawLandmarks = detections.landmarks[i];
          const handednessCategory = detections.handednesses?.[i]?.[0]?.categoryName;

          // Determine hand type (left vs right)
          let handType: Hand = 'right';
          if (handednessCategory === 'Left') {
            handType = 'left';
          } else if (handednessCategory === 'Right') {
            handType = 'right';
          } else {
            const wristX = isMirrored ? 1 - rawLandmarks[0].x : rawLandmarks[0].x;
            handType = wristX < 0.5 ? 'left' : 'right';
          }

          // Map landmarks to screen space (mirrored horizontally if requested)
          const transformPoint = (p: { x: number; y: number; z?: number }): FingertipPoint => ({
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

          // Compute Bounding Box from all 21 landmarks
          let minX = 1;
          let minY = 1;
          let maxX = 0;
          let maxY = 0;
          for (const pt of landmarks) {
            if (pt.x < minX) minX = pt.x;
            if (pt.y < minY) minY = pt.y;
            if (pt.x > maxX) maxX = pt.x;
            if (pt.y > maxY) maxY = pt.y;
          }

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

          // Thresholds for clean instant pinch trigger
          const pinchOnThreshold = 0.50;
          const pinchOffThreshold = 0.68;
          const now = timestampMs;

          const handState = this.states[handType];
          const prevPinch = handState.isPinching;
          const currentPinch = nearest.dist < (prevPinch ? pinchOffThreshold : pinchOnThreshold);

          const midPoint: FingertipPoint = {
            x: (thumbTip.x + nearest.tip.x) / 2,
            y: (thumbTip.y + nearest.tip.y) / 2,
          };

          let currentState: GestureState = handState.state;
          let activeFinger: Finger | null = handState.activeFinger;

          // DIRECT PINCH TRIGGER: false -> true transition
          if (!prevPinch && currentPinch) {
            handState.isPinching = true;
            currentState = 'ACTIVE';
            activeFinger = nearest.finger;
            handState.pinchStartPos = midPoint;
            handState.triggerTimestamp = now;

            // Trigger immediately without delay or beep
            if (this.onTriggerCallback) {
              this.onTriggerCallback(handType, nearest.finger, midPoint, now);
            }
          } else if (prevPinch && !currentPinch) {
            // true -> false transition
            handState.isPinching = false;
            currentState = 'IDLE';
            if (this.onReleaseCallback && activeFinger) {
              this.onReleaseCallback(handType, activeFinger, now);
            }
            activeFinger = null;
            handState.pinchStartPos = null;
          } else if (currentPinch) {
            currentState = 'ACTIVE';
            activeFinger = handState.activeFinger || nearest.finger;
          } else {
            currentState = nearest.dist < 0.75 ? 'APPROACHING' : 'IDLE';
            activeFinger = null;
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
            holdDurationMs: 0,
            triggerTimestamp: handState.triggerTimestamp,
            rawLandmarks: landmarks,
            boundingBox: { minX, minY, maxX, maxY },
          };
        }

        // Two-Hand Heart Gesture Detection (>350ms hold)
        if (result.left.detected && result.right.detected) {
          const leftThumb = result.left.fingertips.thumb;
          const rightThumb = result.right.fingertips.thumb;
          const leftIndex = result.left.fingertips.index;
          const rightIndex = result.right.fingertips.index;

          const thumbDist = Math.hypot(leftThumb.x - rightThumb.x, leftThumb.y - rightThumb.y);
          const indexDist = Math.hypot(leftIndex.x - rightIndex.x, leftIndex.y - rightIndex.y);

          // Heart shape: thumbs close together and index fingers close together
          const isHeartShaped = thumbDist < 0.16 && indexDist < 0.16;

          if (isHeartShaped) {
            if (this.heartGestureStartTime === 0) {
              this.heartGestureStartTime = timestampMs;
            } else if (timestampMs - this.heartGestureStartTime >= 350) {
              if (!this.heartGestureActive) {
                this.heartGestureActive = true;
                if (this.onHeartGestureCallback) {
                  this.onHeartGestureCallback(timestampMs);
                }
              }
            }
          } else {
            this.heartGestureStartTime = 0;
            this.heartGestureActive = false;
          }
        } else {
          this.heartGestureStartTime = 0;
          this.heartGestureActive = false;
        }
      } else {
        this.heartGestureStartTime = 0;
        this.heartGestureActive = false;
      }
    } catch (e) {
      console.warn('Hand tracking frame processing error:', e);
    }

    return result;
  }

  /**
   * Analyze an uploaded video frame by frame
   * Generates all GestureEvents and VideoAnalysisFrame data.
   */
  public async analyzeVideo(
    videoElement: HTMLVideoElement,
    slots: ContentSlot[],
    isMirrored: boolean,
    onProgress: (progress: number, statusText: string) => void
  ): Promise<{ events: GestureEvent[]; frames: VideoAnalysisFrame[] }> {
    await this.initialize();
    this.reset();

    const duration = videoElement.duration;
    if (!duration || isNaN(duration) || duration <= 0) {
      throw new Error('Invalid video duration');
    }

    const fps = 30;
    const interval = 1 / fps;
    const totalFrames = Math.ceil(duration * fps);

    const events: GestureEvent[] = [];
    const frames: VideoAnalysisFrame[] = [];

    // Track active event per hand during offline scanning
    const activeEvents: Record<Hand, GestureEvent | null> = {
      left: null,
      right: null,
    };

    // Slot lookup map
    const slotMap = new Map<string, ContentSlot>();
    for (const slot of slots) {
      slotMap.set(`${slot.hand}-${slot.finger}`, slot);
    }

    // Set callback to accumulate events
    this.setCallbacks(
      (hand, finger, pinchPos, timestamp) => {
        const timeSec = timestamp / 1000;
        const slot = slotMap.get(`${hand}-${finger}`);
        const text = slot?.text || finger.toUpperCase();
        const eventId = `event-${hand}-${finger}-${Math.round(timestamp)}`;

        const event: GestureEvent = {
          id: eventId,
          hand,
          finger,
          startTime: timeSec,
          releaseTime: timeSec + 1.2, // provisional
          x: pinchPos.x,
          y: pinchPos.y,
          text,
        };

        activeEvents[hand] = event;
        events.push(event);
      },
      (hand, _finger, timestamp) => {
        const timeSec = timestamp / 1000;
        if (activeEvents[hand]) {
          activeEvents[hand]!.releaseTime = timeSec;
          activeEvents[hand] = null;
        }
      }
    );

    // Step through each frame
    for (let i = 0; i < totalFrames; i++) {
      const targetTime = Math.min(i * interval, duration);
      videoElement.currentTime = targetTime;

      // Wait for seek to complete
      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          videoElement.removeEventListener('seeked', onSeeked);
          resolve();
        };
        videoElement.addEventListener('seeked', onSeeked, { once: true });
      });

      const timestampMs = targetTime * 1000;
      const frameData = this.processVideoFrame(videoElement, timestampMs, isMirrored);

      frames.push({
        timestamp: targetTime,
        leftHand: frameData.left,
        rightHand: frameData.right,
      });

      const progress = Math.min(100, Math.round(((i + 1) / totalFrames) * 100));
      onProgress(progress, `ANALYZING FRAME ${i + 1}/${totalFrames} (${targetTime.toFixed(1)}s / ${duration.toFixed(1)}s)`);

      // Yield event loop occasionally to keep UI snappy
      if (i % 5 === 0) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    // Close any unreleased events
    for (const hand of ['left', 'right'] as Hand[]) {
      if (activeEvents[hand]) {
        activeEvents[hand]!.releaseTime = duration;
        activeEvents[hand] = null;
      }
    }

    this.reset();
    return { events, frames };
  }
}

export const gestureRecognizer = new GestureRecognizerManager();

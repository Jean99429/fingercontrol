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
  VideoAlignmentConfig,
} from '../types/config';

export interface HandTrackerState {
  state: GestureState;
  activeFinger: Finger | null;
  isPinching: boolean;
  pinchStartPos: FingertipPoint | null;
  currentPinchPos: FingertipPoint | null;
  triggerTimestamp: number;
  cooldownUntil: number;
}

export interface ContentBounds {
  cropLeft: number; // 0..1 fraction of width
  cropRight: number; // 0..1 fraction of width
  cropTop: number; // 0..1 fraction of height
  cropBottom: number; // 0..1 fraction of height
  widthRatio: number; // 1 - cropLeft - cropRight
  heightRatio: number; // 1 - cropTop - cropBottom
}

export interface CoordinateAlignment {
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
  contentBounds?: ContentBounds;
}

export class GestureRecognizerManager {
  private handLandmarker: HandLandmarker | null = null;
  private isInitializing: boolean = false;
  private isLoaded: boolean = false;
  private loadError: string | null = null;

  // Offscreen canvas for pre-filtering stylized / scanline / dithered videos
  private filterCanvas: HTMLCanvasElement | null = null;
  private filterCtx: CanvasRenderingContext2D | null = null;

  // Auxiliary filter canvas for multi-scale downsampling
  private auxCanvas: HTMLCanvasElement | null = null;
  private auxCtx: CanvasRenderingContext2D | null = null;

  // Strictly increasing timestamp tracker required by MediaPipe Video mode
  private lastProcessedTimestamp: number = 0;

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

  // Previous detected hands cache for smooth temporal interpolation
  private lastKnownLandmarks: Record<Hand, { landmarks: FingertipPoint[]; timestamp: number } | null> = {
    left: null,
    right: null,
  };

  private fingerCandidateHistory: Record<Hand, Finger[]> = {
    left: [],
    right: [],
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
    if (this.isInitializing) {
      let attempts = 0;
      while (this.isInitializing && attempts < 60) {
        await new Promise((r) => setTimeout(r, 100));
        attempts++;
      }
      return this.isLoaded && this.handLandmarker !== null;
    }

    this.isInitializing = true;
    this.loadError = null;

    try {
      console.info('[Vision] Loading MediaPipe FilesetResolver...');
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm'
      );

      console.info('[Vision] Creating HandLandmarker (High-Sensitivity mode)...');
      try {
        this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.12,
          minHandPresenceConfidence: 0.12,
          minTrackingConfidence: 0.12,
        });

        this.isLoaded = true;
        this.isInitializing = false;
        console.info('[Vision] MediaPipe HandLandmarker loaded successfully with GPU delegate.');
        return true;
      } catch (gpuErr) {
        console.warn('[Vision] GPU load failed, using CPU delegate:', gpuErr);
        this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
            delegate: 'CPU',
          },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.12,
          minHandPresenceConfidence: 0.12,
          minTrackingConfidence: 0.12,
        });

        this.isLoaded = true;
        this.isInitializing = false;
        console.info('[Vision] MediaPipe HandLandmarker loaded successfully with CPU delegate.');
        return true;
      }
    } catch (err: unknown) {
      console.error('[Vision] MediaPipe initialization error:', err);
      this.loadError = err instanceof Error ? err.message : String(err);
      this.isInitializing = false;
      return false;
    }
  }

  public isReady(): boolean {
    return this.isLoaded && this.handLandmarker !== null;
  }

  public getLoadError(): string | null {
    return this.loadError;
  }

  public reset(): void {
    this.heartGestureStartTime = 0;
    this.heartGestureActive = false;
    this.lastKnownLandmarks = { left: null, right: null };
    this.fingerCandidateHistory = { left: [], right: [] };
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
   * Ensure MediaPipe CalculatorGraph always receives strictly increasing timestamps
   */
  private getNextSafeTimestamp(requestedMs: number): number {
    const rounded = Math.round(requestedMs);
    const safe = rounded > this.lastProcessedTimestamp ? rounded : this.lastProcessedTimestamp + 1;
    this.lastProcessedTimestamp = safe;
    return safe;
  }

  /**
   * Helper to create or get the offscreen pre-filtering canvas
   */
  private getFilterCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
    if (!this.filterCanvas) {
      this.filterCanvas = document.createElement('canvas');
      this.filterCtx = this.filterCanvas.getContext('2d', { willReadFrequently: true });
    }
    if (!this.filterCanvas || !this.filterCtx) return null;

    if (this.filterCanvas.width !== width || this.filterCanvas.height !== height) {
      this.filterCanvas.width = width;
      this.filterCanvas.height = height;
    }
    return { canvas: this.filterCanvas, ctx: this.filterCtx };
  }

  /**
   * 100% AUTOMATIC Background Border & CRT Screen Frame Detection
   * Analyzes multiple frames asynchronously to reliably locate the inner video viewport.
   */
  public async detectActiveContentBoundsAsync(videoElement: HTMLVideoElement): Promise<ContentBounds> {
    const w = videoElement.videoWidth;
    const h = videoElement.videoHeight;
    const dur = videoElement.duration;

    if (!w || !h || !dur || isNaN(dur) || dur <= 0) {
      return { cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0, widthRatio: 1, heightRatio: 1 };
    }

    const sampleW = 320;
    const sampleH = 180;
    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = sampleW;
    sampleCanvas.height = sampleH;
    const ctx = sampleCanvas.getContext('2d', { willReadFrequently: true });

    if (!ctx) {
      return { cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0, widthRatio: 1, heightRatio: 1 };
    }

    // Sample at 4 keyframes (15%, 35%, 55%, 75% duration)
    const sampleTimes = [dur * 0.15, dur * 0.35, dur * 0.55, dur * 0.75];
    const cropLefts: number[] = [];
    const cropRights: number[] = [];
    const cropTops: number[] = [];
    const cropBottoms: number[] = [];

    const originalTime = videoElement.currentTime;

    for (const time of sampleTimes) {
      videoElement.currentTime = time;
      await new Promise<void>((resolve) => {
        const onSeek = () => {
          videoElement.removeEventListener('seeked', onSeek);
          resolve();
        };
        videoElement.addEventListener('seeked', onSeek);
      });

      ctx.drawImage(videoElement, 0, 0, sampleW, sampleH);
      const imgData = ctx.getImageData(0, 0, sampleW, sampleH).data;

      const getLuma = (x: number, y: number): number => {
        const idx = (y * sampleW + x) * 4;
        return imgData[idx] * 0.299 + imgData[idx + 1] * 0.587 + imgData[idx + 2] * 0.114;
      };

      const blackThreshold = 22; // Threshold for dark bezel / black bars

      // Top Border
      let topY = 0;
      for (let y = 0; y < Math.floor(sampleH * 0.45); y++) {
        let maxVal = 0;
        for (let x = Math.floor(sampleW * 0.2); x < Math.floor(sampleW * 0.8); x++) {
          const luma = getLuma(x, y);
          if (luma > maxVal) maxVal = luma;
        }
        if (maxVal > blackThreshold) {
          topY = y;
          break;
        }
      }

      // Bottom Border
      let bottomY = sampleH - 1;
      for (let y = sampleH - 1; y > Math.floor(sampleH * 0.55); y--) {
        let maxVal = 0;
        for (let x = Math.floor(sampleW * 0.2); x < Math.floor(sampleW * 0.8); x++) {
          const luma = getLuma(x, y);
          if (luma > maxVal) maxVal = luma;
        }
        if (maxVal > blackThreshold) {
          bottomY = y;
          break;
        }
      }

      // Left Border
      let leftX = 0;
      for (let x = 0; x < Math.floor(sampleW * 0.45); x++) {
        let maxVal = 0;
        for (let y = Math.floor(sampleH * 0.2); y < Math.floor(sampleH * 0.8); y++) {
          const luma = getLuma(x, y);
          if (luma > maxVal) maxVal = luma;
        }
        if (maxVal > blackThreshold) {
          leftX = x;
          break;
        }
      }

      // Right Border
      let rightX = sampleW - 1;
      for (let x = sampleW - 1; x > Math.floor(sampleW * 0.55); x--) {
        let maxVal = 0;
        for (let y = Math.floor(sampleH * 0.2); y < Math.floor(sampleH * 0.8); y++) {
          const luma = getLuma(x, y);
          if (luma > maxVal) maxVal = luma;
        }
        if (maxVal > blackThreshold) {
          rightX = x;
          break;
        }
      }

      cropLefts.push(leftX / sampleW);
      cropRights.push((sampleW - 1 - rightX) / sampleW);
      cropTops.push(topY / sampleH);
      cropBottoms.push((sampleH - 1 - bottomY) / sampleH);
    }

    // Restore time
    videoElement.currentTime = originalTime;

    // Median filter results
    const median = (arr: number[]): number => {
      const sorted = [...arr].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    };

    const finalCropLeft = Math.max(0, Math.min(0.45, median(cropLefts)));
    const finalCropRight = Math.max(0, Math.min(0.45, median(cropRights)));
    const finalCropTop = Math.max(0, Math.min(0.45, median(cropTops)));
    const finalCropBottom = Math.max(0, Math.min(0.45, median(cropBottoms)));

    const widthRatio = Math.max(0.1, 1 - finalCropLeft - finalCropRight);
    const heightRatio = Math.max(0.1, 1 - finalCropTop - finalCropBottom);

    const bounds: ContentBounds = {
      cropLeft: finalCropLeft,
      cropRight: finalCropRight,
      cropTop: finalCropTop,
      cropBottom: finalCropBottom,
      widthRatio,
      heightRatio,
    };

    console.info('[Vision] 🎯 100% Auto-Detected Display Screen Bounds:', {
      cropLeft: `${(finalCropLeft * 100).toFixed(1)}%`,
      cropRight: `${(finalCropRight * 100).toFixed(1)}%`,
      cropTop: `${(finalCropTop * 100).toFixed(1)}%`,
      cropBottom: `${(finalCropBottom * 100).toFixed(1)}%`,
      contentWidth: `${(widthRatio * 100).toFixed(1)}%`,
      contentHeight: `${(heightRatio * 100).toFixed(1)}%`,
    });

    return bounds;
  }

  /**
   * Helper to compute combined alignment mapping between tracking video, display video, and active letterbox borders
   */
  public computePreciseAlignment(
    trackWidth: number,
    trackHeight: number,
    displayWidth: number,
    displayHeight: number,
    displayBounds?: ContentBounds
  ): CoordinateAlignment {
    if (trackWidth <= 0 || trackHeight <= 0 || displayWidth <= 0 || displayHeight <= 0) {
      return { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };
    }

    const bounds = displayBounds || {
      cropLeft: 0,
      cropRight: 0,
      cropTop: 0,
      cropBottom: 0,
      widthRatio: 1,
      heightRatio: 1,
    };

    // Effective aspect ratio of the inner active display screen
    const effectiveDisplayW = displayWidth * bounds.widthRatio;
    const effectiveDisplayH = displayHeight * bounds.heightRatio;

    const trackAspect = trackWidth / trackHeight;
    const contentAspect = effectiveDisplayW / effectiveDisplayH;

    let baseScaleX = 1;
    let baseScaleY = 1;
    let baseOffsetX = 0;
    let baseOffsetY = 0;

    if (Math.abs(trackAspect - contentAspect) > 0.02) {
      if (contentAspect > trackAspect) {
        // Content area is wider than tracking video: pillarboxed inside content area
        baseScaleX = trackAspect / contentAspect;
        baseScaleY = 1;
        baseOffsetX = (1 - baseScaleX) / 2;
        baseOffsetY = 0;
      } else {
        // Content area is taller: letterboxed inside content area
        baseScaleX = 1;
        baseScaleY = contentAspect / trackAspect;
        baseOffsetX = 0;
        baseOffsetY = (1 - baseScaleY) / 2;
      }
    }

    // Map content box into full normalized coordinate space of the display canvas
    const finalScaleX = baseScaleX * bounds.widthRatio;
    const finalScaleY = baseScaleY * bounds.heightRatio;
    const finalOffsetX = bounds.cropLeft + baseOffsetX * bounds.widthRatio;
    const finalOffsetY = bounds.cropTop + baseOffsetY * bounds.heightRatio;

    console.info('[Vision] 📐 Auto Transform Matrix:', {
      finalScaleX: finalScaleX.toFixed(3),
      finalScaleY: finalScaleY.toFixed(3),
      finalOffsetX: finalOffsetX.toFixed(3),
      finalOffsetY: finalOffsetY.toFixed(3),
    });

    return {
      scaleX: finalScaleX,
      scaleY: finalScaleY,
      offsetX: finalOffsetX,
      offsetY: finalOffsetY,
      contentBounds: bounds,
    };
  }

  /**
   * Process a single video frame:
   * Multi-stage pipeline with Scanline Inpainting & Contrast Equalization for stylized videos
   */
  public processVideoFrame(
    video: HTMLVideoElement | HTMLCanvasElement,
    timestampMs: number,
    isMirrored: boolean = true,
    coordinateMapping?: CoordinateAlignment
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

    const videoWidth = video instanceof HTMLVideoElement ? video.videoWidth || 640 : video.width;
    const videoHeight = video instanceof HTMLVideoElement ? video.videoHeight || 480 : video.height;

    try {
      // ----------------------------------------------------
      // PASS 1: Direct Raw Detection
      // ----------------------------------------------------
      const safeTime1 = this.getNextSafeTimestamp(timestampMs);
      let detections: HandLandmarkerResult | null = null;

      try {
        detections = this.handLandmarker.detectForVideo(video, safeTime1);
      } catch (detErr) {
        console.warn('[Vision] Pass 1 direct detection error:', detErr);
      }

      // ----------------------------------------------------
      // PASS 2: Scanline Inpainting & Adaptive Contrast (For CRT & Dither Artifacts)
      // ----------------------------------------------------
      if ((!detections || !detections.landmarks || detections.landmarks.length < 2) && videoWidth > 0 && videoHeight > 0) {
        const filterBundle = this.getFilterCanvas(videoWidth, videoHeight);
        if (filterBundle) {
          const { canvas: fCanvas, ctx: fCtx } = filterBundle;

          // Vertical Anisotropic Filter: Blur vertically to stitch broken scanlines
          fCtx.filter = 'blur(1.5px) contrast(1.4) brightness(1.1)';
          fCtx.drawImage(video, 0, 0, videoWidth, videoHeight);

          // Blend with 1px vertical shift to fill scanline gaps
          fCtx.globalAlpha = 0.5;
          fCtx.drawImage(video, 0, 1, videoWidth, videoHeight);
          fCtx.drawImage(video, 0, -1, videoWidth, videoHeight);
          fCtx.globalAlpha = 1.0;
          fCtx.filter = 'none';

          const safeTime2 = this.getNextSafeTimestamp(safeTime1 + 1);
          try {
            const filteredDetections = this.handLandmarker.detectForVideo(fCanvas, safeTime2);
            if (filteredDetections && filteredDetections.landmarks && filteredDetections.landmarks.length > (detections?.landmarks?.length || 0)) {
              detections = filteredDetections;
            }
          } catch (filtErr) {
            console.warn('[Vision] Pass 2 scanline inpainting detection warning:', filtErr);
          }
        }
      }

      // ----------------------------------------------------
      // PASS 3: Downsampled Dither Melting (For extreme 1-bit or pixel-art stylization)
      // ----------------------------------------------------
      if ((!detections || !detections.landmarks || detections.landmarks.length === 0) && videoWidth > 0 && videoHeight > 0) {
        if (!this.auxCanvas) {
          this.auxCanvas = document.createElement('canvas');
          this.auxCtx = this.auxCanvas.getContext('2d', { willReadFrequently: true });
        }
        if (this.auxCanvas && this.auxCtx) {
          const downW = Math.round(videoWidth * 0.7);
          const downH = Math.round(videoHeight * 0.7);
          if (this.auxCanvas.width !== downW || this.auxCanvas.height !== downH) {
            this.auxCanvas.width = downW;
            this.auxCanvas.height = downH;
          }

          this.auxCtx.imageSmoothingEnabled = true;
          this.auxCtx.imageSmoothingQuality = 'high';
          this.auxCtx.filter = 'blur(1.2px) contrast(1.5)';
          this.auxCtx.drawImage(video, 0, 0, downW, downH);
          this.auxCtx.filter = 'none';

          const safeTime3 = this.getNextSafeTimestamp(safeTime1 + 2);
          try {
            const downDetections = this.handLandmarker.detectForVideo(this.auxCanvas, safeTime3);
            if (downDetections && downDetections.landmarks && downDetections.landmarks.length > 0) {
              detections = downDetections;
            }
          } catch (downErr) {
            console.warn('[Vision] Pass 3 downsample detection warning:', downErr);
          }
        }
      }

      // ----------------------------------------------------
      // PROCESS DETECTED HANDS
      // ----------------------------------------------------
      if (detections && detections.landmarks && detections.landmarks.length > 0) {
        let uploadHandAssignments: Hand[] | null = null;
        if (coordinateMapping) {
          const wrists = detections.landmarks.map((points) => ({
            x: coordinateMapping.offsetX + (isMirrored ? 1 - points[0].x : points[0].x) * coordinateMapping.scaleX,
            y: coordinateMapping.offsetY + points[0].y * coordinateMapping.scaleY,
          }));
          const previousLeft = this.lastKnownLandmarks.left?.landmarks[0];
          const previousRight = this.lastKnownLandmarks.right?.landmarks[0];
          const distance = (a: FingertipPoint, b: FingertipPoint) => Math.hypot(a.x - b.x, a.y - b.y);

          if (wrists.length >= 2) {
            if (previousLeft && previousRight) {
              const direct = distance(wrists[0], previousLeft) + distance(wrists[1], previousRight);
              const swapped = distance(wrists[0], previousRight) + distance(wrists[1], previousLeft);
              uploadHandAssignments = direct <= swapped ? ['left', 'right'] : ['right', 'left'];
            } else {
              uploadHandAssignments = wrists[0].x <= wrists[1].x ? ['left', 'right'] : ['right', 'left'];
            }
          } else {
            const wrist = wrists[0];
            if (previousLeft && previousRight) {
              uploadHandAssignments = [distance(wrist, previousLeft) <= distance(wrist, previousRight) ? 'left' : 'right'];
            } else if (previousLeft && distance(wrist, previousLeft) < 0.35) {
              uploadHandAssignments = ['left'];
            } else if (previousRight && distance(wrist, previousRight) < 0.35) {
              uploadHandAssignments = ['right'];
            } else {
              uploadHandAssignments = [wrist.x < 0.5 ? 'left' : 'right'];
            }
          }
        }

        for (let i = 0; i < detections.landmarks.length; i++) {
          const rawLandmarks = detections.landmarks[i];
          const handednessCategory = detections.handednesses?.[i]?.[0]?.categoryName;
          const transformedWristX = isMirrored ? 1 - rawLandmarks[0].x : rawLandmarks[0].x;

          let handType: Hand = 'right';
          if (uploadHandAssignments) {
            handType = uploadHandAssignments[i];
          } else if (handednessCategory === 'Left') {
            handType = isMirrored ? 'right' : 'left';
          } else if (handednessCategory === 'Right') {
            handType = isMirrored ? 'left' : 'right';
          } else {
            handType = transformedWristX < 0.5 ? 'left' : 'right';
          }

          // Transform raw normalized point [0..1] with horizontal mirror and accurate coordinate mapping
          const transformPoint = (p: { x: number; y: number; z?: number }): FingertipPoint => {
            let nx = isMirrored ? 1 - p.x : p.x;
            let ny = p.y;

            if (coordinateMapping) {
              nx = coordinateMapping.offsetX + nx * coordinateMapping.scaleX;
              ny = coordinateMapping.offsetY + ny * coordinateMapping.scaleY;
            }

            return {
              x: Math.max(0, Math.min(1, nx)),
              y: Math.max(0, Math.min(1, ny)),
              z: p.z,
            };
          };

          const landmarks = rawLandmarks.map(transformPoint);

          this.lastKnownLandmarks[handType] = {
            landmarks,
            timestamp: timestampMs,
          };

          // 5 Fingertips: 4 (thumb), 8 (index), 12 (middle), 16 (ring), 20 (pinky)
          const thumbTip = landmarks[4];
          const indexTip = landmarks[8];
          const middleTip = landmarks[12];
          const ringTip = landmarks[16];
          const pinkyTip = landmarks[20];

          // Compute Bounding Box
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

          // Hand scale
          const wrist = landmarks[0];
          const middleMcp = landmarks[9];
          const handScale = Math.max(0.05, Math.hypot(middleMcp.x - wrist.x, middleMcp.y - wrist.y));

          // Distance from thumb tip to each fingertip
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

          fingerDists.sort((a, b) => a.dist - b.dist);
          const nearest = fingerDists[0];

          // Immediate engagement and release: no hysteresis / release buffer.
          const pinchOnThreshold = 0.64;
          const pinchOffThreshold = 0.64;
          const now = timestampMs;

          const handState = this.states[handType];
          const prevPinch = handState.isPinching;
          const candidateHistory = this.fingerCandidateHistory[handType];

          if (!prevPinch) {
            if (nearest.dist < 0.95) {
              candidateHistory.push(nearest.finger);
              if (candidateHistory.length > 5) candidateHistory.shift();
            } else {
              candidateHistory.length = 0;
            }
          }

          let selectedFinger = handState.activeFinger || nearest.finger;
          if (!prevPinch && candidateHistory.length > 0) {
            const counts = new Map<Finger, number>();
            for (const candidate of candidateHistory) {
              counts.set(candidate, (counts.get(candidate) || 0) + 1);
            }
            selectedFinger = [...candidateHistory]
              .reverse()
              .reduce((best, candidate) =>
                (counts.get(candidate) || 0) > (counts.get(best) || 0) ? candidate : best
              );
          }

          let selected = fingerDists.find((entry) => entry.finger === selectedFinger) || nearest;
          if (!prevPinch && selected.dist > pinchOnThreshold + 0.08) selected = nearest;
          const currentPinch = selected.dist < (prevPinch ? pinchOffThreshold : pinchOnThreshold);

          const midPoint: FingertipPoint = {
            x: (thumbTip.x + selected.tip.x) / 2,
            y: (thumbTip.y + selected.tip.y) / 2,
          };

          let currentState: GestureState = handState.state;
          let activeFinger: Finger | null = handState.activeFinger;

          if (!prevPinch && currentPinch) {
            handState.isPinching = true;
            currentState = 'ACTIVE';
            activeFinger = selected.finger;
            handState.pinchStartPos = midPoint;
            handState.triggerTimestamp = now;

            if (this.onTriggerCallback) {
              this.onTriggerCallback(handType, selected.finger, midPoint, now);
            }
          } else if (prevPinch && !currentPinch) {
            handState.isPinching = false;
            currentState = 'IDLE';
            if (this.onReleaseCallback && activeFinger) {
              this.onReleaseCallback(handType, activeFinger, now);
            }
            activeFinger = null;
            handState.pinchStartPos = null;
            candidateHistory.length = 0;
          } else if (currentPinch) {
            currentState = 'ACTIVE';
            activeFinger = handState.activeFinger || selected.finger;
          } else {
            currentState = nearest.dist < 0.88 ? 'APPROACHING' : 'IDLE';
            activeFinger = null;
          }

          handState.state = currentState;
          handState.activeFinger = activeFinger;
          handState.currentPinchPos = midPoint;

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
            proximityDistance: selected.dist,
            pinchCenter: midPoint,
            dragOffset: { dx, dy },
            holdDurationMs: 0,
            triggerTimestamp: handState.triggerTimestamp,
            rawLandmarks: landmarks,
            boundingBox: { minX, minY, maxX, maxY },
          };
        }

        // Two-Hand Heart Gesture Detection
        if (result.left.detected && result.right.detected) {
          const leftThumb = result.left.fingertips.thumb;
          const rightThumb = result.right.fingertips.thumb;
          const leftIndex = result.left.fingertips.index;
          const rightIndex = result.right.fingertips.index;

          const thumbDist = Math.hypot(leftThumb.x - rightThumb.x, leftThumb.y - rightThumb.y);
          const indexDist = Math.hypot(leftIndex.x - rightIndex.x, leftIndex.y - rightIndex.y);

          const isHeartPosing =
            thumbDist < 0.14 &&
            indexDist < 0.14 &&
            leftThumb.y > leftIndex.y - 0.05 &&
            rightThumb.y > rightIndex.y - 0.05;

          if (isHeartPosing) {
            if (this.heartGestureStartTime === 0) {
              this.heartGestureStartTime = timestampMs;
            } else if (timestampMs - this.heartGestureStartTime > 350 && !this.heartGestureActive) {
              this.heartGestureActive = true;
              if (this.onHeartGestureCallback) {
                this.onHeartGestureCallback(timestampMs);
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
        // Single frame dropout recovery
        for (const hand of ['left', 'right'] as Hand[]) {
          const s = this.states[hand];
          const cache = this.lastKnownLandmarks[hand];

          if (cache && timestampMs - cache.timestamp < 120 && s.isPinching) {
            const landmarks = cache.landmarks;
            result[hand] = {
              hand,
              detected: true,
              fingertips: {
                thumb: landmarks[4],
                index: landmarks[8],
                middle: landmarks[12],
                ring: landmarks[16],
                pinky: landmarks[20],
              },
              state: s.state,
              activeFinger: s.activeFinger,
              proximityDistance: 0.35,
              pinchCenter: s.currentPinchPos,
              dragOffset: { dx: 0, dy: 0 },
              holdDurationMs: 0,
              triggerTimestamp: s.triggerTimestamp,
              rawLandmarks: landmarks,
            };
          } else {
            if (s.isPinching && s.activeFinger && this.onReleaseCallback) {
              this.onReleaseCallback(hand, s.activeFinger, timestampMs);
            }
            s.isPinching = false;
            s.state = 'IDLE';
            s.activeFinger = null;
          }
        }
        this.heartGestureStartTime = 0;
        this.heartGestureActive = false;
      }
    } catch (err) {
      console.warn('[Vision] Detection error in frame:', err);
    }

    return result;
  }

  /**
   * Process a single video file frame-by-frame for offline analysis (with 100% automatic display video aspect & border alignment)
   */
  public async analyzeVideoFile(
    videoElement: HTMLVideoElement,
    onProgress: (percent: number, status: string) => void,
    slots: ContentSlot[],
    isMirrored: boolean = false,
    displayVideoElement?: HTMLVideoElement | null
  ): Promise<{ events: GestureEvent[]; frames: VideoAnalysisFrame[]; alignment?: CoordinateAlignment }> {
    const isReady = await this.initialize();
    if (!isReady) {
      throw new Error('Could not load HandLandmarker model for video analysis.');
    }

    const trackingDuration = videoElement.duration;
    if (!trackingDuration || isNaN(trackingDuration) || trackingDuration <= 0) {
      throw new Error('Invalid video duration.');
    }
    const rawDisplayDuration = displayVideoElement?.duration;
    const displayDuration = rawDisplayDuration && isFinite(rawDisplayDuration) && rawDisplayDuration > 0
      ? rawDisplayDuration
      : trackingDuration;
    const fps = 30;
    // Tracking and display share the same absolute timeline. The tracking
    // video is only a spatial landmark source; never stretch its timestamps.
    const analysisDuration = Math.min(trackingDuration, displayDuration);
    const totalFrames = Math.max(1, Math.floor(analysisDuration * fps));
    const events: GestureEvent[] = [];
    const frames: VideoAnalysisFrame[] = [];

    this.reset();

    const canvas = document.createElement('canvas');
    canvas.width = videoElement.videoWidth || 1280;
    canvas.height = videoElement.videoHeight || 720;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    // Compute automatic coordinate alignment with active border detection if display video exists
    let coordinateMapping: CoordinateAlignment | undefined = undefined;
    if (displayVideoElement && displayVideoElement.videoWidth > 0 && displayVideoElement.videoHeight > 0) {
      onProgress(2, 'Auto-detecting display screen frame & border alignment...');
      const displayBounds = await this.detectActiveContentBoundsAsync(displayVideoElement);
      coordinateMapping = this.computePreciseAlignment(
        videoElement.videoWidth || 1280,
        videoElement.videoHeight || 720,
        displayVideoElement.videoWidth,
        displayVideoElement.videoHeight,
        displayBounds
      );
    }

    const timelineStates: Record<Hand, HandTrackerState> = {
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

    let activeEventId: { left: string | null; right: string | null } = {
      left: null,
      right: null,
    };

    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
      const currentTime = frameIndex / fps;
      const displayTime = currentTime;
      videoElement.currentTime = currentTime;

      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          videoElement.removeEventListener('seeked', onSeeked);
          resolve();
        };
        videoElement.addEventListener('seeked', onSeeked);
      });

      if (ctx) {
        ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
      }

      const timestampMs = Math.round(currentTime * 1000);
      const gestureData = this.processVideoFrame(canvas, timestampMs, isMirrored, coordinateMapping);

      for (const hand of ['left', 'right'] as Hand[]) {
        const hData = gestureData[hand];
        const tState = timelineStates[hand];
        const wasPinching = tState.isPinching;
        const isPinching = hData.detected && hData.state === 'ACTIVE' && hData.activeFinger !== null;

        if (!wasPinching && isPinching && hData.activeFinger && hData.pinchCenter) {
          tState.isPinching = true;
          tState.activeFinger = hData.activeFinger;
          tState.triggerTimestamp = displayTime;

          const slot = slots.find((s) => s.hand === hand && s.finger === hData.activeFinger);
          const text = slot?.text || hData.activeFinger.toUpperCase();
          const newEventId = `ev-${hand}-${hData.activeFinger}-${timestampMs}`;
          activeEventId[hand] = newEventId;

          events.push({
            id: newEventId,
            hand,
            finger: hData.activeFinger,
            startTime: displayTime,
            releaseTime: displayTime,
            x: hData.pinchCenter.x,
            y: hData.pinchCenter.y,
            text,
          });
        } else if (wasPinching && !isPinching) {
          tState.isPinching = false;
          const evId = activeEventId[hand];
          if (evId) {
            const ev = events.find((e) => e.id === evId);
            if (ev) {
              ev.releaseTime = displayTime;
            }
            activeEventId[hand] = null;
          }
        }
      }

      frames.push({
        timestamp: displayTime,
        leftHand: gestureData.left,
        rightHand: gestureData.right,
      });

      const percent = Math.round(((frameIndex + 1) / totalFrames) * 100);
      if (frameIndex % 5 === 0 || frameIndex === totalFrames - 1) {
        onProgress(percent, `Analyzing video frame ${frameIndex + 1}/${totalFrames} (${percent}%)`);
      }
    }

    // If a pinch is still held on the tracking video's final frame, keep its
    // word active through the end of the display-master timeline.
    for (const hand of ['left', 'right'] as Hand[]) {
      const evId = activeEventId[hand];
      if (!evId) continue;
      const ev = events.find((candidate) => candidate.id === evId);
      if (ev) ev.releaseTime = analysisDuration;
    }

    return { events, frames, alignment: coordinateMapping };
  }

  public async analyzeVideo(
    videoElement: HTMLVideoElement,
    slots: ContentSlot[],
    isMirrored: boolean = false,
    onProgress?: (percent: number, status: string) => void,
    displayVideoElement?: HTMLVideoElement | null
  ): Promise<{ events: GestureEvent[]; frames: VideoAnalysisFrame[]; alignment?: CoordinateAlignment }> {
    return this.analyzeVideoFile(
      videoElement,
      onProgress || (() => {}),
      slots,
      isMirrored,
      displayVideoElement
    );
  }
}

export const gestureRecognizer = new GestureRecognizerManager();

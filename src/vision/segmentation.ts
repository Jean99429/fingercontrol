import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';

export class PersonSegmentationManager {
  private segmenter: ImageSegmenter | null = null;
  private isLoaded: boolean = false;
  private isInitializing: boolean = false;
  private offscreenCanvas: HTMLCanvasElement;
  private offscreenCtx: CanvasRenderingContext2D | null;

  constructor() {
    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenCtx = this.offscreenCanvas.getContext('2d', { willReadFrequently: true });
  }

  public async initialize(): Promise<boolean> {
    if (this.isLoaded) return true;
    if (this.isInitializing) return false;

    this.isInitializing = true;
    try {
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
      );

      this.segmenter = await ImageSegmenter.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        outputCategoryMask: true,
        outputConfidenceMasks: false,
      });

      this.isLoaded = true;
      this.isInitializing = false;
      return true;
    } catch (err) {
      console.warn('ImageSegmenter GPU load failed, trying CPU fallback:', err);
      try {
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
        );

        this.segmenter = await ImageSegmenter.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
            delegate: 'CPU',
          },
          runningMode: 'VIDEO',
          outputCategoryMask: true,
          outputConfidenceMasks: false,
        });

        this.isLoaded = true;
        this.isInitializing = false;
        return true;
      } catch (e2) {
        console.warn('ImageSegmenter unavailable; will use luminance keying fallback:', e2);
        this.isInitializing = false;
        return false;
      }
    }
  }

  public isReady(): boolean {
    return this.isLoaded && this.segmenter !== null;
  }

  // Generate person mask as an ImageData / Canvas (mirrored if needed)
  public segmentVideo(
    video: HTMLVideoElement,
    timestamp: number,
    targetWidth: number,
    targetHeight: number
  ): ImageData | null {
    if (video.readyState < 2) return null;

    if (this.offscreenCanvas.width !== targetWidth || this.offscreenCanvas.height !== targetHeight) {
      this.offscreenCanvas.width = targetWidth;
      this.offscreenCanvas.height = targetHeight;
    }

    if (!this.offscreenCtx) return null;

    if (this.segmenter) {
      try {
        let resultMask: ImageData | null = null;
        this.segmenter.segmentForVideo(video, timestamp, (result) => {
          if (result.categoryMask) {
            const maskData = result.categoryMask.getAsUint8Array();
            const width = result.categoryMask.width;
            const height = result.categoryMask.height;

            const imgData = this.offscreenCtx!.createImageData(width, height);
            const data = imgData.data;

            for (let i = 0; i < maskData.length; i++) {
              const isPerson = maskData[i] > 0;
              const idx = i * 4;
              data[idx] = 255;
              data[idx + 1] = 255;
              data[idx + 2] = 255;
              data[idx + 3] = isPerson ? 255 : 0;
            }
            resultMask = imgData;
          }
        });
        if (resultMask) return resultMask;
      } catch (e) {
        // Continue to fallback
      }
    }

    // Adaptive luminance-chroma threshold fallback if ML segmenter is not loaded
    this.offscreenCtx.drawImage(video, 0, 0, targetWidth, targetHeight);
    const frame = this.offscreenCtx.getImageData(0, 0, targetWidth, targetHeight);
    const d = frame.data;
    const maskImg = this.offscreenCtx.createImageData(targetWidth, targetHeight);
    const md = maskImg.data;

    for (let i = 0; i < d.length; i += 4) {
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const isForeground = lum > 25; // Soft foreground cutoff
      const alpha = isForeground ? Math.min(255, lum * 2) : 0;
      md[i] = 255;
      md[i + 1] = 255;
      md[i + 2] = 255;
      md[i + 3] = alpha;
    }

    return maskImg;
  }
}

export const personSegmentation = new PersonSegmentationManager();

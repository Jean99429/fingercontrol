import { EffectId, FingertipPoint, HandGestureData } from '../types/config';

interface Particle {
  x: number;
  y: number;
  originX: number;
  originY: number;
  vx: number;
  vy: number;
  size: number;
  brightness: number;
  alpha: number;
}

interface GlyphParticle {
  char: string;
  x: number;
  y: number;
  originX: number;
  originY: number;
  vx: number;
  vy: number;
  size: number;
  brightness: number;
  alpha: number;
}

export class EffectEngine {
  // Particle Disassembly state
  private particles: Particle[] = [];
  private particleGridInitialized = false;

  // Glyph Dissolve state
  private glyphParticles: GlyphParticle[] = [];
  private glyphGridInitialized = false;
  private readonly GLYPH_CHARS = '0123456789ABCDEF$#@%&*+-/アイウエオカキクケコサシスセソタチツテト';

  // RGB Time Echo buffer
  private echoBuffer: HTMLCanvasElement[] = [];
  private readonly MAX_ECHO_FRAMES = 16;
  private echoBufferIdx = 0;

  // Working offscreen canvases for performance
  private workCanvas: HTMLCanvasElement;
  private workCtx: CanvasRenderingContext2D | null;
  private maskCanvas: HTMLCanvasElement;
  private maskCtx: CanvasRenderingContext2D | null;

  // Bayer 8x8 matrix for dithering
  private readonly bayer8x8 = [
    [0, 32, 8, 40, 2, 34, 10, 42],
    [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44, 4, 36, 14, 46, 6, 38],
    [60, 28, 52, 20, 62, 30, 54, 22],
    [3, 35, 11, 43, 1, 33, 9, 41],
    [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47, 7, 39, 13, 45, 5, 37],
    [63, 31, 55, 23, 61, 29, 53, 21],
  ];

  // Active effect transition states (for smooth recovery curves)
  private effectIntensity: Record<EffectId, number> = {
    'particle-disassembly': 0,
    'ascii-dither': 0,
    'rgb-time-echo': 0,
    'glyph-dissolve': 0,
    'dither': 0,
    'data-slice': 0,
    'pixel-sort': 0,
    'dot-matrix': 0,
    'negative-threshold': 0,
    'optical-distortion': 0,
  };

  constructor() {
    this.workCanvas = document.createElement('canvas');
    this.workCtx = this.workCanvas.getContext('2d', { willReadFrequently: true });
    this.maskCanvas = document.createElement('canvas');
    this.maskCtx = this.maskCanvas.getContext('2d', { willReadFrequently: true });
  }

  public reset(): void {
    this.particleGridInitialized = false;
    this.glyphGridInitialized = false;
    this.particles = [];
    this.glyphParticles = [];
    this.echoBuffer = [];
    for (const key of Object.keys(this.effectIntensity) as EffectId[]) {
      this.effectIntensity[key] = 0;
    }
  }

  private initParticleGrid(width: number, height: number, step: number = 8) {
    this.particles = [];
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        this.particles.push({
          x,
          y,
          originX: x,
          originY: y,
          vx: 0,
          vy: 0,
          size: Math.random() * 2.2 + 1.2,
          brightness: 0.8,
          alpha: 1,
        });
      }
    }
    this.particleGridInitialized = true;
  }

  private initGlyphGrid(width: number, height: number, step: number = 14) {
    this.glyphParticles = [];
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const char = this.GLYPH_CHARS[Math.floor(Math.random() * this.GLYPH_CHARS.length)];
        this.glyphParticles.push({
          char,
          x,
          y,
          originX: x,
          originY: y,
          vx: 0,
          vy: 0,
          size: 11,
          brightness: 0.8,
          alpha: 1,
        });
      }
    }
    this.glyphGridInitialized = true;
  }

  private drawStudioFallback(ctx: CanvasRenderingContext2D, width: number, height: number, now: number) {
    const t = now * 0.0015;
    const grad = ctx.createRadialGradient(width / 2, height / 2, 50, width / 2, height / 2, width / 1.2);
    grad.addColorStop(0, '#1c1c1f');
    grad.addColorStop(1, '#08080a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // Subtle dark studio geometry & performer silhouette
    ctx.fillStyle = '#232328';
    const cx = width / 2 + Math.sin(t * 0.7) * 20;
    const cy = height / 2 + Math.cos(t * 0.5) * 10;

    // Torso
    ctx.beginPath();
    ctx.ellipse(cx, cy + 180, 160, 220, 0, 0, Math.PI * 2);
    ctx.fill();

    // Head
    ctx.fillStyle = '#3a3a42';
    ctx.beginPath();
    ctx.ellipse(cx, cy - 20, 85, 110, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  public updateAndRender(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    video: HTMLVideoElement,
    activeEffectId: EffectId | null,
    isEffectActive: boolean,
    handData: HandGestureData,
    now: number
  ): void {
    if (this.workCanvas.width !== width || this.workCanvas.height !== height) {
      this.workCanvas.width = width;
      this.workCanvas.height = height;
      this.maskCanvas.width = width;
      this.maskCtx = this.maskCanvas.getContext('2d', { willReadFrequently: true });
      this.particleGridInitialized = false;
      this.glyphGridInitialized = false;
    }

    if (!this.workCtx) return;

    // Update smooth recovery intensity curves for all effects
    const LERP_UP = 0.14;
    const LERP_DOWN = 0.06;

    for (const id of Object.keys(this.effectIntensity) as EffectId[]) {
      const target = (activeEffectId === id && isEffectActive) ? 1.0 : 0.0;
      const rate = target > this.effectIntensity[id] ? LERP_UP : LERP_DOWN;
      this.effectIntensity[id] += (target - this.effectIntensity[id]) * rate;
      if (this.effectIntensity[id] < 0.001) this.effectIntensity[id] = 0;
    }

    // Draw base mirrored video to working context
    this.workCtx.save();
    if (video && video.readyState >= 2 && video.videoWidth > 0) {
      this.workCtx.scale(-1, 1);
      this.workCtx.drawImage(video, -width, 0, width, height);
    } else {
      this.drawStudioFallback(this.workCtx, width, height, now);
    }
    this.workCtx.restore();

    // Maintain temporal frame buffer for RGB Time Echo
    if (this.echoBuffer.length < this.MAX_ECHO_FRAMES) {
      const buf = document.createElement('canvas');
      buf.width = width;
      buf.height = height;
      this.echoBuffer.push(buf);
    }
    const curEchoCanvas = this.echoBuffer[this.echoBufferIdx % this.MAX_ECHO_FRAMES];
    const curEchoCtx = curEchoCanvas.getContext('2d');
    if (curEchoCtx) {
      curEchoCtx.drawImage(this.workCanvas, 0, 0);
    }
    this.echoBufferIdx++;

    // Check which effect is active or recovering (> 0 intensity)
    let renderedAnyEffect = false;
    for (const [idStr, intensity] of Object.entries(this.effectIntensity)) {
      const id = idStr as EffectId;
      if (intensity > 0.01) {
        this.renderSpecificEffect(ctx, id, intensity, width, height, handData, now);
        renderedAnyEffect = true;
        break; // Only one active effect at a time
      }
    }

    // If no effect is active, render default monochrome performer
    if (!renderedAnyEffect) {
      this.renderMonochromeCamera(ctx, width, height);
    }
  }

  // 0. Base Monochrome Performer Grade
  private renderMonochromeCamera(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.save();
    ctx.filter = 'grayscale(100%) contrast(125%) brightness(95%)';
    ctx.drawImage(this.workCanvas, 0, 0, width, height);
    ctx.restore();
  }

  // Route to specific effect
  private renderSpecificEffect(
    ctx: CanvasRenderingContext2D,
    effectId: EffectId,
    intensity: number,
    width: number,
    height: number,
    handData: HandGestureData,
    now: number
  ): void {
    switch (effectId) {
      case 'particle-disassembly':
        this.renderParticleDisassembly(ctx, intensity, width, height, handData, now);
        break;
      case 'ascii-dither':
        this.renderAsciiDither(ctx, intensity, width, height, handData, now);
        break;
      case 'rgb-time-echo':
        this.renderRgbTimeEcho(ctx, intensity, width, height, handData, now);
        break;
      case 'glyph-dissolve':
        this.renderGlyphDissolve(ctx, intensity, width, height, handData, now);
        break;
      case 'dither':
        this.renderBayerDither(ctx, intensity, width, height, handData, now);
        break;
      case 'data-slice':
        this.renderDataSlice(ctx, intensity, width, height, handData, now);
        break;
      case 'pixel-sort':
        this.renderPixelSort(ctx, intensity, width, height, handData, now);
        break;
      case 'dot-matrix':
        this.renderDotMatrix(ctx, intensity, width, height, handData, now);
        break;
      case 'negative-threshold':
        this.renderNegativeThreshold(ctx, intensity, width, height, handData, now);
        break;
      case 'optical-distortion':
        this.renderOpticalDistortion(ctx, intensity, width, height, handData, now);
        break;
      default:
        this.renderMonochromeCamera(ctx, width, height);
    }
  }

  // 1. PARTICLE DISASSEMBLY
  private renderParticleDisassembly(
    ctx: CanvasRenderingContext2D,
    intensity: number,
    width: number,
    height: number,
    handData: HandGestureData,
    now: number
  ): void {
    if (!this.particleGridInitialized || this.particles.length === 0) {
      this.initParticleGrid(width, height, 7);
    }

    const pinch = handData.pinchCenter || { x: 0.5, y: 0.5 };
    const pinchX = pinch.x * width;
    const pinchY = pinch.y * height;
    const dragX = handData.dragOffset.dx * width * 1.5;
    const dragY = handData.dragOffset.dy * height * 1.5;

    // First draw base camera with inverse opacity
    ctx.save();
    ctx.filter = 'grayscale(100%) contrast(120%)';
    ctx.globalAlpha = Math.max(0, 1 - intensity * 0.85);
    ctx.drawImage(this.workCanvas, 0, 0, width, height);
    ctx.restore();

    // Sample video pixels for particle brightness
    const sampleCanvas = this.workCanvas;
    const sampleCtx = this.workCtx!;
    let imgData: ImageData | null = null;
    try {
      imgData = sampleCtx.getImageData(0, 0, width, height);
    } catch {
      // ignore
    }
    const d = imgData?.data;

    ctx.fillStyle = '#f0f0f0';
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];

      // Sample luminance from origin
      if (d) {
        const px = Math.floor(p.originX);
        const py = Math.floor(p.originY);
        const idx = (py * width + px) * 4;
        if (idx >= 0 && idx < d.length) {
          const r = d[idx];
          const g = d[idx + 1];
          const b = d[idx + 2];
          p.brightness = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        }
      }

      if (p.brightness < 0.12) continue; // Skip dark background

      // Physics: distance from pinch point
      const dx = p.originX - pinchX;
      const dy = p.originY - pinchY;
      const dist = Math.hypot(dx, dy);

      if (intensity > 0.05) {
        // Disperse outward from pinch origin modulated by drag
        const force = Math.max(0, 1 - dist / (width * 0.65)) * intensity;
        const angle = Math.atan2(dy, dx) + Math.sin(now * 0.003 + dist * 0.01) * 0.4;
        const targetX = p.originX + Math.cos(angle) * force * 180 + dragX * force * 0.8;
        const targetY = p.originY + Math.sin(angle) * force * 180 + dragY * force * 0.8;

        p.vx += (targetX - p.x) * 0.12;
        p.vy += (targetY - p.y) * 0.12;
      } else {
        // Return to origin with spring
        p.vx += (p.originX - p.x) * 0.18;
        p.vy += (p.originY - p.y) * 0.18;
      }

      p.vx *= 0.78;
      p.vy *= 0.78;
      p.x += p.vx;
      p.y += p.vy;

      const size = Math.max(1, p.size * p.brightness * (1 + intensity * 0.5));
      const alpha = Math.min(1, p.brightness * 1.3 * intensity);

      ctx.fillStyle = `rgba(235, 235, 240, ${alpha})`;
      ctx.fillRect(p.x, p.y, size, size);
    }
  }

  // 2. ASCII / DITHER
  private renderAsciiDither(
    ctx: CanvasRenderingContext2D,
    intensity: number,
    width: number,
    height: number,
    handData: HandGestureData,
    _now: number
  ): void {
    // Underlay monochrome video
    ctx.save();
    ctx.filter = 'grayscale(100%) contrast(140%)';
    ctx.globalAlpha = 1 - intensity * 0.7;
    ctx.drawImage(this.workCanvas, 0, 0, width, height);
    ctx.restore();

    // Hand vertical drag changes ASCII density
    const dragY = handData.dragOffset.dy;
    const baseStep = Math.max(6, Math.min(16, Math.floor(10 + dragY * 12)));
    const asciiRamp = '@%#*+=-:. ';

    ctx.save();
    ctx.font = `${baseStep}px 'JetBrains Mono', monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    let imgData: ImageData | null = null;
    try {
      imgData = this.workCtx!.getImageData(0, 0, width, height);
    } catch {
      // ignore
    }

    if (imgData) {
      const d = imgData.data;
      for (let y = baseStep / 2; y < height; y += baseStep) {
        for (let x = baseStep / 2; x < width; x += baseStep) {
          const idx = (Math.floor(y) * width + Math.floor(x)) * 4;
          const r = d[idx];
          const g = d[idx + 1];
          const b = d[idx + 2];
          const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

          if (lum < 0.1) continue;

          const charIdx = Math.floor((1 - lum) * (asciiRamp.length - 1));
          const char = asciiRamp[Math.max(0, Math.min(asciiRamp.length - 1, charIdx))];

          const alpha = lum * intensity;
          ctx.fillStyle = `rgba(240, 240, 240, ${alpha})`;
          ctx.fillText(char, x, y);
        }
      }
    }
    ctx.restore();
  }

  // 3. RGB TIME ECHO
  private renderRgbTimeEcho(
    ctx: CanvasRenderingContext2D,
    intensity: number,
    width: number,
    height: number,
    handData: HandGestureData,
    _now: number
  ): void {
    const shiftX = (handData.dragOffset.dx * 120 + 20) * intensity;
    const shiftY = (handData.dragOffset.dy * 80 + 10) * intensity;

    ctx.save();
    ctx.fillStyle = '#080808';
    ctx.fillRect(0, 0, width, height);

    // Draw previous echo frames with motion decay
    const numTrails = Math.min(this.echoBuffer.length, 6);
    for (let t = numTrails - 1; t >= 0; t--) {
      const idx = (this.echoBufferIdx - 1 - t * 2 + this.MAX_ECHO_FRAMES) % this.MAX_ECHO_FRAMES;
      const trailCanvas = this.echoBuffer[idx];
      if (trailCanvas) {
        ctx.globalAlpha = (1 - t / numTrails) * 0.35 * intensity;
        ctx.drawImage(trailCanvas, -shiftX * (t / numTrails), -shiftY * (t / numTrails));
      }
    }

    // Chromatic split pass: Red Channel, Green Channel, Blue Channel
    ctx.globalCompositeOperation = 'screen';

    // Red
    ctx.save();
    ctx.filter = 'grayscale(100%)';
    ctx.globalAlpha = 0.9;
    ctx.drawImage(this.workCanvas, -shiftX, -shiftY, width, height);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = '#ff2222';
    ctx.fillRect(0, 0, width, height);
    ctx.restore();

    // Green
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.filter = 'grayscale(100%)';
    ctx.globalAlpha = 0.9;
    ctx.drawImage(this.workCanvas, 0, 0, width, height);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = '#22ff66';
    ctx.fillRect(0, 0, width, height);
    ctx.restore();

    // Blue
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.filter = 'grayscale(100%)';
    ctx.globalAlpha = 0.9;
    ctx.drawImage(this.workCanvas, shiftX, shiftY, width, height);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = '#2266ff';
    ctx.fillRect(0, 0, width, height);
    ctx.restore();

    ctx.restore();
  }

  // 4. GLYPH DISSOLVE
  private renderGlyphDissolve(
    ctx: CanvasRenderingContext2D,
    intensity: number,
    width: number,
    height: number,
    handData: HandGestureData,
    now: number
  ): void {
    if (!this.glyphGridInitialized || this.glyphParticles.length === 0) {
      this.initGlyphGrid(width, height, 13);
    }

    const pinch = handData.pinchCenter || { x: 0.5, y: 0.5 };
    const pinchX = pinch.x * width;
    const pinchY = pinch.y * height;
    const dragX = handData.dragOffset.dx * width;
    const dragY = handData.dragOffset.dy * height;

    // Background base fade
    ctx.save();
    ctx.filter = 'grayscale(100%) contrast(120%)';
    ctx.globalAlpha = Math.max(0, 1 - intensity * 0.8);
    ctx.drawImage(this.workCanvas, 0, 0, width, height);
    ctx.restore();

    let imgData: ImageData | null = null;
    try {
      imgData = this.workCtx!.getImageData(0, 0, width, height);
    } catch {
      // ignore
    }
    const d = imgData?.data;

    ctx.save();
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let i = 0; i < this.glyphParticles.length; i++) {
      const g = this.glyphParticles[i];

      if (d) {
        const px = Math.floor(g.originX);
        const py = Math.floor(g.originY);
        const idx = (py * width + px) * 4;
        if (idx >= 0 && idx < d.length) {
          const lum = (0.299 * d[idx] + 0.587 * d[idx + 1] + 0.114 * d[idx + 2]) / 255;
          g.brightness = lum;
        }
      }

      if (g.brightness < 0.14) continue;

      const dx = g.originX - pinchX;
      const dy = g.originY - pinchY;
      const dist = Math.hypot(dx, dy);

      if (intensity > 0.05) {
        const force = Math.max(0, 1 - dist / (width * 0.7)) * intensity;
        const angle = Math.atan2(dy, dx) + Math.cos(now * 0.002 + i) * 0.5;
        const targetX = g.originX + Math.cos(angle) * force * 150 + dragX * force;
        const targetY = g.originY + Math.sin(angle) * force * 150 + dragY * force + force * 20; // gravity

        g.vx += (targetX - g.x) * 0.14;
        g.vy += (targetY - g.y) * 0.14;
      } else {
        g.vx += (g.originX - g.x) * 0.16;
        g.vy += (g.originY - g.y) * 0.16;
      }

      g.vx *= 0.76;
      g.vy *= 0.76;
      g.x += g.vx;
      g.y += g.vy;

      const alpha = g.brightness * intensity;
      ctx.fillStyle = `rgba(240, 240, 245, ${alpha})`;
      ctx.fillText(g.char, g.x, g.y);
    }
    ctx.restore();
  }

  // 5. DITHER (BAYER 8X8)
  private renderBayerDither(
    ctx: CanvasRenderingContext2D,
    intensity: number,
    width: number,
    height: number,
    _handData: HandGestureData,
    _now: number
  ): void {
    let imgData: ImageData | null = null;
    try {
      imgData = this.workCtx!.getImageData(0, 0, width, height);
    } catch {
      return;
    }
    const d = imgData.data;

    // Create dither output
    const output = ctx.createImageData(width, height);
    const out = output.data;

    for (let y = 0; y < height; y++) {
      const by = y % 8;
      for (let x = 0; x < width; x++) {
        const bx = x % 8;
        const idx = (y * width + x) * 4;
        const lum = (0.299 * d[idx] + 0.587 * d[idx + 1] + 0.114 * d[idx + 2]);
        const threshold = (this.bayer8x8[by][bx] / 64) * 255;
        const isWhite = lum > threshold;

        const val = isWhite ? 245 : 8;
        out[idx] = val;
        out[idx + 1] = val;
        out[idx + 2] = val;
        out[idx + 3] = Math.floor(255 * intensity);
      }
    }

    // Blend with base camera
    this.renderMonochromeCamera(ctx, width, height);
    ctx.save();
    ctx.globalAlpha = intensity;
    ctx.putImageData(output, 0, 0);
    ctx.restore();
  }

  // 6. DATA SLICE
  private renderDataSlice(
    ctx: CanvasRenderingContext2D,
    intensity: number,
    width: number,
    height: number,
    handData: HandGestureData,
    now: number
  ): void {
    this.renderMonochromeCamera(ctx, width, height);

    const pinch = handData.pinchCenter || { x: 0.5, y: 0.5 };
    const dragX = handData.dragOffset.dx * width;
    const slices = 18;
    const sliceHeight = height / slices;

    ctx.save();
    for (let i = 0; i < slices; i++) {
      const sy = i * sliceHeight;
      const distFromPinchY = Math.abs((sy + sliceHeight / 2) - pinch.y * height);
      if (distFromPinchY < height * 0.45) {
        const jitter = Math.sin(now * 0.01 + i * 2.5) * 40 * intensity + dragX * 0.4;
        ctx.drawImage(
          this.workCanvas,
          0, sy, width, sliceHeight,
          jitter, sy, width, sliceHeight
        );
      }
    }
    ctx.restore();
  }

  // 7. PIXEL SORT
  private renderPixelSort(
    ctx: CanvasRenderingContext2D,
    intensity: number,
    width: number,
    height: number,
    handData: HandGestureData,
    _now: number
  ): void {
    this.renderMonochromeCamera(ctx, width, height);

    let imgData: ImageData | null = null;
    try {
      imgData = this.workCtx!.getImageData(0, 0, width, height);
    } catch {
      return;
    }

    const d = imgData.data;
    const streakLength = Math.floor((30 + Math.abs(handData.dragOffset.dx) * 150) * intensity);

    ctx.save();
    ctx.fillStyle = 'rgba(240, 240, 240, 0.4)';

    for (let y = 0; y < height; y += 4) {
      for (let x = 0; x < width; x += 4) {
        const idx = (y * width + x) * 4;
        const lum = (0.299 * d[idx] + 0.587 * d[idx + 1] + 0.114 * d[idx + 2]) / 255;
        if (lum > 0.65) {
          ctx.fillRect(x, y, streakLength * lum, 2);
        }
      }
    }
    ctx.restore();
  }

  // 8. DOT MATRIX
  private renderDotMatrix(
    ctx: CanvasRenderingContext2D,
    intensity: number,
    width: number,
    height: number,
    _handData: HandGestureData,
    _now: number
  ): void {
    ctx.fillStyle = '#080808';
    ctx.fillRect(0, 0, width, height);

    let imgData: ImageData | null = null;
    try {
      imgData = this.workCtx!.getImageData(0, 0, width, height);
    } catch {
      return;
    }

    const d = imgData.data;
    const step = 8;
    const maxRadius = (step / 2) * 1.2;

    ctx.save();
    ctx.fillStyle = '#e8e8e8';

    for (let y = step / 2; y < height; y += step) {
      for (let x = step / 2; x < width; x += step) {
        const idx = (Math.floor(y) * width + Math.floor(x)) * 4;
        const lum = (0.299 * d[idx] + 0.587 * d[idx + 1] + 0.114 * d[idx + 2]) / 255;
        if (lum < 0.08) continue;

        const radius = lum * maxRadius * intensity;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // 9. NEGATIVE THRESHOLD
  private renderNegativeThreshold(
    ctx: CanvasRenderingContext2D,
    intensity: number,
    width: number,
    height: number,
    handData: HandGestureData,
    now: number
  ): void {
    let imgData: ImageData | null = null;
    try {
      imgData = this.workCtx!.getImageData(0, 0, width, height);
    } catch {
      return;
    }

    const d = imgData.data;
    const scanY = (now * 0.15) % height;
    const dragThreshold = Math.max(0.2, Math.min(0.8, 0.5 + handData.dragOffset.dy));

    const out = ctx.createImageData(width, height);
    const od = out.data;

    for (let y = 0; y < height; y++) {
      const isScanLine = Math.abs(y - scanY) < 3;
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const lum = (0.299 * d[idx] + 0.587 * d[idx + 1] + 0.114 * d[idx + 2]) / 255;

        let val = lum > dragThreshold ? (1 - lum) * 255 : lum * 255;
        if (isScanLine) val = 255;

        od[idx] = val;
        od[idx + 1] = val;
        od[idx + 2] = val;
        od[idx + 3] = 255;
      }
    }

    this.renderMonochromeCamera(ctx, width, height);
    ctx.save();
    ctx.globalAlpha = intensity;
    ctx.putImageData(out, 0, 0);
    ctx.restore();
  }

  // 10. OPTICAL DISTORTION
  private renderOpticalDistortion(
    ctx: CanvasRenderingContext2D,
    intensity: number,
    width: number,
    height: number,
    handData: HandGestureData,
    _now: number
  ): void {
    this.renderMonochromeCamera(ctx, width, height);

    const pinch = handData.pinchCenter || { x: 0.5, y: 0.5 };
    const px = pinch.x * width;
    const py = pinch.y * height;
    const radius = 180 * intensity;

    ctx.save();
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.clip();

    // Magnify and warp
    ctx.save();
    ctx.translate(px, py);
    ctx.scale(1.45, 1.45);
    ctx.translate(-px, -py);
    ctx.drawImage(this.workCanvas, 0, 0, width, height);
    ctx.restore();

    // Red chromatic fringe circle
    ctx.strokeStyle = 'rgba(255, 51, 51, 0.7)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }
}

export const effectEngine = new EffectEngine();

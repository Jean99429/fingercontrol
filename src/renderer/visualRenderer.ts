import { Hand, HandGestureData } from '../types/config';

export interface FloatingTextItem {
  id: string;
  hand: Hand;
  text: string;
  x: number; // in canvas px
  y: number; // in canvas px
  targetX: number; // in canvas px
  targetY: number; // in canvas px
  vx: number;
  vy: number;
  alpha: number;
  active: boolean;
  spawnTime: number;
  releaseTime: number;
}

interface SmoothBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  initialized: boolean;
}

export class VisualRenderer {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  // Active floating text items for both hands
  private floatingTexts: Map<string, FloatingTextItem> = new Map();

  // Smoothed bounding box history for L and R coordinate frames
  private smoothedBoxes: Record<Hand, SmoothBox> = {
    left: { minX: 0, minY: 0, maxX: 0, maxY: 0, initialized: false },
    right: { minX: 0, minY: 0, maxX: 0, maxY: 0, initialized: false },
  };

  public init(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { willReadFrequently: true });
  }

  public reset(): void {
    this.floatingTexts.clear();
    this.smoothedBoxes.left.initialized = false;
    this.smoothedBoxes.right.initialized = false;
  }

  public spawnFloatingText(slotId: string, hand: Hand, text: string, xNorm: number, yNorm: number): void {
    if (!this.canvas) return;
    const px = xNorm * this.canvas.width;
    const py = yNorm * this.canvas.height;

    const existing = this.floatingTexts.get(slotId);
    if (existing) {
      existing.text = text;
      existing.targetX = px;
      existing.targetY = py;
      existing.active = true;
      existing.releaseTime = 0;
      existing.alpha = 1.0;
    } else {
      this.floatingTexts.set(slotId, {
        id: slotId,
        hand,
        text,
        x: px,
        y: py,
        targetX: px,
        targetY: py,
        vx: 0,
        vy: 0,
        alpha: 1.0,
        active: true,
        spawnTime: performance.now(),
        releaseTime: 0,
      });
    }
  }

  public updateFloatingTextTarget(slotId: string, xNorm: number, yNorm: number): void {
    if (!this.canvas) return;
    const item = this.floatingTexts.get(slotId);
    if (item && item.active) {
      item.targetX = xNorm * this.canvas.width;
      item.targetY = yNorm * this.canvas.height;
    }
  }

  public releaseFloatingText(slotId: string): void {
    const item = this.floatingTexts.get(slotId);
    if (item) {
      item.active = false;
      item.releaseTime = performance.now();
    }
  }

  /**
   * Render complete frame:
   * 1. Draw raw video image (unmodified RGB, mirrored if enabled)
   * 2. Draw coordinate frames and #FF0000 fingertip dots
   * 3. Draw active/fading floating text words
   */
  public renderFrame(
    video: HTMLVideoElement | CanvasImageSource,
    gestureData: { left: HandGestureData; right: HandGestureData },
    trackingVisible: boolean = true,
    now: number = performance.now(),
    isMirrored: boolean = false
  ): void {
    if (!this.canvas || !this.ctx) return;

    const width = this.canvas.width;
    const height = this.canvas.height;
    const ctx = this.ctx;

    // 1. Draw the clean, raw video frame (with mirroring if configured)
    try {
      if (isMirrored) {
        ctx.save();
        ctx.translate(width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, 0, 0, width, height);
        ctx.restore();
      } else {
        ctx.drawImage(video, 0, 0, width, height);
      }
    } catch {
      ctx.fillStyle = '#080808';
      ctx.fillRect(0, 0, width, height);
    }

    // 2. Draw Hand Coordinate Frames & Fingertip Dots
    if (trackingVisible) {
      this.renderTrackingLayer(ctx, width, height, gestureData);
    }

    // 3. Draw Floating Text Typography Layer
    this.renderFloatingTextLayer(ctx, width, height, now);
  }

  /**
   * SPEC Section 8: Fingertip dots & Coordinate Frames for both hands
   */
  private renderTrackingLayer(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    gestureData: { left: HandGestureData; right: HandGestureData }
  ): void {
    // Base scale relative to 1080p (SPEC Section 8.1)
    const refDim = Math.min(width, height);
    const scale = Math.max(0.6, refDim / 1080);

    const normalRadius = 7 * scale;
    const approachingRadius = 9 * scale;
    const activeRadius = 12 * scale;
    const RED = '#FF0000';

    for (const handKey of ['left', 'right'] as const) {
      const hand = gestureData[handKey];
      if (!hand.detected) {
        this.smoothedBoxes[handKey].initialized = false;
        continue;
      }

      const ft = hand.fingertips;

      // 1. Coordinate Frame (SPEC Section 8.2)
      if (hand.boundingBox) {
        const rawBox = hand.boundingBox;
        // Expand bounding box by ~18%
        const boxW = rawBox.maxX - rawBox.minX;
        const boxH = rawBox.maxY - rawBox.minY;
        const padX = Math.max(boxW * 0.18, 0.04);
        const padY = Math.max(boxH * 0.18, 0.04);

        const targetMinX = Math.max(0, rawBox.minX - padX);
        const targetMinY = Math.max(0, rawBox.minY - padY);
        const targetMaxX = Math.min(1, rawBox.maxX + padX);
        const targetMaxY = Math.min(1, rawBox.maxY + padY);

        const smooth = this.smoothedBoxes[handKey];
        if (!smooth.initialized) {
          smooth.minX = targetMinX;
          smooth.minY = targetMinY;
          smooth.maxX = targetMaxX;
          smooth.maxY = targetMaxY;
          smooth.initialized = true;
        } else {
          // Lerp for smooth box motion
          const lerpFactor = 0.35;
          smooth.minX += (targetMinX - smooth.minX) * lerpFactor;
          smooth.minY += (targetMinY - smooth.minY) * lerpFactor;
          smooth.maxX += (targetMaxX - smooth.maxX) * lerpFactor;
          smooth.maxY += (targetMaxY - smooth.maxY) * lerpFactor;
        }

        const x1 = smooth.minX * width;
        const y1 = smooth.minY * height;
        const x2 = smooth.maxX * width;
        const y2 = smooth.maxY * height;
        const bw = x2 - x1;
        const bh = y2 - y1;

        // Draw 4 corner brackets
        const cornerLen = Math.min(bw * 0.22, bh * 0.22, 28 * scale);
        ctx.save();
        ctx.strokeStyle = RED;
        ctx.lineWidth = Math.max(2, 2.5 * scale);
        ctx.lineCap = 'square';
        ctx.lineJoin = 'miter';

        // Top-Left corner
        ctx.beginPath();
        ctx.moveTo(x1, y1 + cornerLen);
        ctx.lineTo(x1, y1);
        ctx.lineTo(x1 + cornerLen, y1);
        ctx.stroke();

        // Top-Right corner
        ctx.beginPath();
        ctx.moveTo(x2 - cornerLen, y1);
        ctx.lineTo(x2, y1);
        ctx.lineTo(x2, y1 + cornerLen);
        ctx.stroke();

        // Bottom-Left corner
        ctx.beginPath();
        ctx.moveTo(x1, y2 - cornerLen);
        ctx.lineTo(x1, y2);
        ctx.lineTo(x1 + cornerLen, y2);
        ctx.stroke();

        // Bottom-Right corner
        ctx.beginPath();
        ctx.moveTo(x2 - cornerLen, y2);
        ctx.lineTo(x2, y2);
        ctx.lineTo(x2, y2 - cornerLen);
        ctx.stroke();

        // Hand Label: L or R
        ctx.font = `700 ${Math.round(13 * scale)}px 'JetBrains Mono', monospace`;
        ctx.fillStyle = RED;
        ctx.textBaseline = 'top';
        const labelText = handKey === 'left' ? 'L' : 'R';
        ctx.fillText(labelText, x1 + 6 * scale, y1 + 6 * scale);

        // Crosshair at pinch center (or hand center if not pinching)
        const crossCenter = hand.pinchCenter || { x: (smooth.minX + smooth.maxX) / 2, y: (smooth.minY + smooth.maxY) / 2 };
        const cx = crossCenter.x * width;
        const cy = crossCenter.y * height;
        const crossSize = 10 * scale;

        ctx.strokeStyle = 'rgba(255, 0, 0, 0.75)';
        ctx.lineWidth = Math.max(1.5, 1.8 * scale);
        ctx.beginPath();
        ctx.moveTo(cx - crossSize, cy);
        ctx.lineTo(cx + crossSize, cy);
        ctx.moveTo(cx, cy - crossSize);
        ctx.lineTo(cx, cy + crossSize);
        ctx.stroke();

        ctx.restore();
      }

      // 2. Proximity line when approaching, arming, or active
      if (hand.state === 'APPROACHING' || hand.state === 'ARMING' || hand.state === 'ACTIVE') {
        const targetTip = hand.activeFinger ? ft[hand.activeFinger] : null;
        if (targetTip) {
          const thumbX = ft.thumb.x * width;
          const thumbY = ft.thumb.y * height;
          const targetX = targetTip.x * width;
          const targetY = targetTip.y * height;

          ctx.save();
          ctx.beginPath();
          ctx.moveTo(thumbX, thumbY);
          ctx.lineTo(targetX, targetY);
          ctx.strokeStyle = RED;
          ctx.lineWidth = hand.state === 'ACTIVE' ? 3 * scale : 1.8 * scale;
          if (hand.state === 'ARMING') {
            ctx.setLineDash([4 * scale, 3 * scale]);
          }
          ctx.stroke();
          ctx.restore();
        }
      }

      // 3. Fingertip dots: 5 tips (thumb, index, middle, ring, pinky)
      const tips = [
        { name: 'thumb', pt: ft.thumb },
        { name: 'index', pt: ft.index },
        { name: 'middle', pt: ft.middle },
        { name: 'ring', pt: ft.ring },
        { name: 'pinky', pt: ft.pinky },
      ];

      for (const tip of tips) {
        const px = tip.pt.x * width;
        const py = tip.pt.y * height;

        let r = normalRadius;
        const isTarget = hand.activeFinger === tip.name || tip.name === 'thumb';

        if (hand.state === 'ACTIVE' && isTarget) {
          r = activeRadius;
        } else if ((hand.state === 'ARMING' || hand.state === 'APPROACHING') && isTarget) {
          r = approachingRadius;
        }

        ctx.save();
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fillStyle = RED;
        ctx.fill();
        ctx.restore();
      }
    }
  }

  /**
   * SPEC Section 9: Floating text typography layer
   */
  private renderFloatingTextLayer(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    now: number
  ): void {
    const toDelete: string[] = [];
    const scale = Math.max(0.6, Math.min(width, height) / 1080);

    this.floatingTexts.forEach((item, key) => {
      // Spring follow
      const dx = item.targetX - item.x;
      const dy = item.targetY - item.y;
      item.vx += dx * 0.22;
      item.vy += dy * 0.22;
      item.vx *= 0.62;
      item.vy *= 0.62;
      item.x += item.vx;
      item.y += item.vy;

      if (!item.active) {
        const elapsedSinceRelease = now - item.releaseTime;
        const FADE_DURATION = 550; // ms
        item.alpha = Math.max(0, 1 - elapsedSinceRelease / FADE_DURATION);
        if (item.alpha <= 0) {
          toDelete.push(key);
          return;
        }
      }

      ctx.save();
      const fontSize = Math.round(24 * scale);
      ctx.font = `700 ${fontSize}px 'JetBrains Mono', monospace`;
      ctx.textBaseline = 'middle';

      const text = item.text;
      const metrics = ctx.measureText(text);
      const paddingH = 14 * scale;
      const boxW = metrics.width + paddingH * 2;
      const boxH = 40 * scale;
      const drawX = item.x + 20 * scale;
      const drawY = item.y - boxH / 2;

      // Dark translucent backing
      ctx.fillStyle = `rgba(7, 17, 31, ${item.alpha * 0.85})`;
      ctx.fillRect(drawX, drawY, boxW, boxH);

      // Red corner brackets / accent
      ctx.strokeStyle = `rgba(255, 0, 0, ${item.alpha * 0.9})`;
      ctx.lineWidth = 1.5 * scale;
      ctx.strokeRect(drawX, drawY, boxW, boxH);

      // White text
      ctx.fillStyle = `rgba(255, 255, 255, ${item.alpha})`;
      ctx.fillText(text, drawX + paddingH, item.y);

      // Small hand indicator
      ctx.font = `600 ${Math.round(10 * scale)}px 'JetBrains Mono', monospace`;
      ctx.fillStyle = `rgba(255, 0, 0, ${item.alpha * 0.9})`;
      ctx.fillText(`PINCH:${item.hand.toUpperCase()}`, drawX + paddingH, drawY - 6 * scale);

      ctx.restore();
    });

    toDelete.forEach((k) => this.floatingTexts.delete(k));
  }
}

export const visualRenderer = new VisualRenderer();

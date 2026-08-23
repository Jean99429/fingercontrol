import { EffectId, FingercontrolConfig, HandGestureData } from '../types/config';
import { effectEngine } from './effectLibrary';

export interface FloatingTextItem {
  id: string;
  text: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  vx: number;
  vy: number;
  alpha: number;
  active: boolean;
  spawnTime: number;
  releaseTime: number;
}

export class VisualRenderer {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  // Active floating text items for left hand
  private floatingTexts: Map<string, FloatingTextItem> = new Map();

  // Active effect confirmation badges for right hand
  private effectBadges: {
    label: string;
    x: number;
    y: number;
    spawnTime: number;
  }[] = [];

  public init(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { willReadFrequently: true });
  }

  public reset(): void {
    effectEngine.reset();
    this.floatingTexts.clear();
    this.effectBadges = [];
  }

  public spawnFloatingText(slotId: string, text: string, x: number, y: number): void {
    const existing = this.floatingTexts.get(slotId);
    if (existing) {
      existing.text = text;
      existing.targetX = x;
      existing.targetY = y;
      existing.active = true;
      existing.releaseTime = 0;
      existing.alpha = 1.0;
    } else {
      this.floatingTexts.set(slotId, {
        id: slotId,
        text,
        x,
        y,
        targetX: x,
        targetY: y,
        vx: 0,
        vy: 0,
        alpha: 1.0,
        active: true,
        spawnTime: performance.now(),
        releaseTime: 0,
      });
    }
  }

  public updateFloatingTextTarget(slotId: string, x: number, y: number): void {
    const item = this.floatingTexts.get(slotId);
    if (item && item.active) {
      item.targetX = x;
      item.targetY = y;
    }
  }

  public releaseFloatingText(slotId: string): void {
    const item = this.floatingTexts.get(slotId);
    if (item) {
      item.active = false;
      item.releaseTime = performance.now();
    }
  }

  public spawnEffectBadge(label: string, x: number, y: number): void {
    this.effectBadges.push({
      label,
      x,
      y,
      spawnTime: performance.now(),
    });
    if (this.effectBadges.length > 5) {
      this.effectBadges.shift();
    }
  }

  public renderFrame(
    video: HTMLVideoElement,
    gestureData: { Left: HandGestureData; Right: HandGestureData },
    config: FingercontrolConfig,
    activeRightEffectId: EffectId | null,
    isRightEffectActive: boolean,
    now: number
  ): void {
    if (!this.canvas || !this.ctx) return;

    const width = this.canvas.width;
    const height = this.canvas.height;
    const ctx = this.ctx;

    // 1. Clear background (near-black)
    ctx.fillStyle = '#080808';
    ctx.fillRect(0, 0, width, height);

    // 2. Render Main Visual & Effects Layer
    effectEngine.updateAndRender(
      ctx,
      width,
      height,
      video,
      activeRightEffectId,
      isRightEffectActive,
      gestureData.Right,
      now
    );

    // 3. Render Fingertip Tracking Layer (if enabled in config)
    if (config.trackingVisible) {
      this.renderTrackingLayer(ctx, width, height, gestureData);
    }

    // 4. Render Right Hand Crosshair Badges
    this.renderEffectBadges(ctx, width, height, now);

    // 5. Render Left Hand Floating Typography Layer
    this.renderFloatingTextLayer(ctx, width, height, now);
  }

  // Fingertip Tracking Visuals (SPEC Section 5.3)
  private renderTrackingLayer(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    gestureData: { Left: HandGestureData; Right: HandGestureData }
  ): void {
    for (const handKey of ['Left', 'Right'] as const) {
      const hand = gestureData[handKey];
      if (!hand.detected) continue;

      const ft = hand.fingertips;
      const thumbX = ft.thumb.x * width;
      const thumbY = ft.thumb.y * height;

      // Finger tips array
      const tips = [
        { name: 'thumb', pt: ft.thumb, isThumb: true },
        { name: 'index', pt: ft.index, isThumb: false },
        { name: 'middle', pt: ft.middle, isThumb: false },
        { name: 'ring', pt: ft.ring, isThumb: false },
        { name: 'pinky', pt: ft.pinky, isThumb: false },
      ];

      // Proximity line when approaching or armed
      if (hand.state === 'APPROACHING' || hand.state === 'ARMING' || hand.state === 'ACTIVE') {
        const targetTip = hand.activeFinger ? ft[hand.activeFinger] : null;
        if (targetTip) {
          const targetX = targetTip.x * width;
          const targetY = targetTip.y * height;

          const alpha = hand.state === 'ACTIVE'
            ? 0.95
            : hand.state === 'ARMING'
            ? 0.85
            : Math.max(0.2, 1.0 - hand.proximityDistance);

          ctx.save();
          ctx.beginPath();
          ctx.moveTo(thumbX, thumbY);
          ctx.lineTo(targetX, targetY);
          ctx.strokeStyle = `rgba(255, 51, 51, ${alpha})`;
          ctx.lineWidth = hand.state === 'ACTIVE' ? 2.5 : 1.2;
          ctx.setLineDash(hand.state === 'ARMING' ? [4, 3] : []);
          ctx.stroke();
          ctx.restore();
        }
      }

      // Draw exactly 5 fingertip points
      for (const tip of tips) {
        const px = tip.pt.x * width;
        const py = tip.pt.y * height;

        ctx.save();
        ctx.beginPath();
        ctx.arc(px, py, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = '#ff3333';
        ctx.shadowColor = 'rgba(255, 51, 51, 0.6)';
        ctx.shadowBlur = 6;
        ctx.fill();
        ctx.restore();
      }

      // If active pinch, draw merged contact node
      if (hand.state === 'ACTIVE' && hand.pinchCenter) {
        const cx = hand.pinchCenter.x * width;
        const cy = hand.pinchCenter.y * height;

        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#ff2222';
        ctx.shadowColor = '#ff3333';
        ctx.shadowBlur = 12;
        ctx.fill();

        // Pulsing ring
        ctx.beginPath();
        ctx.arc(cx, cy, 11, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 51, 51, 0.4)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  // Right hand X/Y axes & confirmation tag (fades out in ~500ms)
  private renderEffectBadges(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    now: number
  ): void {
    const BADGE_DURATION = 550; // ms

    this.effectBadges = this.effectBadges.filter((b) => now - b.spawnTime < BADGE_DURATION);

    for (const b of this.effectBadges) {
      const elapsed = now - b.spawnTime;
      const alpha = Math.max(0, 1 - elapsed / BADGE_DURATION);
      const px = b.x * width;
      const py = b.y * height;
      const crossSize = 16;

      ctx.save();
      ctx.strokeStyle = `rgba(255, 51, 51, ${alpha * 0.8})`;
      ctx.lineWidth = 1;

      // Fine X/Y crosshair axes
      ctx.beginPath();
      ctx.moveTo(px - crossSize, py);
      ctx.lineTo(px + crossSize, py);
      ctx.moveTo(px, py - crossSize);
      ctx.lineTo(px, py + crossSize);
      ctx.stroke();

      // Technical label
      ctx.font = "10px 'JetBrains Mono', monospace";
      ctx.fillStyle = `rgba(255, 60, 60, ${alpha})`;
      ctx.fillText(`[${b.label}]`, px + 8, py - 8);
      ctx.restore();
    }
  }

  // Left hand typography floating layer (SPEC Section 5.6)
  private renderFloatingTextLayer(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    now: number
  ): void {
    const toDelete: string[] = [];

    this.floatingTexts.forEach((item, key) => {
      const tx = item.targetX * width;
      const ty = item.targetY * height;

      // Spring physics follow hand
      const dx = tx - item.x;
      const dy = ty - item.y;
      item.vx += dx * 0.18;
      item.vy += dy * 0.18;
      item.vx *= 0.65;
      item.vy *= 0.65;
      item.x += item.vx;
      item.y += item.vy;

      if (!item.active) {
        const elapsedSinceRelease = now - item.releaseTime;
        const FADE_DURATION = 650;
        item.alpha = Math.max(0, 1 - elapsedSinceRelease / FADE_DURATION);
        if (item.alpha <= 0) {
          toDelete.push(key);
          return;
        }
      }

      // Render crisp typographical layout
      ctx.save();
      ctx.font = "600 22px 'JetBrains Mono', 'Space Grotesk', monospace";
      ctx.textBaseline = 'middle';

      const text = item.text;
      const metrics = ctx.measureText(text);
      const padding = 12;
      const boxW = metrics.width + padding * 2;
      const boxH = 36;
      const drawX = item.x + 20;
      const drawY = item.y - boxH / 2;

      // Subtle translucent backing
      ctx.fillStyle = `rgba(10, 10, 10, ${item.alpha * 0.75})`;
      ctx.fillRect(drawX, drawY, boxW, boxH);

      // Fine red accent border
      ctx.strokeStyle = `rgba(255, 51, 51, ${item.alpha * 0.5})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(drawX, drawY, boxW, boxH);

      // Clean white typography with subtle glow
      ctx.fillStyle = `rgba(245, 245, 245, ${item.alpha})`;
      ctx.shadowColor = `rgba(255, 255, 255, ${item.alpha * 0.3})`;
      ctx.shadowBlur = 8;
      ctx.fillText(text, drawX + padding, item.y);

      // Small index marker
      ctx.font = "9px 'JetBrains Mono', monospace";
      ctx.fillStyle = `rgba(255, 51, 51, ${item.alpha * 0.9})`;
      ctx.fillText('PINCH:LEFT', drawX + padding, drawY - 4);

      ctx.restore();
    });

    toDelete.forEach((k) => this.floatingTexts.delete(k));
  }
}

export const visualRenderer = new VisualRenderer();

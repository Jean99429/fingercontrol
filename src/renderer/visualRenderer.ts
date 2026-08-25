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

type TipName = 'thumb' | 'index' | 'middle' | 'ring' | 'pinky';

interface SmoothPoint {
  x: number;
  y: number;
  initialized: boolean;
}

const createTipTrackers = (): Record<TipName, SmoothPoint> => ({
  thumb: { x: 0, y: 0, initialized: false },
  index: { x: 0, y: 0, initialized: false },
  middle: { x: 0, y: 0, initialized: false },
  ring: { x: 0, y: 0, initialized: false },
  pinky: { x: 0, y: 0, initialized: false },
});

const TRACK_LIME = '#d7ff3f';
const TRACK_LIME_RGB = '215, 255, 63';
const SIGNAL_RED = '#ff2b20';
const SIGNAL_RED_RGB = '255, 43, 32';
const DATA_COLORS: Array<[number, number, number]> = [
  [91, 231, 255],
  [188, 103, 255],
  [231, 255, 67],
];

function dataColor(phase: number, alpha: number = 1): string {
  const wrapped = ((phase % 1) + 1) % 1;
  const scaled = wrapped * DATA_COLORS.length;
  const index = Math.floor(scaled) % DATA_COLORS.length;
  const next = (index + 1) % DATA_COLORS.length;
  const mix = scaled - Math.floor(scaled);
  const rgb = DATA_COLORS[index].map((channel, i) =>
    Math.round(channel + (DATA_COLORS[next][i] - channel) * mix)
  );
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
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

  // A tiny amount of lag makes each fingertip feel tracked rather than stickered on.
  private smoothedTips: Record<Hand, Record<TipName, SmoothPoint>> = {
    left: createTipTrackers(),
    right: createTipTrackers(),
  };

  public init(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { willReadFrequently: true });
  }

  public reset(): void {
    this.floatingTexts.clear();
    this.smoothedBoxes.left.initialized = false;
    this.smoothedBoxes.right.initialized = false;
    for (const hand of ['left', 'right'] as const) {
      for (const tip of Object.values(this.smoothedTips[hand])) tip.initialized = false;
    }
  }

  public spawnFloatingText(slotId: string, hand: Hand, text: string, xNorm: number, yNorm: number): void {
    if (!this.canvas) return;
    const px = xNorm * this.canvas.width;
    const py = yNorm * this.canvas.height;

    const existing = this.floatingTexts.get(slotId);
    if (existing) {
      existing.text = text;
      existing.hand = hand;
      existing.x = px;
      existing.y = py;
      existing.targetX = px;
      existing.targetY = py;
      existing.vx = 0;
      existing.vy = 0;
      existing.active = true;
      existing.spawnTime = performance.now();
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
    // Resolution-independent measurement system, tuned around a 1080px short edge.
    const refDim = Math.min(width, height);
    const scale = Math.max(0.6, refDim / 1080);

    const normalRadius = Math.max(3.6, 4.5 * scale);
    const approachingRadius = Math.max(4.4, 5.4 * scale);
    const activeRadius = Math.max(5.2, 6.2 * scale);

    for (const handKey of ['left', 'right'] as const) {
      const hand = gestureData[handKey];
      if (!hand.detected) {
        this.smoothedBoxes[handKey].initialized = false;
        for (const tip of Object.values(this.smoothedTips[handKey])) tip.initialized = false;
        continue;
      }

      const ft = hand.fingertips;

      // 1. Coordinate Frame (SPEC Section 8.2)
      if (hand.boundingBox) {
        const rawBox = hand.boundingBox;
        // Convert the MediaPipe bounds to a generous square tracking field. The
        // square reads as a live coordinate viewport instead of a UI card.
        const boxW = rawBox.maxX - rawBox.minX;
        const boxH = rawBox.maxY - rawBox.minY;
        const centerX = (rawBox.minX + rawBox.maxX) / 2;
        const centerY = (rawBox.minY + rawBox.maxY) / 2;
        const rawPixelW = boxW * width;
        const rawPixelH = boxH * height;
        const shortEdge = Math.min(width, height);
        const squareSidePx = Math.min(
          shortEdge * 0.38,
          Math.max(shortEdge * 0.13, Math.max(rawPixelW, rawPixelH) * 1.16)
        );
        const squareSizeX = squareSidePx / width;
        const squareSizeY = squareSidePx / height;
        let targetMinX = centerX - squareSizeX / 2;
        let targetMinY = centerY - squareSizeY / 2;
        let targetMaxX = centerX + squareSizeX / 2;
        let targetMaxY = centerY + squareSizeY / 2;

        if (targetMinX < 0.018) {
          targetMaxX += 0.018 - targetMinX;
          targetMinX = 0.018;
        }
        if (targetMaxX > 0.982) {
          targetMinX -= targetMaxX - 0.982;
          targetMaxX = 0.982;
        }
        if (targetMinY < 0.024) {
          targetMaxY += 0.024 - targetMinY;
          targetMinY = 0.024;
        }
        if (targetMaxY > 0.976) {
          targetMinY -= targetMaxY - 0.976;
          targetMaxY = 0.976;
        }

        const smooth = this.smoothedBoxes[handKey];
        if (!smooth.initialized) {
          smooth.minX = targetMinX;
          smooth.minY = targetMinY;
          smooth.maxX = targetMaxX;
          smooth.maxY = targetMaxY;
          smooth.initialized = true;
        } else {
          // Lerp for smooth box motion
          const lerpFactor = 0.24;
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

        // Faint field + strong open corners. Thin lines and small data labels are
        // intentionally closer to a TouchDesigner viewport than a bounding box.
        const cornerLen = Math.min(bw * 0.12, bh * 0.12, 17 * scale);
        ctx.save();
        ctx.strokeStyle = `rgba(${TRACK_LIME_RGB}, 0.04)`;
        ctx.lineWidth = Math.max(0.6, 0.72 * scale);
        ctx.strokeRect(x1 + 0.5, y1 + 0.5, bw - 1, bh - 1);

        // Local axes and quarter divisions.
        ctx.setLineDash([1.5 * scale, 7 * scale]);
        ctx.beginPath();
        ctx.moveTo(x1, y1 + bh / 2);
        ctx.lineTo(x2, y1 + bh / 2);
        ctx.moveTo(x1 + bw / 2, y1);
        ctx.lineTo(x1 + bw / 2, y2);
        ctx.strokeStyle = `rgba(${TRACK_LIME_RGB}, 0.035)`;
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.strokeStyle = TRACK_LIME;
        ctx.globalAlpha = 0.23;
        ctx.lineWidth = Math.max(0.75, 0.9 * scale);
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

        // Measurement ticks on all four axes.
        ctx.strokeStyle = `rgba(${TRACK_LIME_RGB}, 0.22)`;
        ctx.lineWidth = Math.max(0.6, 0.72 * scale);
        for (let i = 1; i < 4; i++) {
          const tx = x1 + (bw * i) / 4;
          const ty = y1 + (bh * i) / 4;
          const tick = (i === 2 ? 4 : 2.5) * scale;
          ctx.beginPath();
          ctx.moveTo(tx, y1 - tick);
          ctx.lineTo(tx, y1 + tick);
          ctx.moveTo(tx, y2 - tick);
          ctx.lineTo(tx, y2 + tick);
          ctx.moveTo(x1 - tick, ty);
          ctx.lineTo(x1 + tick, ty);
          ctx.moveTo(x2 - tick, ty);
          ctx.lineTo(x2 + tick, ty);
          ctx.stroke();
        }

        // Hand channel and normalized coordinates.
        ctx.globalAlpha = 1;
        ctx.font = `500 ${Math.max(7, Math.round(7.5 * scale))}px 'JetBrains Mono', monospace`;
        ctx.fillStyle = `rgba(${TRACK_LIME_RGB}, 0.26)`;
        ctx.textBaseline = 'top';
        const channel = handKey === 'left' ? 'CH/L' : 'CH/R';
        ctx.fillText(`${channel}`, x1 + 5 * scale, y1 + 4 * scale);

        // Crosshair at pinch center (or hand center if not pinching)
        const crossCenter = hand.pinchCenter || { x: (smooth.minX + smooth.maxX) / 2, y: (smooth.minY + smooth.maxY) / 2 };
        const cx = crossCenter.x * width;
        const cy = crossCenter.y * height;
        const crossSize = 5 * scale;

        ctx.strokeStyle = `rgba(${TRACK_LIME_RGB}, 0.18)`;
        ctx.lineWidth = Math.max(0.6, 0.72 * scale);
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
          ctx.strokeStyle = `rgba(${TRACK_LIME_RGB}, ${hand.state === 'ACTIVE' ? 0.94 : 0.64})`;
          ctx.lineWidth = hand.state === 'ACTIVE' ? 1.8 * scale : 1.05 * scale;
          ctx.setLineDash(hand.state === 'ACTIVE' ? [2 * scale, 3 * scale] : [4 * scale, 4 * scale]);
          ctx.stroke();

          // Signal packets move along the pinch connection.
          const packetCount = hand.state === 'ACTIVE' ? 3 : 1;
          for (let i = 0; i < packetCount; i++) {
            const phase = (performance.now() / 700 + i / packetCount) % 1;
            const packetX = thumbX + (targetX - thumbX) * phase;
            const packetY = thumbY + (targetY - thumbY) * phase;
            ctx.fillStyle = TRACK_LIME;
            ctx.fillRect(packetX - 1.5 * scale, packetY - 1.5 * scale, 3 * scale, 3 * scale);
          }
          ctx.restore();
        }
      }

      // 3. Fingertip dots: 5 tips (thumb, index, middle, ring, pinky)
      const tips: Array<{ name: TipName; pt: { x: number; y: number } }> = [
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

        const tracker = this.smoothedTips[handKey][tip.name];
        if (!tracker.initialized) {
          tracker.x = px;
          tracker.y = py;
          tracker.initialized = true;
        } else {
          const follow = hand.state === 'ACTIVE' && isTarget ? 0.48 : 0.34;
          tracker.x += (px - tracker.x) * follow;
          tracker.y += (py - tracker.y) * follow;
        }

        const sx = tracker.x;
        const sy = tracker.y;
        const isLiveTarget = isTarget && hand.state !== 'IDLE';
        const half = Math.max(13, (isLiveTarget ? (hand.state === 'ACTIVE' ? 16 : 15) : 13) * scale);
        const corner = Math.min(half * 0.42, 6 * scale);
        const frameAlpha = isLiveTarget ? (hand.state === 'ACTIVE' ? 0.98 : 0.86) : 0.68;
        const lag = Math.hypot(px - sx, py - sy);

        ctx.save();

        // Hairline vector: visible only while the tracked point is moving.
        if (lag > 1.2 * scale) {
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(px, py);
          ctx.strokeStyle = `rgba(${TRACK_LIME_RGB}, ${Math.min(0.38, 0.12 + lag / 70)})`;
          ctx.lineWidth = Math.max(0.55, 0.65 * scale);
          ctx.stroke();
        }

        // Small open-corner tracker inspired by machine-vision / terminal overlays.
        ctx.strokeStyle = `rgba(${TRACK_LIME_RGB}, ${frameAlpha})`;
        ctx.lineWidth = Math.max(0.65, (isLiveTarget ? 0.95 : 0.72) * scale);
        ctx.beginPath();
        ctx.moveTo(sx - half, sy - half + corner); ctx.lineTo(sx - half, sy - half); ctx.lineTo(sx - half + corner, sy - half);
        ctx.moveTo(sx + half - corner, sy - half); ctx.lineTo(sx + half, sy - half); ctx.lineTo(sx + half, sy - half + corner);
        ctx.moveTo(sx - half, sy + half - corner); ctx.lineTo(sx - half, sy + half); ctx.lineTo(sx - half + corner, sy + half);
        ctx.moveTo(sx + half - corner, sy + half); ctx.lineTo(sx + half, sy + half); ctx.lineTo(sx + half, sy + half - corner);
        ctx.stroke();

        // Keep the red landmark compact; only the active pair receives a restrained glow.
        if (hand.state === 'ACTIVE' && isTarget) {
          const glow = ctx.createRadialGradient(px, py, 0, px, py, 15 * scale);
          glow.addColorStop(0, `rgba(${SIGNAL_RED_RGB}, 0.28)`);
          glow.addColorStop(1, `rgba(${SIGNAL_RED_RGB}, 0)`);
          ctx.fillStyle = glow;
          ctx.fillRect(px - 14 * scale, py - 14 * scale, 28 * scale, 28 * scale);
        }
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(8, 8, 10, 0.82)';
        ctx.lineWidth = Math.max(1.2, 1.5 * scale);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(px, py, Math.max(2.8, r - 1.2 * scale), 0, Math.PI * 2);
        ctx.fillStyle = SIGNAL_RED;
        ctx.fill();

        if (tip.name === 'thumb') {
          ctx.font = `500 ${Math.max(7, Math.round(8 * scale))}px 'IBM Plex Mono', 'JetBrains Mono', monospace`;
          ctx.textBaseline = 'middle';
          ctx.fillStyle = `rgba(${TRACK_LIME_RGB}, 0.94)`;
          ctx.fillText('T', sx + half + 4 * scale, sy);
        }

        // Only the selected finger gets a coordinate chip: two tiny terminal cells,
        // placed opposite the large floating word so both remain readable.
        if (hand.activeFinger === tip.name && hand.state !== 'IDLE') {
          const code = `${handKey === 'left' ? 'L' : 'R'}${['thumb', 'index', 'middle', 'ring', 'pinky'].indexOf(tip.name)}`;
          const coords = `${(tip.pt.x * 100).toFixed(1)},${(tip.pt.y * 100).toFixed(1)}`;
          const fontPx = Math.max(7, Math.round(7.5 * scale));
          ctx.font = `500 ${fontPx}px 'JetBrains Mono', monospace`;
          ctx.textBaseline = 'middle';
          const padX = 4 * scale;
          const cellH = 13 * scale;
          const codeW = ctx.measureText(code).width + padX * 2;
          const coordW = ctx.measureText(coords).width + padX * 2;
          const chipX = handKey === 'left' ? sx - half - coordW - 5 * scale : sx + half + 5 * scale;
          const chipY = sy + half + 4 * scale;

          ctx.fillStyle = 'rgba(7, 9, 11, 0.76)';
          ctx.fillRect(chipX, chipY, coordW, cellH);
          const codeX = handKey === 'left' ? chipX + coordW - codeW : chipX;
          ctx.fillStyle = 'rgba(7, 9, 11, 0.86)';
          ctx.fillRect(codeX, chipY - cellH, codeW, cellH - 1);
          const coordColor = dataColor(performance.now() / 9000 + tip.pt.x * 0.5 + tip.pt.y * 0.28, 0.94);
          ctx.strokeStyle = dataColor(performance.now() / 9000 + tip.pt.x * 0.5 + tip.pt.y * 0.28, 0.52);
          ctx.lineWidth = Math.max(0.5, 0.6 * scale);
          ctx.strokeRect(chipX + 0.5, chipY + 0.5, coordW - 1, cellH - 1);
          ctx.strokeRect(codeX + 0.5, chipY - cellH + 0.5, codeW - 1, cellH - 2);
          ctx.fillStyle = coordColor;
          ctx.fillText(coords, chipX + padX, chipY + cellH / 2);
          ctx.fillText(code, codeX + padX, chipY - cellH / 2);
        }
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
      const age = Math.max(0, now - item.spawnTime);
      const reveal = Math.min(1, age / 220);
      const easeOut = 1 - Math.pow(1 - reveal, 3);
      const text = item.text.trim();
      const finger = item.id.split('-').slice(1).join('/').toUpperCase();
      const handCode = item.hand === 'left' ? 'L' : 'R';

      const fontSize = Math.round(44 * scale);
      ctx.font = `italic 500 ${fontSize}px 'IBM Plex Mono', 'JetBrains Mono', monospace`;
      const metrics = ctx.measureText(text);
      const textW = metrics.width;
      const side = item.hand === 'left' ? 1 : -1;
      let drawX = item.x + side * 34 * scale;
      const drawY = item.y - 8 * scale - (1 - easeOut) * 16 * scale;

      if (side < 0) drawX -= textW;
      drawX = Math.max(24 * scale, Math.min(width - textW - 24 * scale, drawX));

      // A brief editorial starburst makes the trigger feel printed and alive.
      if (age < 430) {
        const burst = age / 430;
        const burstAlpha = (1 - burst) * item.alpha;
        ctx.save();
        ctx.translate(item.x, item.y);
        ctx.rotate((item.spawnTime % 1000) * 0.001 + burst * 0.18);
        for (let i = 0; i < 14; i++) {
          const angle = (Math.PI * 2 * i) / 14;
          const inner = (5 + burst * 6) * scale;
          const outer = (14 + (i % 3) * 4 + burst * 28) * scale;
          ctx.beginPath();
          ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
          ctx.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
          ctx.strokeStyle = i % 4 === 0
            ? dataColor(i / 14 + age / 5000, burstAlpha * 0.9)
            : `rgba(${SIGNAL_RED_RGB}, ${burstAlpha * 0.72})`;
          ctx.lineWidth = Math.max(0.7, (i % 3 === 0 ? 1.5 : 0.85) * scale);
          ctx.stroke();
        }
        ctx.restore();
      }

      ctx.globalAlpha = item.alpha * easeOut;
      ctx.textBaseline = 'alphabetic';

      const visibleChars = Math.max(1, Math.ceil(text.length * Math.min(1, age / 280)));
      const motionX = Math.abs(item.vx) > 0.5 ? item.vx : side * 2.4 * scale;
      const motionY = Math.abs(item.vy) > 0.5 ? item.vy : -1.5 * scale;

      const drawCharacterRun = (
        originX: number,
        originY: number,
        color: string,
        jitterAmount: number,
        outline: boolean = false
      ): void => {
        let cursor = originX;
        for (let i = 0; i < visibleChars; i++) {
          const char = text[i] || '';
          const charWidth = ctx.measureText(char).width;
          const jitter = Math.sin((i + 1) * 12.9898 + item.spawnTime * 0.004) * jitterAmount * scale;
          if (outline) {
            ctx.strokeStyle = 'rgba(5, 6, 8, 0.82)';
            ctx.lineWidth = Math.max(1.5, 2.4 * scale);
            ctx.strokeText(char, cursor, originY + jitter);
          }
          ctx.fillStyle = color;
          ctx.fillText(char, cursor, originY + jitter);
          cursor += charWidth;
        }
      };

      // Three short chromatic echoes form a typographic motion trail.
      for (let trail = 3; trail >= 1; trail--) {
        const trailAlpha = (0.08 + (4 - trail) * 0.035) * item.alpha * easeOut;
        drawCharacterRun(
          drawX - motionX * trail * 1.9,
          drawY - motionY * trail * 1.9 + trail * 2.2 * scale,
          dataColor(item.spawnTime / 7000 + trail * 0.19, trailAlpha),
          2.8 + trail * 0.45
        );
      }

      // Main word: signal red, character-by-character, with a dark edge for video legibility.
      ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
      ctx.shadowBlur = 8 * scale;
      drawCharacterRun(drawX, drawY, SIGNAL_RED, 2.1, true);
      ctx.shadowBlur = 0;

      // A short lime trace anchors the word without turning it into a UI card.
      const lineY = drawY + 9 * scale;
      ctx.strokeStyle = `rgba(${TRACK_LIME_RGB}, 0.88)`;
      ctx.lineWidth = Math.max(0.8, 1 * scale);
      ctx.beginPath();
      ctx.moveTo(drawX, lineY);
      ctx.lineTo(drawX + textW * easeOut * 0.72, lineY);
      ctx.stroke();
      ctx.fillStyle = TRACK_LIME;
      ctx.fillRect(drawX - 2 * scale, lineY - 2 * scale, 4 * scale, 4 * scale);

      // Compact changing data label; visually separate from the red spoken word.
      ctx.font = `500 ${Math.max(7, Math.round(8 * scale))}px 'IBM Plex Mono', 'JetBrains Mono', monospace`;
      ctx.fillStyle = dataColor(now / 9000 + (item.hand === 'left' ? 0 : 0.33), 0.94);
      ctx.fillText(`${handCode}/${finger} · VOICE`, drawX, drawY - (fontSize + 7 * scale));

      ctx.restore();
    });

    toDelete.forEach((k) => this.floatingTexts.delete(k));
  }
}

export const visualRenderer = new VisualRenderer();

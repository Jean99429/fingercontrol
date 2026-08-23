import React, { useState, useEffect, useRef } from 'react';
import {
  FingercontrolConfig,
  Finger,
  LeftSlot,
  RightSlot,
  EffectId,
  EFFECT_LIBRARY,
  AudioMode,
} from '../types/config';
import { audioManager } from '../utils/audio';
import {
  Camera,
  Sliders,
  Volume2,
  VolumeX,
  Eye,
  EyeOff,
  Play,
  Square,
  Upload,
  Sparkles,
  ArrowRight,
  RefreshCw,
  Layers,
  HelpCircle,
} from 'lucide-react';

interface SetupScreenProps {
  config: FingercontrolConfig;
  onUpdateConfig: (config: FingercontrolConfig) => void;
  onStartPerformance: () => void;
  onStartDemoPerformance: () => void;
  isLoading: boolean;
  loadingMessage: string;
  errorMessage: string | null;
  videoDevices: MediaDeviceInfo[];
  selectedDeviceId: string;
  onSelectDeviceId: (id: string) => void;
}

const FINGERS: { id: Finger; label: string }[] = [
  { id: 'index', label: 'INDEX' },
  { id: 'middle', label: 'MIDDLE' },
  { id: 'ring', label: 'RING' },
  { id: 'pinky', label: 'PINKY' },
];

export const SetupScreen: React.FC<SetupScreenProps> = ({
  config,
  onUpdateConfig,
  onStartPerformance,
  onStartDemoPerformance,
  isLoading,
  loadingMessage,
  errorMessage,
  videoDevices,
  selectedDeviceId,
  onSelectDeviceId,
}) => {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [previewingAudioSlot, setPreviewingAudioSlot] = useState<string | null>(null);
  const [previewingEffect, setPreviewingEffect] = useState<EffectId | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewAnimRef = useRef<number | null>(null);

  useEffect(() => {
    const updateVoices = () => {
      setVoices(audioManager.getVoices());
    };
    updateVoices();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = updateVoices;
    }
  }, []);

  // Left Slot Finger Change (Collision resolution)
  const handleLeftFingerChange = (slotIndex: number, newFinger: Finger) => {
    const currentSlots = [...config.leftSlots];
    const targetSlot = currentSlots[slotIndex];
    const oldFinger = targetSlot.finger;

    // Check if another slot has this finger; if so, swap
    const collisionIndex = currentSlots.findIndex((s, idx) => idx !== slotIndex && s.finger === newFinger);
    if (collisionIndex >= 0) {
      currentSlots[collisionIndex] = {
        ...currentSlots[collisionIndex],
        finger: oldFinger,
      };
    }

    currentSlots[slotIndex] = {
      ...targetSlot,
      finger: newFinger,
    };

    onUpdateConfig({
      ...config,
      leftSlots: currentSlots,
    });
  };

  // Right Slot Finger Change (Collision resolution)
  const handleRightFingerChange = (slotIndex: number, newFinger: Finger) => {
    const currentSlots = [...config.rightSlots];
    const targetSlot = currentSlots[slotIndex];
    const oldFinger = targetSlot.finger;

    const collisionIndex = currentSlots.findIndex((s, idx) => idx !== slotIndex && s.finger === newFinger);
    if (collisionIndex >= 0) {
      currentSlots[collisionIndex] = {
        ...currentSlots[collisionIndex],
        finger: oldFinger,
      };
    }

    currentSlots[slotIndex] = {
      ...targetSlot,
      finger: newFinger,
    };

    onUpdateConfig({
      ...config,
      rightSlots: currentSlots,
    });
  };

  const updateLeftSlot = (index: number, updates: Partial<LeftSlot>) => {
    const newSlots = [...config.leftSlots];
    newSlots[index] = { ...newSlots[index], ...updates };
    onUpdateConfig({ ...config, leftSlots: newSlots });
  };

  const updateRightSlot = (index: number, updates: Partial<RightSlot>) => {
    const newSlots = [...config.rightSlots];
    newSlots[index] = { ...newSlots[index], ...updates };
    onUpdateConfig({ ...config, rightSlots: newSlots });
  };

  // Audio Preview
  const handleTestAudio = async (slot: LeftSlot) => {
    if (previewingAudioSlot === slot.id) {
      audioManager.stopAudio();
      setPreviewingAudioSlot(null);
      return;
    }

    setPreviewingAudioSlot(slot.id);
    if (slot.audioMode === 'tts') {
      await audioManager.speakText(slot.text || 'TEST AUDIO', {
        voiceURI: slot.ttsVoice,
        rate: slot.ttsRate,
        volume: slot.ttsVolume,
      });
    } else if (slot.audioMode === 'file' && slot.audioDataUrl) {
      await audioManager.playAudioFile(slot.audioDataUrl, slot.ttsVolume);
    }
    setPreviewingAudioSlot(null);
  };

  // File Upload
  const handleFileUpload = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      updateLeftSlot(index, {
        audioFileName: file.name,
        audioDataUrl: dataUrl,
        audioMode: 'file',
      });
    };
    reader.readAsDataURL(file);
  };

  // Live Effect Preview Canvas
  useEffect(() => {
    if (!previewingEffect || !previewCanvasRef.current) {
      if (previewAnimRef.current) cancelAnimationFrame(previewAnimRef.current);
      return;
    }

    const canvas = previewCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frame = 0;
    const renderPreview = () => {
      frame++;
      const w = canvas.width;
      const h = canvas.height;

      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, w, h);

      // Draw synthetic preview performer silhouette & effect animation
      ctx.save();
      const cx = w / 2;
      const cy = h / 2;

      // Silhouette
      ctx.fillStyle = '#2a2a2a';
      ctx.beginPath();
      ctx.arc(cx, cy - 30, 28, 0, Math.PI * 2); // head
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx, cy + 50, 45, 60, 0, 0, Math.PI * 2); // torso
      ctx.fill();

      // Effect specific preview
      if (previewingEffect === 'particle-disassembly') {
        ctx.fillStyle = '#f0f0f0';
        for (let i = 0; i < 200; i++) {
          const angle = (i / 200) * Math.PI * 2 + frame * 0.03;
          const r = Math.sin(frame * 0.05 + i) * 60 + 20;
          ctx.fillRect(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r, 2, 2);
        }
      } else if (previewingEffect === 'ascii-dither') {
        ctx.font = '10px monospace';
        ctx.fillStyle = '#e0e0e0';
        const chars = '@%#*+=-:. ';
        for (let y = 10; y < h; y += 12) {
          for (let x = 10; x < w; x += 10) {
            const ch = chars[(x + y + frame) % chars.length];
            ctx.fillText(ch, x, y);
          }
        }
      } else if (previewingEffect === 'rgb-time-echo') {
        const offset = Math.sin(frame * 0.08) * 15;
        ctx.strokeStyle = 'rgba(255, 50, 50, 0.7)';
        ctx.strokeRect(cx - 35 - offset, cy - 45, 70, 90);
        ctx.strokeStyle = 'rgba(50, 255, 50, 0.7)';
        ctx.strokeRect(cx - 35, cy - 45, 70, 90);
        ctx.strokeStyle = 'rgba(50, 100, 255, 0.7)';
        ctx.strokeRect(cx - 35 + offset, cy - 45, 70, 90);
      } else if (previewingEffect === 'glyph-dissolve') {
        ctx.font = '9px monospace';
        ctx.fillStyle = '#f0f0f0';
        for (let i = 0; i < 40; i++) {
          const x = cx + Math.sin(frame * 0.04 + i) * 50;
          const y = cy + ((frame * 2 + i * 15) % h) - h / 2;
          ctx.fillText('01'[i % 2], x, y);
        }
      } else if (previewingEffect === 'data-slice') {
        for (let i = 0; i < 8; i++) {
          const sy = i * 20;
          const shift = Math.sin(frame * 0.1 + i * 2) * 25;
          ctx.fillStyle = 'rgba(240, 240, 240, 0.6)';
          ctx.fillRect(cx - 40 + shift, sy, 80, 14);
        }
      } else {
        // Dot matrix / dither / distortion default
        ctx.fillStyle = '#e0e0e0';
        for (let y = 10; y < h; y += 10) {
          for (let x = 10; x < w; x += 10) {
            const dist = Math.hypot(x - cx, y - cy);
            if (dist < 60) {
              const r = Math.max(1, 4 * Math.sin(frame * 0.05 + dist * 0.1));
              ctx.beginPath();
              ctx.arc(x, y, r, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
      }

      ctx.restore();
      previewAnimRef.current = requestAnimationFrame(renderPreview);
    };

    previewAnimRef.current = requestAnimationFrame(renderPreview);

    return () => {
      if (previewAnimRef.current) cancelAnimationFrame(previewAnimRef.current);
    };
  }, [previewingEffect]);

  return (
    <div className="min-h-screen bg-[#080808] text-[#e0e0e0] flex flex-col font-mono selection:bg-[#ff3333] selection:text-white">
      {/* Top Header */}
      <header className="border-b border-[#222222] bg-[#0c0c0c] px-6 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-2.5 bg-[#ff3333] rounded-full animate-pulse shadow-[0_0_8px_#ff3333]" />
          <div>
            <h1 className="text-base font-bold tracking-widest uppercase text-white flex items-center gap-2">
              fingercontrol <span className="text-xs font-normal text-[#888888]">v1.0 // CONTROL SETUP</span>
            </h1>
            <p className="text-xs text-[#777777] tracking-tight">Real-Time Fingertip Visual & Sound Controller</p>
          </div>
        </div>

        {/* Global Toggles & Camera Select */}
        <div className="flex flex-wrap items-center gap-4 text-xs">
          {videoDevices.length > 1 && (
            <div className="flex items-center gap-2 bg-[#141414] border border-[#2a2a2a] px-2.5 py-1.5 rounded">
              <Camera className="w-3.5 h-3.5 text-[#888888]" />
              <select
                value={selectedDeviceId}
                onChange={(e) => onSelectDeviceId(e.target.value)}
                className="bg-transparent text-[#cccccc] focus:outline-none cursor-pointer"
              >
                {videoDevices.map((dev, i) => (
                  <option key={dev.deviceId || i} value={dev.deviceId} className="bg-[#181818] text-white">
                    {dev.label || `Camera ${i + 1}`}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            onClick={() => onUpdateConfig({ ...config, soundEnabled: !config.soundEnabled })}
            className={`flex items-center gap-1.5 px-3 py-1.5 border rounded transition-colors ${
              config.soundEnabled
                ? 'border-[#ff3333]/50 bg-[#ff3333]/10 text-white'
                : 'border-[#333333] text-[#777777] bg-[#141414]'
            }`}
          >
            {config.soundEnabled ? <Volume2 className="w-3.5 h-3.5 text-[#ff3333]" /> : <VolumeX className="w-3.5 h-3.5" />}
            <span>AUDIO: {config.soundEnabled ? 'ON' : 'MUTE'}</span>
          </button>

          <button
            onClick={() => onUpdateConfig({ ...config, trackingVisible: !config.trackingVisible })}
            className={`flex items-center gap-1.5 px-3 py-1.5 border rounded transition-colors ${
              config.trackingVisible
                ? 'border-[#ff3333]/50 bg-[#ff3333]/10 text-white'
                : 'border-[#333333] text-[#777777] bg-[#141414]'
            }`}
          >
            {config.trackingVisible ? <Eye className="w-3.5 h-3.5 text-[#ff3333]" /> : <EyeOff className="w-3.5 h-3.5" />}
            <span>TRACKING PTS: {config.trackingVisible ? 'ON' : 'OFF'}</span>
          </button>
        </div>
      </header>

      {/* Main 2-Column Grid */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* LEFT COLUMN: Left Hand Content & Audio */}
        <section className="bg-[#0e0e0e] border border-[#222222] p-5 rounded-sm flex flex-col gap-4">
          <div className="flex items-center justify-between border-b border-[#222222] pb-3">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-[#ff3333] rounded-full" />
              <h2 className="text-sm font-semibold tracking-wider text-white">LEFT HAND // TEXT & SOUND SLOTS</h2>
            </div>
            <span className="text-[11px] text-[#777777]">THUMB + PINCH FINGER</span>
          </div>

          <div className="space-y-4">
            {config.leftSlots.map((slot, index) => (
              <div
                key={slot.id}
                className={`border p-4 transition-colors ${
                  slot.enabled ? 'border-[#2c2c2c] bg-[#121212]' : 'border-[#1a1a1a] bg-[#0a0a0a] opacity-50'
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={slot.enabled}
                      onChange={(e) => updateLeftSlot(index, { enabled: e.target.checked })}
                      className="accent-[#ff3333] cursor-pointer w-4 h-4"
                    />
                    <span className="text-xs font-bold text-[#aaaaaa]">SLOT 0{index + 1}</span>
                  </div>

                  {/* Finger Selector */}
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-[#666666]">FINGER:</span>
                    <select
                      value={slot.finger}
                      onChange={(e) => handleLeftFingerChange(index, e.target.value as Finger)}
                      className="bg-[#181818] border border-[#333333] text-white px-2 py-0.5 rounded text-xs focus:border-[#ff3333] focus:outline-none"
                    >
                      {FINGERS.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Text Content Input */}
                <div className="mb-3">
                  <label className="block text-[11px] text-[#777777] uppercase mb-1">Overlay Typography</label>
                  <input
                    type="text"
                    value={slot.text}
                    onChange={(e) => updateLeftSlot(index, { text: e.target.value })}
                    placeholder={`TEXT 0${index + 1}`}
                    className="w-full bg-[#181818] border border-[#2a2a2a] text-white px-3 py-1.5 text-xs focus:border-[#ff3333] focus:outline-none rounded font-mono"
                  />
                </div>

                {/* Audio Mode Select & Controls */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-[#1c1c1c] text-xs">
                  <div>
                    <label className="block text-[11px] text-[#777777] uppercase mb-1">Sound Mode</label>
                    <div className="flex rounded border border-[#2a2a2a] overflow-hidden bg-[#161616]">
                      {(['off', 'tts', 'file'] as AudioMode[]).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => updateLeftSlot(index, { audioMode: mode })}
                          className={`flex-1 py-1 text-[11px] font-medium transition-colors ${
                            slot.audioMode === mode
                              ? 'bg-[#ff3333] text-white'
                              : 'text-[#888888] hover:text-[#cccccc]'
                          }`}
                        >
                          {mode.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Audio Controls & Preview */}
                  <div className="flex items-end gap-2">
                    {slot.audioMode === 'tts' && (
                      <>
                        <div className="flex-1">
                          <label className="block text-[10px] text-[#777777] uppercase mb-1">
                            Rate: {slot.ttsRate.toFixed(1)}x
                          </label>
                          <input
                            type="range"
                            min="0.5"
                            max="2.0"
                            step="0.1"
                            value={slot.ttsRate}
                            onChange={(e) => updateLeftSlot(index, { ttsRate: parseFloat(e.target.value) })}
                            className="w-full accent-[#ff3333] h-1.5 bg-[#2a2a2a] rounded cursor-pointer"
                          />
                        </div>
                        <button
                          onClick={() => handleTestAudio(slot)}
                          className="px-2.5 py-1.5 bg-[#202020] hover:bg-[#282828] border border-[#333333] text-white rounded text-[11px] flex items-center gap-1 transition-colors"
                          title="Preview Speech TTS"
                        >
                          {previewingAudioSlot === slot.id ? (
                            <Square className="w-3 h-3 text-[#ff3333]" />
                          ) : (
                            <Play className="w-3 h-3 text-[#ff3333]" />
                          )}
                          <span>TEST</span>
                        </button>
                      </>
                    )}

                    {slot.audioMode === 'file' && (
                      <div className="flex-1 flex items-center gap-2">
                        <label className="flex-1 cursor-pointer bg-[#202020] hover:bg-[#282828] border border-[#333333] text-[11px] text-[#cccccc] px-2.5 py-1.5 rounded flex items-center justify-center gap-1 overflow-hidden truncate">
                          <Upload className="w-3 h-3 text-[#888888]" />
                          <span className="truncate">{slot.audioFileName || 'CHOOSE FILE'}</span>
                          <input
                            type="file"
                            accept="audio/*"
                            onChange={(e) => handleFileUpload(index, e)}
                            className="hidden"
                          />
                        </label>
                        {slot.audioDataUrl && (
                          <button
                            onClick={() => handleTestAudio(slot)}
                            className="px-2.5 py-1.5 bg-[#202020] hover:bg-[#282828] border border-[#333333] text-white rounded text-[11px]"
                          >
                            <Play className="w-3 h-3 text-[#ff3333]" />
                          </button>
                        )}
                      </div>
                    )}

                    {slot.audioMode === 'off' && (
                      <div className="text-[11px] text-[#555555] italic flex items-center h-8">
                        No audio triggered for this gesture
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* RIGHT COLUMN: Right Hand Visual Effects Mapping */}
        <section className="bg-[#0e0e0e] border border-[#222222] p-5 rounded-sm flex flex-col gap-4">
          <div className="flex items-center justify-between border-b border-[#222222] pb-3">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-[#ff3333] rounded-full" />
              <h2 className="text-sm font-semibold tracking-wider text-white">RIGHT HAND // FIXED EFFECT LIBRARY</h2>
            </div>
            <span className="text-[11px] text-[#777777]">FIXED SHADER PRESETS</span>
          </div>

          <div className="space-y-4">
            {config.rightSlots.map((slot, index) => {
              const currentMeta = EFFECT_LIBRARY.find((e) => e.id === slot.effectId);
              return (
                <div
                  key={slot.id}
                  className={`border p-4 transition-colors ${
                    slot.enabled ? 'border-[#2c2c2c] bg-[#121212]' : 'border-[#1a1a1a] bg-[#0a0a0a] opacity-50'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={slot.enabled}
                        onChange={(e) => updateRightSlot(index, { enabled: e.target.checked })}
                        className="accent-[#ff3333] cursor-pointer w-4 h-4"
                      />
                      <span className="text-xs font-bold text-[#aaaaaa]">SLOT 0{index + 1}</span>
                    </div>

                    {/* Finger Selector */}
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="text-[#666666]">FINGER:</span>
                      <select
                        value={slot.finger}
                        onChange={(e) => handleRightFingerChange(index, e.target.value as Finger)}
                        className="bg-[#181818] border border-[#333333] text-white px-2 py-0.5 rounded text-xs focus:border-[#ff3333] focus:outline-none"
                      >
                        {FINGERS.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Effect Dropdown Selector */}
                  <div className="mb-2">
                    <label className="block text-[11px] text-[#777777] uppercase mb-1">Assigned Effect</label>
                    <select
                      value={slot.effectId}
                      onChange={(e) => updateRightSlot(index, { effectId: e.target.value as EffectId })}
                      className="w-full bg-[#181818] border border-[#2a2a2a] text-white px-3 py-1.5 text-xs focus:border-[#ff3333] focus:outline-none rounded font-mono"
                    >
                      <optgroup label="MVP Production Presets">
                        {EFFECT_LIBRARY.filter((e) => e.isMvp).map((eff) => (
                          <option key={eff.id} value={eff.id}>
                            {eff.name}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Extended Fixed Presets">
                        {EFFECT_LIBRARY.filter((e) => !e.isMvp).map((eff) => (
                          <option key={eff.id} value={eff.id}>
                            {eff.name}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                  </div>

                  {/* Description & Preview Button */}
                  <div className="flex items-center justify-between pt-2 border-t border-[#1c1c1c] text-[11px] text-[#888888] gap-3">
                    <p className="flex-1 text-[11px] text-[#777777] line-clamp-1">{currentMeta?.description}</p>
                    <button
                      onClick={() =>
                        setPreviewingEffect(previewingEffect === slot.effectId ? null : slot.effectId)
                      }
                      className={`px-2.5 py-1 border rounded text-[10px] font-mono flex items-center gap-1 transition-colors ${
                        previewingEffect === slot.effectId
                          ? 'border-[#ff3333] text-white bg-[#ff3333]/20'
                          : 'border-[#333333] text-[#aaaaaa] hover:text-white bg-[#181818]'
                      }`}
                    >
                      <Sparkles className="w-3 h-3 text-[#ff3333]" />
                      <span>{previewingEffect === slot.effectId ? 'CLOSE PREVIEW' : '10s PREVIEW'}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Live Preview Modal Frame */}
          {previewingEffect && (
            <div className="border border-[#ff3333]/40 bg-[#0a0a0a] p-3 rounded mt-2">
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="text-[#ff3333] font-bold">PREVIEW // {previewingEffect.toUpperCase()}</span>
                <span className="text-[10px] text-[#666666]">Parameters fixed by design</span>
              </div>
              <canvas
                ref={previewCanvasRef}
                width={380}
                height={160}
                className="w-full h-36 bg-[#060606] rounded border border-[#222222]"
              />
            </div>
          )}

          {/* Explicit note per SPEC Section 4.3 */}
          <div className="mt-auto p-3 bg-[#0a0a0a] border border-[#1c1c1c] rounded text-[11px] text-[#666666] flex items-start gap-2">
            <HelpCircle className="w-4 h-4 text-[#ff3333] shrink-0 mt-0.5" />
            <span>
              <strong>Fixed Shader Design:</strong> Visual effects are tuned in source code for high-framerate performance. Per SPEC, internal parameters (particles, shaders, recovery curves) are locked to maintain reliable video recording aesthetics.
            </span>
          </div>
        </section>
      </main>

      {/* Error Banner if any */}
      {errorMessage && (
        <div className="max-w-7xl mx-auto px-6 mb-4 w-full">
          <div className="p-3.5 bg-[#2d0f0f] border border-[#ff3333] text-[#ff8888] text-xs rounded flex flex-col sm:flex-row items-center justify-between gap-3">
            <span>{errorMessage}</span>
            <button
              onClick={onStartDemoPerformance}
              className="px-3 py-1.5 bg-[#ff3333] hover:bg-[#ff1a1a] text-white font-bold rounded cursor-pointer shrink-0"
            >
              LAUNCH VIRTUAL STUDIO NOW &rarr;
            </button>
          </div>
        </div>
      )}

      {/* Bottom Action Sticky Footer */}
      <footer className="sticky bottom-0 z-30 border-t border-[#222222] bg-[#0c0c0c]/95 backdrop-blur-md px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-[0_-5px_20px_rgba(0,0,0,0.8)]">
        <div className="text-xs text-[#666666] flex items-center gap-2">
          <span>Jean Studio Performance Pipeline</span>
          <span>&bull;</span>
          <span>Camera Vision &amp; Virtual Simulator</span>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          {/* Quick Demo Simulator launch */}
          <button
            onClick={onStartDemoPerformance}
            disabled={isLoading}
            className="flex-1 sm:flex-none px-4 py-2.5 bg-[#1a1a1a] hover:bg-[#262626] border border-[#333333] hover:border-[#666666] disabled:opacity-50 text-white text-xs font-bold tracking-wider uppercase rounded transition-colors flex items-center justify-center gap-2 cursor-pointer"
          >
            <Sparkles className="w-4 h-4 text-[#ff3333]" />
            <span>DEMO SIMULATOR (NO CAMERA)</span>
          </button>

          {/* Primary Camera Launch */}
          <button
            onClick={onStartPerformance}
            disabled={isLoading}
            className="flex-1 sm:flex-none px-6 py-2.5 bg-[#ff3333] hover:bg-[#ff1a1a] active:bg-[#d41818] disabled:opacity-50 text-white text-xs font-bold tracking-widest uppercase flex items-center justify-center gap-2 rounded transition-all shadow-[0_0_15px_rgba(255,51,51,0.4)] cursor-pointer"
          >
            {isLoading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>{loadingMessage || 'STARTING...'}</span>
              </>
            ) : (
              <>
                <Camera className="w-4 h-4" />
                <span>START WITH CAMERA</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </footer>
    </div>
  );
};

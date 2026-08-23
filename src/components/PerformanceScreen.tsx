import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  FingercontrolConfig,
  HandType,
  Finger,
  FingertipPoint,
  EFFECT_LIBRARY,
} from '../types/config';
import { gestureRecognizer } from '../vision/gestureRecognizer';
import { visualRenderer } from '../renderer/visualRenderer';
import { audioManager } from '../utils/audio';
import {
  Sliders,
  Camera,
  Video,
  RotateCcw,
  Maximize,
  Minimize,
  Volume2,
  VolumeX,
  Eye,
  EyeOff,
  Disc,
  Play,
  Hand,
  CheckCircle2,
} from 'lucide-react';

interface PerformanceScreenProps {
  config: FingercontrolConfig;
  videoStream: MediaStream | null;
  onEditSetup: () => void;
  onUpdateConfig: (config: FingercontrolConfig) => void;
}

export const PerformanceScreen: React.FC<PerformanceScreenProps> = ({
  config,
  videoStream,
  onEditSetup,
  onUpdateConfig,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Status & Telemetry state
  const [fps, setFps] = useState<number>(60);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [leftStateLabel, setLeftStateLabel] = useState<string>('IDLE');
  const [rightStateLabel, setRightStateLabel] = useState<string>('IDLE');
  const [activeRightEffectName, setActiveRightEffectName] = useState<string | null>(null);

  // Photo 3·2·1 countdown state
  const [photoCountdown, setPhotoCountdown] = useState<number | null>(null);

  // 15s Recording state
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recSecondsLeft, setRecSecondsLeft] = useState<number>(15);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recTimerRef = useRef<number | null>(null);

  // Interactive Mouse Simulation Mode (for testing without hands/webcam)
  const [simMode, setSimMode] = useState<boolean>(false);
  const simHandRef = useRef<{
    active: boolean;
    hand: HandType;
    finger: Finger;
    pos: FingertipPoint;
  }>({
    active: false,
    hand: 'Left',
    finger: 'index',
    pos: { x: 0.3, y: 0.5 },
  });

  // Track active gestures for Left / Right
  const activeLeftSlotIdRef = useRef<string | null>(null);
  const activeRightEffectIdRef = useRef<string | null>(null);
  const isRightEffectActiveRef = useRef<boolean>(false);

  // Gesture Trigger Callback
  const handleGestureTrigger = useCallback(
    (hand: HandType, finger: Finger, pinchPos: FingertipPoint) => {
      if (hand === 'Left') {
        const slot = config.leftSlots.find((s) => s.finger === finger && s.enabled);
        if (slot) {
          activeLeftSlotIdRef.current = slot.id;
          visualRenderer.spawnFloatingText(slot.id, slot.text || 'PERFORMANCE TEXT', pinchPos.x, pinchPos.y);

          if (config.soundEnabled) {
            audioManager.playFeedbackSound('activate');
            if (slot.audioMode === 'tts') {
              audioManager.speakText(slot.text, {
                voiceURI: slot.ttsVoice,
                rate: slot.ttsRate,
                volume: slot.ttsVolume,
              });
            } else if (slot.audioMode === 'file' && slot.audioDataUrl) {
              audioManager.playAudioFile(slot.audioDataUrl, slot.ttsVolume);
            }
          }
        }
      } else if (hand === 'Right') {
        const slot = config.rightSlots.find((s) => s.finger === finger && s.enabled);
        if (slot) {
          activeRightEffectIdRef.current = slot.effectId;
          isRightEffectActiveRef.current = true;

          const meta = EFFECT_LIBRARY.find((e) => e.id === slot.effectId);
          const label = meta ? meta.shortLabel : slot.effectId.toUpperCase();
          setActiveRightEffectName(meta ? meta.name : slot.effectId);

          visualRenderer.spawnEffectBadge(label, pinchPos.x, pinchPos.y);

          if (config.soundEnabled) {
            audioManager.playFeedbackSound('activate');
          }
        }
      }
    },
    [config]
  );

  // Gesture Release Callback
  const handleGestureRelease = useCallback(
    (hand: HandType, _finger: Finger) => {
      if (hand === 'Left') {
        if (activeLeftSlotIdRef.current) {
          visualRenderer.releaseFloatingText(activeLeftSlotIdRef.current);
          activeLeftSlotIdRef.current = null;
        }
      } else if (hand === 'Right') {
        isRightEffectActiveRef.current = false;
        setActiveRightEffectName(null);
      }
    },
    []
  );

  useEffect(() => {
    gestureRecognizer.setCallbacks(handleGestureTrigger, handleGestureRelease);
  }, [handleGestureTrigger, handleGestureRelease]);

  // Connect video stream to video element
  useEffect(() => {
    if (videoRef.current && videoStream) {
      videoRef.current.srcObject = videoStream;
      videoRef.current.play().catch((e) => console.warn('Video play error:', e));
    }
  }, [videoStream]);

  // Initialize visual renderer with canvas
  useEffect(() => {
    if (canvasRef.current) {
      visualRenderer.init(canvasRef.current);
    }
  }, []);

  // Main Render & Detection Animation Loop
  useEffect(() => {
    let animId: number;
    let lastFrameTime = performance.now();
    let frameCount = 0;
    let lastFpsUpdate = performance.now();

    const loop = () => {
      const now = performance.now();
      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (video && canvas && video.readyState >= 2) {
        // Adjust canvas resolution to match video aspect
        const targetW = video.videoWidth || 1280;
        const targetH = video.videoHeight || 720;
        if (canvas.width !== targetW || canvas.height !== targetH) {
          canvas.width = targetW;
          canvas.height = targetH;
        }

        // Process Hand Detection
        let gestureData = gestureRecognizer.processVideoFrame(video, now, true);

        // If simulation mode is active, override hand
        if (simMode && simHandRef.current.active) {
          const sim = simHandRef.current;
          gestureData = {
            ...gestureData,
            [sim.hand]: {
              hand: sim.hand,
              detected: true,
              fingertips: {
                thumb: { x: sim.pos.x - 0.02, y: sim.pos.y },
                index: { x: sim.pos.x + 0.02, y: sim.pos.y },
                middle: { x: sim.pos.x + 0.05, y: sim.pos.y - 0.02 },
                ring: { x: sim.pos.x + 0.07, y: sim.pos.y - 0.01 },
                pinky: { x: sim.pos.x + 0.09, y: sim.pos.y + 0.01 },
              },
              state: 'ACTIVE',
              activeFinger: sim.finger,
              proximityDistance: 0.1,
              pinchCenter: sim.pos,
              dragOffset: { dx: 0, dy: 0 },
              holdDurationMs: 500,
              effectConfirmedTimestamp: now,
            },
          };
        }

        // Update Left Hand Floating Text follow position
        if (gestureData.Left.state === 'ACTIVE' && gestureData.Left.pinchCenter && activeLeftSlotIdRef.current) {
          visualRenderer.updateFloatingTextTarget(
            activeLeftSlotIdRef.current,
            gestureData.Left.pinchCenter.x,
            gestureData.Left.pinchCenter.y
          );
        }

        // Render Combined Canvas Frame
        visualRenderer.renderFrame(
          video,
          gestureData,
          config,
          activeRightEffectIdRef.current as any,
          isRightEffectActiveRef.current,
          now
        );

        // Update UI Telemetry states
        setLeftStateLabel(
          gestureData.Left.detected
            ? `${gestureData.Left.state}${gestureData.Left.activeFinger ? ` [${gestureData.Left.activeFinger.toUpperCase()}]` : ''}`
            : 'NO HAND'
        );
        setRightStateLabel(
          gestureData.Right.detected
            ? `${gestureData.Right.state}${gestureData.Right.activeFinger ? ` [${gestureData.Right.activeFinger.toUpperCase()}]` : ''}`
            : 'NO HAND'
        );
      }

      // Calculate FPS
      frameCount++;
      if (now - lastFpsUpdate >= 1000) {
        setFps(Math.round((frameCount * 1000) / (now - lastFpsUpdate)));
        frameCount = 0;
        lastFpsUpdate = now;
      }

      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(animId);
    };
  }, [config, simMode]);

  // RESET ACTION (SPEC Section 5.8)
  const handleReset = () => {
    gestureRecognizer.reset();
    visualRenderer.reset();
    audioManager.stopAudio();
    audioManager.playFeedbackSound('reset');
    activeLeftSlotIdRef.current = null;
    activeRightEffectIdRef.current = null;
    isRightEffectActiveRef.current = false;
    setActiveRightEffectName(null);
  };

  // PHOTO 3·2·1 COUNTDOWN & CAPTURE (SPEC Section 5.2)
  const handleStartPhotoCountdown = () => {
    if (photoCountdown !== null) return;

    let count = 3;
    setPhotoCountdown(count);
    audioManager.playFeedbackSound('countdown');

    const interval = setInterval(() => {
      count--;
      if (count > 0) {
        setPhotoCountdown(count);
        audioManager.playFeedbackSound('countdown');
      } else {
        clearInterval(interval);
        setPhotoCountdown(null);
        takeSnapshot();
      }
    }, 1000);
  };

  const takeSnapshot = () => {
    if (!canvasRef.current) return;
    audioManager.playFeedbackSound('shutter');

    const link = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    link.download = `fingercontrol-snapshot-${timestamp}.png`;
    link.href = canvasRef.current.toDataURL('image/png');
    link.click();
  };

  // REC 15s TIMED VIDEO RECORDING (SPEC Section 5.2)
  const handleStartRecording = () => {
    if (isRecording || !canvasRef.current) return;

    recordedChunksRef.current = [];
    try {
      const stream = canvasRef.current.captureStream(30);

      // Add audio track from AudioManager if available
      const audioStream = audioManager.getMediaStream();
      if (audioStream && audioStream.getAudioTracks().length > 0) {
        audioStream.getAudioTracks().forEach((track) => stream.addTrack(track));
      }

      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : 'video/webm';

      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6000000 });

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        a.download = `fingercontrol-performance-15s-${timestamp}.webm`;
        a.href = url;
        a.click();
        URL.revokeObjectURL(url);
        setIsRecording(false);
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecSecondsLeft(15);
      audioManager.playFeedbackSound('activate');

      let remaining = 15;
      recTimerRef.current = window.setInterval(() => {
        remaining--;
        setRecSecondsLeft(remaining);
        if (remaining <= 0) {
          if (recTimerRef.current) clearInterval(recTimerRef.current);
          recorder.stop();
        }
      }, 1000);
    } catch (err) {
      console.error('MediaRecorder start error:', err);
      setIsRecording(false);
    }
  };

  const handleStopRecordingEarly = () => {
    if (mediaRecorderRef.current && isRecording) {
      if (recTimerRef.current) clearInterval(recTimerRef.current);
      mediaRecorderRef.current.stop();
    }
  };

  // FULLSCREEN TOGGLE
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  // Interactive Simulation Canvas Mouse Handlers
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!simMode || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    // Left half = left hand, Right half = right hand
    const hand: HandType = x < 0.5 ? 'Left' : 'Right';
    const finger: Finger = 'index';

    simHandRef.current = {
      active: true,
      hand,
      finger,
      pos: { x, y },
    };

    handleGestureTrigger(hand, finger, { x, y });
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!simMode || !simHandRef.current.active || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    simHandRef.current.pos = { x, y };
  };

  const handleCanvasMouseUp = () => {
    if (!simMode || !simHandRef.current.active) return;
    const { hand, finger } = simHandRef.current;
    simHandRef.current.active = false;
    handleGestureRelease(hand, finger);
  };

  return (
    <div
      ref={containerRef}
      className="relative w-screen h-screen bg-[#080808] overflow-hidden select-none font-mono text-white flex flex-col"
    >
      {/* Hidden Video Source */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className="hidden"
      />

      {/* TOP TOOLBAR (SPEC Section 5.2) */}
      <header className="absolute top-0 left-0 right-0 z-40 bg-gradient-to-b from-black/90 via-black/50 to-transparent px-6 py-4 flex items-center justify-between pointer-events-auto">
        {/* Left Actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={onEditSetup}
            className="px-3.5 py-1.5 bg-[#141414]/90 hover:bg-[#202020] border border-[#333333] hover:border-[#666666] text-white text-xs font-bold tracking-wider rounded transition-colors flex items-center gap-1.5 shadow-lg cursor-pointer"
          >
            <Sliders className="w-3.5 h-3.5 text-[#ff3333]" />
            <span>EDIT SETUP</span>
          </button>

          <button
            onClick={handleReset}
            className="px-3.5 py-1.5 bg-[#141414]/90 hover:bg-[#202020] border border-[#333333] hover:border-[#ff3333]/60 text-[#cccccc] hover:text-white text-xs font-bold tracking-wider rounded transition-colors flex items-center gap-1.5 shadow-lg cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5 text-[#ff3333]" />
            <span>RESET</span>
          </button>
        </div>

        {/* Center Performance Badges */}
        <div className="flex items-center gap-4 text-xs bg-[#101010]/80 border border-[#262626] px-4 py-1.5 rounded-full backdrop-blur-md">
          <div className="flex items-center gap-2">
            <span className="text-[#666666]">L-HAND:</span>
            <span
              className={`font-semibold ${
                leftStateLabel.includes('ACTIVE') ? 'text-[#ff3333] animate-pulse' : 'text-[#aaaaaa]'
              }`}
            >
              {leftStateLabel}
            </span>
          </div>

          <div className="w-px h-3.5 bg-[#333333]" />

          <div className="flex items-center gap-2">
            <span className="text-[#666666]">R-HAND:</span>
            <span
              className={`font-semibold ${
                rightStateLabel.includes('ACTIVE') ? 'text-[#ff3333] animate-pulse' : 'text-[#aaaaaa]'
              }`}
            >
              {rightStateLabel}
            </span>
          </div>

          {activeRightEffectName && (
            <>
              <div className="w-px h-3.5 bg-[#333333]" />
              <div className="text-[#ff3333] font-bold tracking-widest text-[11px] animate-pulse">
                [{activeRightEffectName}]
              </div>
            </>
          )}
        </div>

        {/* Right Actions: Photo, Rec, Fullscreen */}
        <div className="flex items-center gap-3">
          {/* Photo 3·2·1 */}
          <button
            onClick={handleStartPhotoCountdown}
            disabled={photoCountdown !== null}
            className="px-3 py-1.5 bg-[#141414]/90 hover:bg-[#202020] border border-[#333333] hover:border-white text-white text-xs font-bold tracking-wider rounded transition-colors flex items-center gap-1.5 shadow-lg cursor-pointer"
          >
            <Camera className="w-3.5 h-3.5 text-[#ff3333]" />
            <span>{photoCountdown !== null ? `SNAP IN ${photoCountdown}...` : 'PHOTO 3·2·1'}</span>
          </button>

          {/* REC 15s */}
          <button
            onClick={isRecording ? handleStopRecordingEarly : handleStartRecording}
            className={`px-3.5 py-1.5 border text-xs font-bold tracking-wider rounded transition-all flex items-center gap-2 shadow-lg cursor-pointer ${
              isRecording
                ? 'bg-[#ff3333] text-white border-[#ff3333] animate-pulse'
                : 'bg-[#141414]/90 hover:bg-[#202020] border-[#333333] text-white'
            }`}
          >
            <Disc className={`w-3.5 h-3.5 ${isRecording ? 'text-white' : 'text-[#ff3333]'}`} />
            <span>{isRecording ? `REC [${recSecondsLeft}s]` : 'REC 15s'}</span>
          </button>

          {/* Quick Tracking Toggle */}
          <button
            onClick={() => onUpdateConfig({ ...config, trackingVisible: !config.trackingVisible })}
            className="p-1.5 bg-[#141414]/90 hover:bg-[#202020] border border-[#333333] text-[#cccccc] hover:text-white rounded"
            title="Toggle Tracking Points"
          >
            {config.trackingVisible ? <Eye className="w-4 h-4 text-[#ff3333]" /> : <EyeOff className="w-4 h-4" />}
          </button>

          {/* Quick Audio Toggle */}
          <button
            onClick={() => onUpdateConfig({ ...config, soundEnabled: !config.soundEnabled })}
            className="p-1.5 bg-[#141414]/90 hover:bg-[#202020] border border-[#333333] text-[#cccccc] hover:text-white rounded"
            title="Toggle Audio Feedback"
          >
            {config.soundEnabled ? <Volume2 className="w-4 h-4 text-[#ff3333]" /> : <VolumeX className="w-4 h-4" />}
          </button>

          {/* Fullscreen */}
          <button
            onClick={toggleFullscreen}
            className="p-1.5 bg-[#141414]/90 hover:bg-[#202020] border border-[#333333] text-[#cccccc] hover:text-white rounded"
            title="Fullscreen Toggle"
          >
            {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* Primary Composite Visual Canvas Stage */}
      <main className="flex-1 w-full h-full flex items-center justify-center relative bg-[#080808]">
        <canvas
          ref={canvasRef}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          className="w-full h-full object-contain cursor-crosshair"
        />

        {/* Photo Countdown Big Screen Overlay */}
        {photoCountdown !== null && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 z-50 pointer-events-none">
            <div className="text-9xl font-extrabold text-white tracking-tighter drop-shadow-[0_0_30px_#ff3333] animate-ping">
              {photoCountdown}
            </div>
          </div>
        )}

        {/* Recording Visual Border Indicator */}
        {isRecording && (
          <div className="absolute inset-0 pointer-events-none border-4 border-[#ff3333]/80 z-30 flex flex-col justify-between p-4">
            <div className="flex items-center justify-between text-xs bg-black/70 px-4 py-2 rounded self-center border border-[#ff3333]/40 backdrop-blur-sm">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-[#ff3333] rounded-full animate-ping" />
                <span className="font-bold tracking-widest text-[#ff3333]">RECORDING PERFORMANCE</span>
              </div>
              <span className="ml-4 font-mono font-bold text-white text-sm">{recSecondsLeft}s remaining</span>
            </div>
          </div>
        )}
      </main>

      {/* Bottom Status Bar & Simulation Mode Toggle */}
      <footer className="absolute bottom-0 left-0 right-0 z-40 bg-gradient-to-t from-black/80 to-transparent px-6 py-3 flex items-center justify-between text-[11px] text-[#777777] pointer-events-auto">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 bg-[#22c55e] rounded-full" />
            <span>RENDER FPS: <strong className="text-white font-mono">{fps}</strong></span>
          </div>

          <div className="hidden sm:flex items-center gap-2 text-[#666666]">
            <span>MIRRORED VIEW</span>
            <span>&bull;</span>
            <span>PINCH THUMB + FINGER TO TRIGGER</span>
          </div>
        </div>

        {/* Simulation / Mouse Test Mode Fallback */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSimMode(!simMode)}
            className={`px-2.5 py-1 rounded border text-[10px] font-mono flex items-center gap-1.5 transition-colors cursor-pointer ${
              simMode
                ? 'border-[#ff3333] bg-[#ff3333]/20 text-white font-bold'
                : 'border-[#333333] bg-[#111111]/80 text-[#888888] hover:text-white'
            }`}
          >
            <Hand className="w-3 h-3 text-[#ff3333]" />
            <span>MOUSE PINCH SIM: {simMode ? 'ON (CLICK & DRAG)' : 'OFF'}</span>
          </button>
        </div>
      </footer>
    </div>
  );
};

import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  FingercontrolConfig,
  ContentSlot,
  GestureEvent,
  VideoAnalysisFrame,
  Hand,
  HandGestureData,
} from '../types/config';
import { gestureRecognizer } from '../vision/gestureRecognizer';
import { visualRenderer, VisualRenderer } from '../renderer/visualRenderer';
import { audioManager } from '../utils/audio';
import {
  ArrowLeft,
  Play,
  Pause,
  Download,
  RotateCcw,
  Video as VideoIcon,
  Circle,
  Eye,
  EyeOff,
  FlipHorizontal,
  Trash2,
  CheckCircle2,
  Clock,
} from 'lucide-react';

interface PerformanceScreenProps {
  inputMode: 'CAMERA' | 'UPLOAD_VIDEO';
  config: FingercontrolConfig;
  onUpdateConfig: (newConfig: FingercontrolConfig) => void;
  onBackToSetup: () => void;
  // Camera mode props
  cameraStream: MediaStream | null;
  // Video mode props
  displayVideoUrl: string | null;
  gestureEvents: GestureEvent[];
  onUpdateGestureEvents: (events: GestureEvent[]) => void;
  analysisFrames: VideoAnalysisFrame[];
  onReanalyze: () => void;
}

export const PerformanceScreen: React.FC<PerformanceScreenProps> = ({
  inputMode,
  config,
  onUpdateConfig,
  onBackToSetup,
  cameraStream,
  displayVideoUrl,
  gestureEvents,
  onUpdateGestureEvents,
  analysisFrames,
  onReanalyze,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hiddenVideoRef = useRef<HTMLVideoElement | null>(null);

  // Playback state (for video mode)
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);

  // Recording state (for camera mode)
  const [isRecordingCamera, setIsRecordingCamera] = useState<boolean>(false);
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  // Export state (for upload video mode)
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportProgress, setExportProgress] = useState<number>(0);
  const [exportStatus, setExportStatus] = useState<string>('');

  // Selected event in timeline (for inspection or deletion)
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  // Audio triggering tracker to avoid duplicate triggers during playback
  const triggeredEventIdsRef = useRef<Set<string>>(new Set());

  // Slot lookup
  const getSlot = useCallback(
    (hand: Hand, finger: string): ContentSlot | undefined => {
      return config.slots.find((s) => s.hand === hand && s.finger === finger);
    },
    [config.slots]
  );

  // ==========================================
  // CAMERA MODE LOOP
  // ==========================================
  useEffect(() => {
    if (inputMode !== 'CAMERA') return;

    const canvas = canvasRef.current;
    const video = hiddenVideoRef.current;
    if (!canvas || !video) return;

    visualRenderer.init(canvas);
    visualRenderer.reset();
    gestureRecognizer.reset();

    // Set real-time gesture triggers
    gestureRecognizer.setCallbacks(
      (hand, finger, pinchPos) => {
        const slot = getSlot(hand, finger);
        const text = slot?.text || finger.toUpperCase();
        const slotId = `${hand}-${finger}`;

        visualRenderer.spawnFloatingText(slotId, hand, text, pinchPos.x, pinchPos.y);

        // Play real audio file if present
        if (slot?.audioBuffer) {
          audioManager.triggerAudio(slot.audioBuffer);
        }
      },
      (hand, finger) => {
        const slotId = `${hand}-${finger}`;
        visualRenderer.releaseFloatingText(slotId);
      }
    );

    let animationFrameId: number;

    const renderLoop = (time: number) => {
      if (video.readyState >= 2) {
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth || 1280;
          canvas.height = video.videoHeight || 720;
        }

        // Process hand landmarks & gestures
        const gestureData = gestureRecognizer.processVideoFrame(video, time, config.mirroredVideo);

        // Update target positions for active pinches
        for (const handKey of ['left', 'right'] as Hand[]) {
          const handData = gestureData[handKey];
          if (handData.state === 'ACTIVE' && handData.activeFinger && handData.pinchCenter) {
            const slotId = `${handKey}-${handData.activeFinger}`;
            visualRenderer.updateFloatingTextTarget(slotId, handData.pinchCenter.x, handData.pinchCenter.y);
          }
        }

        // Draw composite frame
        visualRenderer.renderFrame(video, gestureData, config.trackingVisible, time);
      }

      animationFrameId = requestAnimationFrame(renderLoop);
    };

    animationFrameId = requestAnimationFrame(renderLoop);

    return () => {
      cancelAnimationFrame(animationFrameId);
      audioManager.stopAll();
    };
  }, [inputMode, config.mirroredVideo, config.trackingVisible, getSlot]);

  // Set camera stream source
  useEffect(() => {
    if (inputMode === 'CAMERA' && hiddenVideoRef.current && cameraStream) {
      hiddenVideoRef.current.srcObject = cameraStream;
      hiddenVideoRef.current.play().catch(console.warn);
    }
  }, [inputMode, cameraStream]);

  // Camera recording timer
  useEffect(() => {
    let timer: number;
    if (isRecordingCamera) {
      setRecordingSeconds(0);
      timer = window.setInterval(() => {
        setRecordingSeconds((s) => s + 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [isRecordingCamera]);

  // Start Camera Recording
  const handleStartCameraRecording = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const canvasStream = canvas.captureStream(30);
    const audioStream = audioManager.getMediaStream();

    const combinedTracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()];
    if (audioStream) {
      combinedTracks.push(...audioStream.getAudioTracks());
    }

    const combinedStream = new MediaStream(combinedTracks);

    // Format selection
    let mimeType = 'video/webm;codecs=vp9,opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm;codecs=vp8,opus';
    }
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm';
    }

    recordedChunksRef.current = [];
    const recorder = new MediaRecorder(combinedStream, { mimeType });

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        recordedChunksRef.current.push(e.data);
      }
    };

    recorder.onstop = () => {
      const blob = new Blob(recordedChunksRef.current, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fingercontrol-camera-${Date.now()}.webm`;
      a.click();
      URL.revokeObjectURL(url);
    };

    recorder.start(250);
    mediaRecorderRef.current = recorder;
    setIsRecordingCamera(true);
  };

  // Stop Camera Recording
  const handleStopCameraRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecordingCamera(false);
  };

  // ==========================================
  // UPLOAD VIDEO MODE PLAYBACK & PREVIEW LOOP
  // ==========================================
  useEffect(() => {
    if (inputMode !== 'UPLOAD_VIDEO') return;

    const canvas = canvasRef.current;
    const video = hiddenVideoRef.current;
    if (!canvas || !video) return;

    visualRenderer.init(canvas);
    visualRenderer.reset();

    let animationFrameId: number;

    const previewLoop = (time: number) => {
      if (video.readyState >= 2) {
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth || 1280;
          canvas.height = video.videoHeight || 720;
        }

        const vTime = video.currentTime;
        setCurrentTime(vTime);

        // Find closest analysis frame
        let closestFrame: VideoAnalysisFrame | null = null;
        if (analysisFrames.length > 0) {
          // Binary search or nearest lookup
          let minDiff = Infinity;
          for (const f of analysisFrames) {
            const diff = Math.abs(f.timestamp - vTime);
            if (diff < minDiff) {
              minDiff = diff;
              closestFrame = f;
            }
            if (diff > minDiff && minDiff < 0.1) break;
          }
        }

        const defaultHand = (hand: Hand): HandGestureData => ({
          hand,
          detected: false,
          fingertips: {
            thumb: { x: 0, y: 0 },
            index: { x: 0, y: 0 },
            middle: { x: 0, y: 0 },
            ring: { x: 0, y: 0 },
            pinky: { x: 0, y: 0 },
          },
          state: 'IDLE',
          activeFinger: null,
          proximityDistance: 1.0,
          pinchCenter: null,
          dragOffset: { dx: 0, dy: 0 },
          holdDurationMs: 0,
          triggerTimestamp: 0,
        });

        const gestureData = {
          left: closestFrame?.leftHand || defaultHand('left'),
          right: closestFrame?.rightHand || defaultHand('right'),
        };

        // Check active events at this timestamp
        for (const ev of gestureEvents) {
          const isActive = vTime >= ev.startTime && vTime <= ev.releaseTime;
          const slotId = `${ev.hand}-${ev.finger}`;

          if (isActive) {
            // Spawn / update floating text
            visualRenderer.spawnFloatingText(slotId, ev.hand, ev.text, ev.x, ev.y);

            // Trigger audio once per event
            if (!triggeredEventIdsRef.current.has(ev.id)) {
              triggeredEventIdsRef.current.add(ev.id);
              const slot = getSlot(ev.hand, ev.finger);
              if (slot?.audioBuffer) {
                audioManager.triggerAudio(slot.audioBuffer);
              }
            }
          } else {
            // Release if previously active
            if (vTime > ev.releaseTime && vTime < ev.releaseTime + 0.6) {
              visualRenderer.releaseFloatingText(slotId);
            }
          }
        }

        // Draw composite frame
        visualRenderer.renderFrame(video, gestureData, config.trackingVisible, time);
      }

      animationFrameId = requestAnimationFrame(previewLoop);
    };

    animationFrameId = requestAnimationFrame(previewLoop);

    return () => {
      cancelAnimationFrame(animationFrameId);
      audioManager.stopAll();
    };
  }, [inputMode, analysisFrames, gestureEvents, config.trackingVisible, getSlot]);

  // Video metadata load
  const handleVideoLoadedMetadata = () => {
    if (hiddenVideoRef.current) {
      setDuration(hiddenVideoRef.current.duration || 0);
      if (isPlaying) {
        hiddenVideoRef.current.play().catch(console.warn);
      }
    }
  };

  // Play / Pause toggle
  const togglePlayPause = () => {
    if (!hiddenVideoRef.current) return;
    if (isPlaying) {
      hiddenVideoRef.current.pause();
      setIsPlaying(false);
    } else {
      hiddenVideoRef.current.play().catch(console.warn);
      setIsPlaying(true);
    }
  };

  // Seek handler
  const handleSeek = (newTime: number) => {
    if (hiddenVideoRef.current) {
      hiddenVideoRef.current.currentTime = newTime;
      setCurrentTime(newTime);
      // Reset triggered events cache beyond current time
      triggeredEventIdsRef.current.clear();
      for (const ev of gestureEvents) {
        if (ev.startTime < newTime) {
          triggeredEventIdsRef.current.add(ev.id);
        }
      }
    }
  };

  // Delete an event
  const handleDeleteEvent = (id: string) => {
    const nextEvents = gestureEvents.filter((ev) => ev.id !== id);
    onUpdateGestureEvents(nextEvents);
    if (selectedEventId === id) {
      setSelectedEventId(null);
    }
  };

  // ==========================================
  // EXPORT VIDEO IMPLEMENTATION
  // ==========================================
  const handleExportUploadedVideo = async () => {
    const video = hiddenVideoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || isExporting) return;

    setIsExporting(true);
    setExportProgress(0);
    setExportStatus('PREPARING EXPORT RENDERER...');

    // Pause current preview playback
    video.pause();
    setIsPlaying(false);
    audioManager.stopAll();

    const originalTime = video.currentTime;
    const totalDuration = video.duration || duration;
    const exportFps = 30;
    const interval = 1 / exportFps;
    const totalFrames = Math.ceil(totalDuration * exportFps);

    // Setup export canvas
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = video.videoWidth || 1280;
    exportCanvas.height = video.videoHeight || 720;
    const dedicatedRenderer = new VisualRenderer();
    dedicatedRenderer.init(exportCanvas);

    // Setup audio destination
    const ctx = audioManager.getAudioContext();
    const destNode = ctx.createMediaStreamDestination();

    // Setup MediaRecorder
    const canvasStream = exportCanvas.captureStream(exportFps);
    const exportStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...destNode.stream.getAudioTracks(),
    ]);

    let mimeType = 'video/webm;codecs=vp9,opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm;codecs=vp8,opus';
    }
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm';
    }

    const recordedBlobs: Blob[] = [];
    const recorder = new MediaRecorder(exportStream, { mimeType });
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        recordedBlobs.push(e.data);
      }
    };

    recorder.start();

    // Map gesture events for audio scheduling
    const triggeredAudioEvents = new Set<string>();

    // Step frame by frame
    for (let i = 0; i < totalFrames; i++) {
      const targetTime = Math.min(i * interval, totalDuration);
      video.currentTime = targetTime;

      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked);
          resolve();
        };
        video.addEventListener('seeked', onSeeked, { once: true });
      });

      // Find analysis frame
      let closestFrame: VideoAnalysisFrame | null = null;
      let minDiff = Infinity;
      for (const f of analysisFrames) {
        const diff = Math.abs(f.timestamp - targetTime);
        if (diff < minDiff) {
          minDiff = diff;
          closestFrame = f;
        }
        if (diff > minDiff && minDiff < 0.1) break;
      }

      const defaultHand = (hand: Hand): HandGestureData => ({
        hand,
        detected: false,
        fingertips: {
          thumb: { x: 0, y: 0 },
          index: { x: 0, y: 0 },
          middle: { x: 0, y: 0 },
          ring: { x: 0, y: 0 },
          pinky: { x: 0, y: 0 },
        },
        state: 'IDLE',
        activeFinger: null,
        proximityDistance: 1.0,
        pinchCenter: null,
        dragOffset: { dx: 0, dy: 0 },
        holdDurationMs: 0,
        triggerTimestamp: 0,
      });

      const gestureData = {
        left: closestFrame?.leftHand || defaultHand('left'),
        right: closestFrame?.rightHand || defaultHand('right'),
      };

      const nowMs = targetTime * 1000;

      // Check active events
      for (const ev of gestureEvents) {
        const isActive = targetTime >= ev.startTime && targetTime <= ev.releaseTime;
        const slotId = `${ev.hand}-${ev.finger}`;

        if (isActive) {
          dedicatedRenderer.spawnFloatingText(slotId, ev.hand, ev.text, ev.x, ev.y);

          // Trigger audio into destNode
          if (!triggeredAudioEvents.has(ev.id)) {
            triggeredAudioEvents.add(ev.id);
            const slot = getSlot(ev.hand, ev.finger);
            if (slot?.audioBuffer) {
              const src = ctx.createBufferSource();
              src.buffer = slot.audioBuffer;
              src.connect(destNode);
              src.start();
            }
          }
        } else if (targetTime > ev.releaseTime) {
          dedicatedRenderer.releaseFloatingText(slotId);
        }
      }

      // Render frame
      dedicatedRenderer.renderFrame(video, gestureData, config.trackingVisible, nowMs);

      const progress = Math.min(100, Math.round(((i + 1) / totalFrames) * 100));
      setExportProgress(progress);
      setExportStatus(`SYNTHESIZING & EXPORTING ${progress}% (${targetTime.toFixed(1)}s / ${totalDuration.toFixed(1)}s)`);

      // Yield
      await new Promise((r) => setTimeout(r, 10));
    }

    // Finish recording
    recorder.onstop = () => {
      const finalBlob = new Blob(recordedBlobs, { type: mimeType });
      const downloadUrl = URL.createObjectURL(finalBlob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `fingercontrol-export-${Date.now()}.webm`;
      a.click();
      URL.revokeObjectURL(downloadUrl);

      setIsExporting(false);
      video.currentTime = originalTime;
    };

    recorder.stop();
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    const ms = Math.floor((secs % 1) * 10);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms}`;
  };

  return (
    <div className="min-h-screen bg-[#07111F] text-[#E0E6ED] flex flex-col font-mono select-none">
      
      {/* Top Bar */}
      <header className="h-14 border-b border-[#1E2E42] bg-[#0C1929] px-4 flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              audioManager.stopAll();
              onBackToSetup();
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#07111F] hover:bg-[#152336] border border-[#1E2E42] text-xs uppercase font-medium text-white transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            BACK TO SETUP
          </button>

          <div className="h-4 w-px bg-[#1E2E42]" />

          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#FF0000] inline-block"></span>
            <span className="font-bold text-xs uppercase text-white tracking-widest">
              FINGERCONTROL
            </span>
            <span className="text-[10px] text-[#8A9BA8] bg-[#07111F] border border-[#1E2E42] px-2 py-0.5 rounded uppercase">
              {inputMode === 'CAMERA' ? 'LIVE CAMERA' : 'VIDEO PREVIEW'}
            </span>
          </div>
        </div>

        {/* Right Header Controls */}
        <div className="flex items-center gap-3">
          {/* Tracking toggle */}
          <button
            onClick={() => onUpdateConfig({ ...config, trackingVisible: !config.trackingVisible })}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs uppercase font-medium border transition-colors ${
              config.trackingVisible
                ? 'bg-[#152336] border-[#FF0000]/50 text-white'
                : 'bg-[#07111F] border-[#1E2E42] text-[#8A9BA8]'
            }`}
            title="Toggle Tracking Overlay"
          >
            {config.trackingVisible ? <Eye className="w-3.5 h-3.5 text-[#FF0000]" /> : <EyeOff className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">TRACKING</span>
          </button>

          {/* Mirror toggle */}
          <button
            onClick={() => onUpdateConfig({ ...config, mirroredVideo: !config.mirroredVideo })}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs uppercase font-medium border transition-colors ${
              config.mirroredVideo
                ? 'bg-[#152336] border-[#2A4365] text-white'
                : 'bg-[#07111F] border-[#1E2E42] text-[#8A9BA8]'
            }`}
            title="Toggle Mirror"
          >
            <FlipHorizontal className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">MIRROR</span>
          </button>

          {/* Camera Mode: Record Button */}
          {inputMode === 'CAMERA' && (
            <button
              onClick={isRecordingCamera ? handleStopCameraRecording : handleStartCameraRecording}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded text-xs font-bold uppercase tracking-wider transition-colors shadow-sm ${
                isRecordingCamera
                  ? 'bg-[#FF0000] text-white animate-pulse'
                  : 'bg-[#FF0000] hover:bg-[#E60000] text-white'
              }`}
            >
              <Circle className="w-3.5 h-3.5 fill-current" />
              {isRecordingCamera ? `REC (${recordingSeconds}s)` : 'RECORD'}
            </button>
          )}

          {/* Upload Video Mode: Reanalyze & Export Buttons */}
          {inputMode === 'UPLOAD_VIDEO' && (
            <>
              <button
                onClick={onReanalyze}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#07111F] hover:bg-[#152336] border border-[#1E2E42] text-xs uppercase font-medium text-white transition-colors"
                title="Re-run Hand Detection Analysis"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">REANALYZE</span>
              </button>

              <button
                onClick={handleExportUploadedVideo}
                disabled={isExporting}
                className="flex items-center gap-2 px-4 py-1.5 rounded bg-[#FF0000] hover:bg-[#E60000] disabled:bg-[#4A1515] text-white text-xs font-bold uppercase tracking-wider transition-colors shadow-sm"
              >
                <Download className="w-3.5 h-3.5" />
                EXPORT VIDEO
              </button>
            </>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col items-center justify-center p-4 bg-[#050C16] relative overflow-hidden">
        
        {/* Hidden video element for feed decoding */}
        <video
          ref={hiddenVideoRef}
          src={inputMode === 'UPLOAD_VIDEO' ? displayVideoUrl || undefined : undefined}
          onLoadedMetadata={handleVideoLoadedMetadata}
          playsInline
          muted
          loop={inputMode === 'UPLOAD_VIDEO'}
          className="hidden"
        />

        {/* Master Composition Canvas */}
        <div className="relative max-w-full max-h-[75vh] flex items-center justify-center rounded-lg border border-[#1E2E42] bg-[#000000] shadow-2xl overflow-hidden">
          <canvas
            ref={canvasRef}
            className="max-w-full max-h-[75vh] object-contain block"
          />

          {/* Export Overlay Modal */}
          {isExporting && (
            <div className="absolute inset-0 bg-[#07111F]/90 backdrop-blur-sm flex flex-col items-center justify-center p-6 z-20">
              <div className="w-full max-w-sm space-y-3 text-center">
                <span className="w-3 h-3 rounded-full bg-[#FF0000] inline-block animate-ping"></span>
                <h3 className="text-sm font-bold text-white uppercase tracking-widest">
                  SYNTHESIZING FINAL VIDEO
                </h3>
                <p className="text-xs text-[#8A9BA8]">{exportStatus}</p>

                <div className="w-full h-2.5 bg-[#0C1929] border border-[#1E2E42] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#FF0000] transition-all duration-100"
                    style={{ width: `${exportProgress}%` }}
                  />
                </div>
                <div className="text-xs text-white font-bold">{exportProgress}%</div>
              </div>
            </div>
          )}
        </div>

        {/* Upload Mode: Interactive Playback & Event Timeline */}
        {inputMode === 'UPLOAD_VIDEO' && (
          <div className="w-full max-w-4xl mt-3 bg-[#0C1929] border border-[#1E2E42] rounded-md p-3 space-y-2 text-xs">
            {/* Timeline Controls */}
            <div className="flex items-center gap-3">
              <button
                onClick={togglePlayPause}
                className="p-2 rounded bg-[#07111F] hover:bg-[#152336] border border-[#1E2E42] text-white transition-colors"
                title={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </button>

              <span className="text-[11px] font-mono text-[#8A9BA8] shrink-0">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>

              {/* Progress Slider with Events */}
              <div className="relative flex-1 flex items-center h-6">
                <input
                  type="range"
                  min={0}
                  max={duration || 1}
                  step={0.01}
                  value={currentTime}
                  onChange={(e) => handleSeek(parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-[#07111F] rounded-lg appearance-none cursor-pointer accent-[#FF0000]"
                />

                {/* Event Markers along Timeline */}
                {duration > 0 &&
                  gestureEvents.map((ev) => {
                    const leftPct = (ev.startTime / duration) * 100;
                    const isSelected = selectedEventId === ev.id;
                    return (
                      <div
                        key={ev.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedEventId(ev.id);
                          handleSeek(ev.startTime);
                        }}
                        style={{ left: `${leftPct}%` }}
                        className={`absolute top-0 w-2 h-6 -ml-1 cursor-pointer transition-all ${
                          isSelected
                            ? 'bg-white z-10 ring-2 ring-[#FF0000]'
                            : 'bg-[#FF0000] hover:bg-white hover:scale-125 opacity-80'
                        }`}
                        title={`${ev.hand.toUpperCase()} ${ev.finger.toUpperCase()}: "${ev.text}" at ${ev.startTime.toFixed(2)}s`}
                      />
                    );
                  })}
              </div>

              <span className="text-[10px] text-[#8A9BA8] uppercase shrink-0">
                {gestureEvents.length} DETECTED EVENTS
              </span>
            </div>

            {/* Selected Event Details & Deletion */}
            {selectedEventId && (
              <div className="flex items-center justify-between bg-[#07111F] border border-[#1E2E42] px-3 py-1.5 rounded text-[11px]">
                {(() => {
                  const ev = gestureEvents.find((e) => e.id === selectedEventId);
                  if (!ev) return null;
                  return (
                    <>
                      <div className="flex items-center gap-3">
                        <span className="text-[#FF0000] font-bold uppercase">
                          [{ev.hand.toUpperCase()} {ev.finger.toUpperCase()}]
                        </span>
                        <span className="text-white font-medium">"{ev.text}"</span>
                        <span className="text-[#8A9BA8] flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {ev.startTime.toFixed(2)}s - {ev.releaseTime.toFixed(2)}s
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleDeleteEvent(ev.id)}
                          className="text-[#8A9BA8] hover:text-[#FF0000] flex items-center gap-1 transition-colors"
                          title="Delete False Trigger"
                        >
                          <Trash2 className="w-3 h-3" /> DELETE EVENT
                        </button>
                      </div>
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
};

import React, { useState, useEffect, useCallback } from 'react';
import { FingercontrolConfig } from './types/config';
import { loadConfig, saveConfig } from './utils/storage';
import { SetupScreen } from './components/SetupScreen';
import { PerformanceScreen } from './components/PerformanceScreen';
import { gestureRecognizer } from './vision/gestureRecognizer';
import { personSegmentation } from './vision/segmentation';
import { audioManager } from './utils/audio';

// Helper for generating a virtual synthetic performer video stream
export function createSyntheticVideoStream(): MediaStream {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d')!;

  let frame = 0;
  const drawSyntheticPerformer = () => {
    frame++;
    const w = canvas.width;
    const h = canvas.height;
    const t = frame * 0.03;

    // Dark stage background with subtle studio gradient
    const bgGrad = ctx.createRadialGradient(w / 2, h / 2, 80, w / 2, h / 2, w / 1.4);
    bgGrad.addColorStop(0, '#1c1c1c');
    bgGrad.addColorStop(1, '#050505');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // Subtle ambient grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 60) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += 60) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Performer head and torso silhouette
    const cx = w / 2 + Math.sin(t * 0.5) * 15;
    const cy = h / 2 + Math.cos(t * 0.3) * 8;

    // Torso
    ctx.fillStyle = '#222224';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 180, 160, 220, 0, 0, Math.PI * 2);
    ctx.fill();

    // Neck
    ctx.fillStyle = '#444448';
    ctx.fillRect(cx - 30, cy + 40, 60, 80);

    // Head
    ctx.fillStyle = '#55555c';
    ctx.beginPath();
    ctx.ellipse(cx, cy - 20, 90, 115, 0, 0, Math.PI * 2);
    ctx.fill();

    // Hands in motion (left and right)
    const leftHandX = cx - 220 + Math.cos(t * 0.8) * 30;
    const leftHandY = cy + 60 + Math.sin(t * 0.8) * 40;
    const rightHandX = cx + 220 + Math.sin(t * 0.8) * 30;
    const rightHandY = cy + 60 + Math.cos(t * 0.8) * 40;

    // Left hand
    ctx.fillStyle = '#666670';
    ctx.beginPath();
    ctx.arc(leftHandX, leftHandY, 45, 0, Math.PI * 2);
    ctx.fill();

    // Right hand
    ctx.fillStyle = '#666670';
    ctx.beginPath();
    ctx.arc(rightHandX, rightHandY, 45, 0, Math.PI * 2);
    ctx.fill();

    requestAnimationFrame(drawSyntheticPerformer);
  };

  requestAnimationFrame(drawSyntheticPerformer);
  return canvas.captureStream(30);
}

export const App: React.FC = () => {
  const [currentScreen, setCurrentScreen] = useState<'SETUP' | 'PERFORMANCE'>('SETUP');
  const [config, setConfig] = useState<FingercontrolConfig>(() => loadConfig());

  // Camera & Device State
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const [isVirtualCamera, setIsVirtualCamera] = useState<boolean>(false);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');

  // Loading & Error States
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingMessage, setLoadingMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Enumerate cameras
  const refreshDevices = useCallback(async () => {
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const vDevices = devices.filter((d) => d.kind === 'videoinput');
        setVideoDevices(vDevices);
        if (vDevices.length > 0 && !selectedDeviceId) {
          setSelectedDeviceId(vDevices[0].deviceId);
        }
      }
    } catch (e) {
      console.warn('Error enumerating devices:', e);
    }
  }, [selectedDeviceId]);

  useEffect(() => {
    refreshDevices();
  }, [refreshDevices]);

  // Persist config changes
  const handleUpdateConfig = (newConfig: FingercontrolConfig) => {
    setConfig(newConfig);
    saveConfig(newConfig);
  };

  // Launch Performance Mode (Real Camera or Fallback)
  const handleStartPerformance = async (useDemo: boolean = false) => {
    setIsLoading(true);
    setErrorMessage(null);
    setLoadingMessage('INITIALIZING AUDIO SYSTEM...');

    // 1. Initialize Audio Context on user click
    try {
      audioManager.initAudioContext();
    } catch (e) {
      console.warn('AudioContext init error:', e);
    }

    if (useDemo) {
      setIsVirtualCamera(true);
      const demoStream = createSyntheticVideoStream();
      setVideoStream(demoStream);

      // Start background model loading (non-blocking)
      gestureRecognizer.initialize().catch(() => {});
      personSegmentation.initialize().catch(() => {});

      setIsLoading(false);
      setCurrentScreen('PERFORMANCE');
      return;
    }

    setLoadingMessage('REQUESTING CAMERA ACCESS...');

    let stream: MediaStream | null = null;
    try {
      const constraints: MediaStreamConstraints = {
        video: selectedDeviceId
          ? { deviceId: { exact: selectedDeviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: false,
      };

      // 4 second timeout on camera request
      const cameraPromise = navigator.mediaDevices.getUserMedia(constraints);
      const timeoutPromise = new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('Camera request timed out')), 4000)
      );

      stream = (await Promise.race([cameraPromise, timeoutPromise])) as MediaStream;
      setIsVirtualCamera(false);
      setVideoStream(stream);
      refreshDevices();
    } catch (err: unknown) {
      console.warn('Camera failed or timed out, falling back to Virtual Studio Stream:', err);
      setIsVirtualCamera(true);
      const fallbackStream = createSyntheticVideoStream();
      setVideoStream(fallbackStream);
      setErrorMessage(
        'Camera is not accessible or permission was denied. Switched to Virtual Studio Mode so you can perform immediately!'
      );
    }

    // 3. Load Vision Models in background (with built-in timeouts)
    setLoadingMessage('STARTING REAL-TIME TRACKING ENGINE...');
    await Promise.allSettled([
      gestureRecognizer.initialize(),
      personSegmentation.initialize(),
    ]);

    setIsLoading(false);
    setCurrentScreen('PERFORMANCE');
  };

  const handleEditSetup = () => {
    setCurrentScreen('SETUP');
  };

  return (
    <div className="w-full min-h-screen bg-[#080808]">
      {currentScreen === 'SETUP' ? (
        <SetupScreen
          config={config}
          onUpdateConfig={handleUpdateConfig}
          onStartPerformance={() => handleStartPerformance(false)}
          onStartDemoPerformance={() => handleStartPerformance(true)}
          isLoading={isLoading}
          loadingMessage={loadingMessage}
          errorMessage={errorMessage}
          videoDevices={videoDevices}
          selectedDeviceId={selectedDeviceId}
          onSelectDeviceId={setSelectedDeviceId}
        />
      ) : (
        <PerformanceScreen
          config={config}
          videoStream={videoStream}
          isVirtualCamera={isVirtualCamera}
          onEditSetup={handleEditSetup}
          onUpdateConfig={handleUpdateConfig}
          onSwitchToCamera={() => handleStartPerformance(false)}
          onSwitchToDemo={() => handleStartPerformance(true)}
        />
      )}
    </div>
  );
};

export default App;

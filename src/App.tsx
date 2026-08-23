import React, { useState, useEffect, useCallback } from 'react';
import { FingercontrolConfig } from './types/config';
import { loadConfig, saveConfig } from './utils/storage';
import { SetupScreen } from './components/SetupScreen';
import { PerformanceScreen } from './components/PerformanceScreen';
import { gestureRecognizer } from './vision/gestureRecognizer';
import { personSegmentation } from './vision/segmentation';
import { audioManager } from './utils/audio';

export const App: React.FC = () => {
  const [currentScreen, setCurrentScreen] = useState<'SETUP' | 'PERFORMANCE'>('SETUP');
  const [config, setConfig] = useState<FingercontrolConfig>(() => loadConfig());

  // Camera & Device State
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
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

  // Launch Performance Mode (Camera + Vision Models)
  const handleStartPerformance = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    setLoadingMessage('REQUESTING CAMERA ACCESS...');

    try {
      // 1. Initialize Audio Context on user click
      audioManager.initAudioContext();

      // 2. Request Camera Stream
      const constraints: MediaStreamConstraints = {
        video: selectedDeviceId
          ? { deviceId: { exact: selectedDeviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
          : { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: 'user' },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      setVideoStream(stream);

      // Refresh devices to get actual camera labels after permission granted
      refreshDevices();

      // 3. Initialize Vision Models
      setLoadingMessage('LOADING MEDIAPIPE HAND LANDMARKER...');
      const handLoaded = await gestureRecognizer.initialize();
      if (!handLoaded) {
        console.warn('Hand landmarker failed to load completely; will proceed with fallback tracking');
      }

      setLoadingMessage('INITIALIZING SEGMENTATION MASK ENGINE...');
      await personSegmentation.initialize();

      // 4. Transition to Performance Screen
      setIsLoading(false);
      setCurrentScreen('PERFORMANCE');
    } catch (err: unknown) {
      console.error('Camera or model initialization error:', err);
      setIsLoading(false);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('NotAllowedError') || msg.includes('Permission')) {
        setErrorMessage('Camera access was denied. Please allow camera permissions in your browser address bar.');
      } else if (msg.includes('NotFoundError') || msg.includes('DevicesNotFoundError')) {
        setErrorMessage('No camera device was detected on your system.');
      } else {
        setErrorMessage(`Could not start camera: ${msg}`);
      }
    }
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
          onStartPerformance={handleStartPerformance}
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
          onEditSetup={handleEditSetup}
          onUpdateConfig={handleUpdateConfig}
        />
      )}
    </div>
  );
};

export default App;

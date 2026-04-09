'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Settings } from '@/lib/types';
import PreflightChecklist from './PreflightChecklist';
import DeviceProgrammer from './DeviceProgrammer';

type SessionPhase = 'checklist' | 'active';

interface SessionManagerProps {
  settings: Settings;
  operatorName: string;
  paused: boolean;
  onSessionTimer: (seconds: number) => void;
  onDeviceCount: (count: number) => void;
}

export default function SessionManager({ settings, operatorName, paused, onSessionTimer, onDeviceCount }: SessionManagerProps) {
  const [phase, setPhase] = useState<SessionPhase>('checklist');
  const [deviceCount, setDeviceCount] = useState(0);
  const sessionStartRef = useRef(0);
  const pausedAccumRef = useRef(0);
  const pauseStartRef = useRef(0);

  // Session timer
  useEffect(() => {
    if (phase !== 'active' || sessionStartRef.current === 0) return;

    if (paused) {
      pauseStartRef.current = Date.now();
      return;
    }

    // If resuming from pause, accumulate paused time
    if (pauseStartRef.current > 0) {
      pausedAccumRef.current += Date.now() - pauseStartRef.current;
      pauseStartRef.current = 0;
    }

    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - sessionStartRef.current - pausedAccumRef.current) / 1000);
      onSessionTimer(elapsed);
    }, 1000);

    return () => clearInterval(interval);
  }, [phase, paused, onSessionTimer]);

  const startSession = useCallback(() => {
    sessionStartRef.current = Date.now();
    pausedAccumRef.current = 0;
    pauseStartRef.current = 0;
    setDeviceCount(0);
    onSessionTimer(0);
    onDeviceCount(0);
    setPhase('active');
  }, [onSessionTimer, onDeviceCount]);

  const incrementDeviceCount = useCallback(() => {
    setDeviceCount(prev => {
      const next = prev + 1;
      onDeviceCount(next);
      return next;
    });
  }, [onDeviceCount]);

  if (phase === 'checklist') {
    return <PreflightChecklist onComplete={startSession} />;
  }

  return (
    <DeviceProgrammer
      settings={settings}
      onDeviceProgrammed={incrementDeviceCount}
    />
  );
}

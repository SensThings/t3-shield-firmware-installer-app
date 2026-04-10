'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';
import SessionManager from '@/components/SessionManager';
import SettingsPanel from '@/components/SettingsPanel';
import { Settings, DEFAULT_SETTINGS } from '@/lib/types';
import { loadSettings, saveSettings } from '@/lib/settings';
import { isLoggedIn, getAuth, clearAuth, UserRole } from '@/lib/auth';

export default function Home() {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [operatorName, setOperatorName] = useState('');
  const [userRole, setUserRole] = useState<UserRole>('op');
  const [sessionSeconds, setSessionSeconds] = useState(-1);
  const [sessionPaused, setSessionPaused] = useState(false);
  const [deviceCount, setDeviceCount] = useState(0);
  const [sessionKey, setSessionKey] = useState(0);

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace('/login');
      return;
    }
    const auth = getAuth();
    setOperatorName(auth?.username || '');
    setUserRole(auth?.role || 'op');
    setSettings(loadSettings());
    setAuthChecked(true);
  }, [router]);

  const handleSaveSettings = (newSettings: Settings) => {
    setSettings(newSettings);
    saveSettings(newSettings);
  };

  const handleSessionTimer = useCallback((seconds: number) => {
    setSessionSeconds(seconds);
  }, []);

  const handleDeviceCount = useCallback((count: number) => {
    setDeviceCount(count);
  }, []);

  const handlePauseResume = () => {
    setSessionPaused(prev => !prev);
  };

  const handleFinishSession = () => {
    setSessionSeconds(-1);
    setSessionPaused(false);
    setDeviceCount(0);
    setSessionKey(prev => prev + 1);
  };

  const handleLogout = () => {
    clearAuth();
    router.replace('/login');
  };

  if (!authChecked) {
    return (
      <div className="flex items-center justify-center flex-1 min-h-screen">
        <div className="text-zinc-500">Chargement...</div>
      </div>
    );
  }

  return (
    <>
      <Header
        onSettingsClick={() => setShowSettings(true)}
        settings={settings}
        operatorName={operatorName}
        sessionSeconds={sessionSeconds >= 0 ? sessionSeconds : undefined}
        sessionPaused={sessionPaused}
        deviceCount={deviceCount}
        onPauseResume={sessionSeconds >= 0 ? handlePauseResume : undefined}
        onFinishSession={sessionSeconds >= 0 ? handleFinishSession : undefined}
        onLogout={handleLogout}
      />
      <main className="flex-1 flex">
        <SessionManager
          key={sessionKey}
          settings={settings}
          operatorName={operatorName}
          role={userRole}
          paused={sessionPaused}
          onSessionTimer={handleSessionTimer}
          onDeviceCount={handleDeviceCount}
        />
      </main>
      {showSettings && (
        <SettingsPanel
          settings={settings}
          onSave={handleSaveSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </>
  );
}

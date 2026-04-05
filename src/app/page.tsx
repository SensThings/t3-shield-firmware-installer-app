'use client';

import { useState, useEffect } from 'react';
import Header from '@/components/Header';
import DeviceProgrammer from '@/components/DeviceProgrammer';
import SettingsPanel from '@/components/SettingsPanel';
import { Settings, DEFAULT_SETTINGS } from '@/lib/types';
import { loadSettings, saveSettings } from '@/lib/settings';

export default function Home() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    setSettings(loadSettings());
  }, []);

  const handleSaveSettings = (newSettings: Settings) => {
    setSettings(newSettings);
    saveSettings(newSettings);
  };

  return (
    <>
      <Header onSettingsClick={() => setShowSettings(true)} settings={settings} />
      <main className="flex-1 flex">
        <DeviceProgrammer settings={settings} />
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

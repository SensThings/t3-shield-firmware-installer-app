'use client';

import { useState, useEffect, useRef } from 'react';
import { Settings } from '@/lib/types';
import { testConnection } from '@/lib/api';

interface HeaderProps {
  onSettingsClick: () => void;
  settings: Settings;
}

export default function Header({ onSettingsClick, settings }: HeaderProps) {
  const [connectionStatus, setConnectionStatus] = useState<'unknown' | 'connected' | 'disconnected'>('unknown');
  const [checking, setChecking] = useState(false);
  const checkingRef = useRef(false);

  useEffect(() => {
    const checkConnection = async () => {
      if (!settings.deviceIp || checkingRef.current) return;
      checkingRef.current = true;
      setChecking(true);
      try {
        const data = await testConnection(settings.deviceIp, settings.sshUsername, settings.sshPassword);
        setConnectionStatus(data.success ? 'connected' : 'disconnected');
      } catch {
        setConnectionStatus('disconnected');
      } finally {
        setChecking(false);
        checkingRef.current = false;
      }
    };

    checkConnection();
    const interval = setInterval(checkConnection, 30000);
    return () => clearInterval(interval);
  }, [settings.deviceIp, settings.sshUsername, settings.sshPassword]);

  const statusLabel =
    connectionStatus === 'connected' ? 'Appareil connecté' :
    connectionStatus === 'disconnected' ? 'Appareil injoignable' :
    'Vérification...';

  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center">
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
          </svg>
        </div>
        <h1 className="text-lg font-semibold text-zinc-100">T3-Shield — Installateur</h1>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-sm text-zinc-400" title={statusLabel}>
          <div
            className={`w-2.5 h-2.5 rounded-full ${
              connectionStatus === 'connected'
                ? 'bg-emerald-500'
                : connectionStatus === 'disconnected'
                ? 'bg-red-500'
                : 'bg-zinc-600'
            } ${checking ? 'animate-pulse' : ''}`}
          />
          <span>{settings.deviceIp}</span>
        </div>

        <button
          onClick={onSettingsClick}
          className="p-2 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors"
          title="Paramètres"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>
    </header>
  );
}

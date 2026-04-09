'use client';

import { useState, useEffect, useRef } from 'react';
import { Settings } from '@/lib/types';
import { testConnection } from '@/lib/api';

interface HeaderProps {
  onSettingsClick: () => void;
  settings: Settings;
  operatorName?: string;
  sessionSeconds?: number;
  sessionPaused?: boolean;
  deviceCount?: number;
  onPauseResume?: () => void;
  onFinishSession?: () => void;
  onLogout?: () => void;
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}m`;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

export default function Header({
  onSettingsClick,
  settings,
  operatorName,
  sessionSeconds,
  sessionPaused,
  deviceCount,
  onPauseResume,
  onFinishSession,
  onLogout,
}: HeaderProps) {
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

  const hasSession = sessionSeconds !== undefined && sessionSeconds >= 0;

  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center">
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
          </svg>
        </div>
        <h1 className="text-lg font-semibold text-zinc-100">T3-Shield — Installateur</h1>
        <span className="text-xs text-zinc-600 ml-1">v{process.env.APP_VERSION}</span>
        {operatorName && (
          <span className="text-sm text-zinc-500 ml-2">| {operatorName}</span>
        )}
      </div>

      <div className="flex items-center gap-4">
        {/* Session timer + controls */}
        {hasSession && (
          <div className="flex items-center gap-3">
            {/* Device count */}
            {deviceCount !== undefined && deviceCount > 0 && (
              <span className="text-sm text-zinc-400">
                {deviceCount} appareil{deviceCount > 1 ? 's' : ''}
              </span>
            )}

            {/* Timer */}
            <span className={`text-sm font-mono ${sessionPaused ? 'text-amber-400' : 'text-zinc-400'}`}>
              {formatTime(sessionSeconds!)}
              {sessionPaused && ' (pause)'}
            </span>

            {/* Pause/Resume */}
            {onPauseResume && (
              <button
                onClick={onPauseResume}
                className="px-2.5 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-md transition-colors border border-zinc-700"
              >
                {sessionPaused ? 'Reprendre' : 'Pause'}
              </button>
            )}

            {/* Finish */}
            {onFinishSession && (
              <button
                onClick={onFinishSession}
                className="px-2.5 py-1 text-xs bg-red-900/50 hover:bg-red-900 text-red-300 rounded-md transition-colors border border-red-800/50"
              >
                Terminer
              </button>
            )}
          </div>
        )}

        {/* Connection status */}
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

        {onLogout && (
          <button
            onClick={onLogout}
            className="p-2 text-zinc-400 hover:text-red-400 hover:bg-zinc-800 rounded-lg transition-colors"
            title="Déconnexion"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        )}
      </div>
    </header>
  );
}

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Settings, InstallStep, INSTALL_STEPS, StepUpdateEvent, InstallResult } from '@/lib/types';
import ProgressChecklist from './ProgressChecklist';

type View = 'idle' | 'serial_input' | 'programming' | 'success' | 'failure';

interface DeviceProgrammerProps {
  settings: Settings;
}

export default function DeviceProgrammer({ settings }: DeviceProgrammerProps) {
  const [view, setView] = useState<View>('idle');
  const [serialNumber, setSerialNumber] = useState('');
  const [steps, setSteps] = useState<InstallStep[]>([]);
  const [startTime, setStartTime] = useState(0);
  const [result, setResult] = useState<InstallResult | null>(null);
  const [error, setError] = useState('');
  const serialInputRef = useRef<HTMLInputElement>(null);

  const missingCreds = !settings.ghcrUsername || !settings.ghcrToken;

  useEffect(() => {
    if (view === 'serial_input' && serialInputRef.current) {
      serialInputRef.current.focus();
    }
  }, [view]);

  const initSteps = (): InstallStep[] =>
    INSTALL_STEPS.map((s, i) => ({
      id: s.id,
      number: i + 1,
      label: s.label,
      status: 'pending',
    }));

  const handleStepUpdate = useCallback((update: StepUpdateEvent) => {
    setSteps(prev => {
      const next = [...prev];
      const idx = update.stepNumber - 1;
      if (idx >= 0 && idx < next.length) {
        next[idx] = {
          ...next[idx],
          status: update.status,
          message: update.message || next[idx].message,
          duration: update.duration,
          startedAt: update.status === 'in_progress' ? Date.now() : next[idx].startedAt,
        };
        // If a step fails, mark remaining as skipped
        if (update.status === 'fail') {
          for (let i = idx + 1; i < next.length; i++) {
            if (next[i].status === 'pending') {
              next[i] = { ...next[i], status: 'skipped' };
            }
          }
        }
      }
      return next;
    });
  }, []);

  const startInstall = async () => {
    const trimmed = serialNumber.trim();
    if (!trimmed || !/^[a-zA-Z0-9]{3,}$/.test(trimmed)) return;

    setSteps(initSteps());
    setStartTime(Date.now());
    setResult(null);
    setError('');
    setView('programming');

    try {
      const res = await fetch('/api/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serialNumber: trimmed, settings }),
      });

      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Failed to start installation');
        setView('failure');
        return;
      }

      // Listen to SSE stream
      const evtSource = new EventSource(`/api/install?installId=${data.installId}`);

      evtSource.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          if (parsed.type === 'step_update') {
            handleStepUpdate(parsed.data as StepUpdateEvent);
          } else if (parsed.type === 'install_complete') {
            const installResult = parsed.data as InstallResult;
            setResult(installResult);
            setView(installResult.result === 'pass' ? 'success' : 'failure');
            evtSource.close();
          } else if (parsed.type === 'install_error') {
            setError((parsed.data as { error: string }).error);
            setView('failure');
            evtSource.close();
          } else if (parsed.type === 'done') {
            if (parsed.data.status === 'failed') {
              setError(parsed.data.error || 'Installation failed');
              setView('failure');
            } else if (parsed.data.result) {
              setResult(parsed.data.result);
              setView(parsed.data.result.result === 'pass' ? 'success' : 'failure');
            }
            evtSource.close();
          }
        } catch {
          // ignore parse errors
        }
      };

      evtSource.onerror = () => {
        evtSource.close();
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start installation');
      setView('failure');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') startInstall();
    if (e.key === 'Escape') setView('idle');
  };

  const reset = () => {
    setView('idle');
    setSerialNumber('');
    setSteps([]);
    setResult(null);
    setError('');
  };

  const retry = () => {
    setView('serial_input');
  };

  // Idle view — big "Program New Device" button
  if (view === 'idle') {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-6">
        {missingCreds && (
          <div className="px-4 py-2 bg-amber-900/30 border border-amber-700/50 rounded-lg text-amber-400 text-sm">
            Configure GHCR credentials in Settings before programming devices.
          </div>
        )}
        <button
          onClick={() => setView('serial_input')}
          disabled={missingCreds}
          className="flex flex-col items-center gap-4 px-12 py-8 bg-zinc-800 hover:bg-zinc-750 border-2 border-zinc-700 hover:border-emerald-600 rounded-2xl transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
        >
          <svg className="w-12 h-12 text-emerald-500 group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
          </svg>
          <span className="text-lg font-semibold text-zinc-200">Program New Device</span>
        </button>
      </div>
    );
  }

  // Serial number input modal
  if (view === 'serial_input') {
    const isValid = /^[a-zA-Z0-9]{3,}$/.test(serialNumber.trim());
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-40" onClick={() => setView('idle')}>
        <div
          className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-md p-6 shadow-2xl"
          onClick={e => e.stopPropagation()}
        >
          <h2 className="text-lg font-semibold text-zinc-100 mb-4">Enter Device Serial Number</h2>

          <div className="mb-4">
            <input
              ref={serialInputRef}
              type="text"
              value={serialNumber}
              onChange={e => setSerialNumber(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g. 12345"
              className="w-full px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-200 text-lg placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
            />
            {serialNumber.trim() && (
              <p className="text-sm text-zinc-500 mt-2">
                Hostname will be: <span className="text-zinc-300 font-mono">T3S-{serialNumber.trim()}</span>
              </p>
            )}
            {serialNumber.trim() && !isValid && (
              <p className="text-sm text-red-400 mt-1">
                Must be alphanumeric, at least 3 characters.
              </p>
            )}
          </div>

          <div className="flex justify-end gap-3">
            <button
              onClick={() => setView('idle')}
              className="px-4 py-2 text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={startInstall}
              disabled={!isValid}
              className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
            >
              Start
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Programming progress view
  if (view === 'programming') {
    return (
      <div className="flex flex-col items-center justify-center flex-1 py-8">
        <ProgressChecklist steps={steps} serialNumber={serialNumber.trim()} startTime={startTime} />
      </div>
    );
  }

  // Success view
  if (view === 'success') {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-6">
        <div className="bg-zinc-800/50 border border-zinc-700 rounded-xl p-8 text-center max-w-md">
          <svg className="w-16 h-16 text-emerald-500 mx-auto mb-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          <h2 className="text-xl font-semibold text-zinc-100 mb-4">Device programmed successfully!</h2>
          <div className="space-y-2 text-sm text-zinc-400 mb-6">
            <p>Hostname: <span className="text-zinc-200 font-mono">T3S-{serialNumber.trim()}</span></p>
            {result?.version && (
              <p>Firmware: <span className="text-zinc-200">{result.version}</span></p>
            )}
            {result?.image && (
              <p>Image: <span className="text-zinc-200 font-mono text-xs">{result.image}</span></p>
            )}
          </div>
          <button
            onClick={reset}
            className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium transition-colors"
          >
            Program Another Device
          </button>
        </div>
      </div>
    );
  }

  // Failure view
  if (view === 'failure') {
    const failedStep = steps.find(s => s.status === 'fail');
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-6">
        <div className="bg-zinc-800/50 border border-zinc-700 rounded-xl p-8 text-center max-w-md">
          <svg className="w-16 h-16 text-red-500 mx-auto mb-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
          <h2 className="text-xl font-semibold text-zinc-100 mb-2">Programming failed</h2>
          {failedStep && (
            <p className="text-sm text-zinc-400 mb-1">
              Failed at: <span className="text-red-400">{failedStep.label}</span>
            </p>
          )}
          <p className="text-sm text-red-400/80 mb-6">
            {error || failedStep?.message || 'Unknown error'}
          </p>
          <div className="flex justify-center gap-3">
            <button
              onClick={retry}
              className="px-5 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded-lg font-medium transition-colors"
            >
              Retry
            </button>
            <button
              onClick={reset}
              className="px-5 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded-lg font-medium transition-colors"
            >
              Program Another
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

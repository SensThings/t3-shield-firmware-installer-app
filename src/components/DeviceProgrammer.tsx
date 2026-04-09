'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Settings, StepStatus, InstallStep, INSTALL_STEPS, PREP_STEPS, SDR_PREP_STEPS, SDR_TEST_STEPS, StepUpdateEvent, PrepStepEvent, InstallResult } from '@/lib/types';
import { startInstall, startSdrTest, subscribeProgress } from '@/lib/api';
import ProgressChecklist from './ProgressChecklist';

type View = 'idle' | 'serial_input' | 'programming' | 'success' | 'failure';
type ActionMode = 'install' | 'sdr_test';

interface PrepStep {
  id: string;
  label: string;
  status: StepStatus;
  message?: string;
}

interface SdrMetrics {
  status: string;
  peak_freq_hz: number;
  expected_freq_hz: number;
  freq_error_hz: number;
  snr_db: number;
  snr_threshold_db: number;
  peak_power_db: number;
  noise_floor_db: number;
}

interface DeviceProgrammerProps {
  settings: Settings;
}

export default function DeviceProgrammer({ settings }: DeviceProgrammerProps) {
  const [view, setView] = useState<View>('idle');
  const [mode, setMode] = useState<ActionMode>('install');
  const [serialNumber, setSerialNumber] = useState('');
  const [prepSteps, setPrepSteps] = useState<PrepStep[]>([]);
  const [steps, setSteps] = useState<InstallStep[]>([]);
  const [startTime, setStartTime] = useState(0);
  const [result, setResult] = useState<InstallResult | null>(null);
  const [sdrMetrics, setSdrMetrics] = useState<SdrMetrics | null>(null);
  const [error, setError] = useState('');
  const serialInputRef = useRef<HTMLInputElement>(null);

  const missingCreds = !settings.ghcrUsername || !settings.ghcrToken;

  useEffect(() => {
    if (view === 'serial_input' && serialInputRef.current) {
      serialInputRef.current.focus();
    }
  }, [view]);

  const initPrepSteps = (m: ActionMode): PrepStep[] =>
    (m === 'install' ? PREP_STEPS : SDR_PREP_STEPS).map(s => ({ id: s.id, label: s.label, status: 'pending' as const }));

  const initSteps = (m: ActionMode): InstallStep[] =>
    (m === 'install' ? INSTALL_STEPS : SDR_TEST_STEPS).map((s, i) => ({
      id: s.id,
      number: i + 1,
      label: s.label,
      status: 'pending',
    }));

  const handlePrepStep = useCallback((update: PrepStepEvent) => {
    setPrepSteps(prev => prev.map(s =>
      s.id === update.stepId
        ? { ...s, status: update.status, message: update.message }
        : s
    ));
  }, []);

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

  const startAction = async () => {
    const trimmed = serialNumber.trim();
    if (!trimmed || !/^[a-zA-Z0-9]{3,}$/.test(trimmed)) return;

    setPrepSteps(initPrepSteps(mode));
    setSteps(initSteps(mode));
    setStartTime(Date.now());
    setResult(null);
    setSdrMetrics(null);
    setError('');
    setView('programming');

    const completeEvent = mode === 'install' ? 'install_complete' : 'test_complete';
    const errorEvent = mode === 'install' ? 'install_error' : 'test_error';

    try {
      const data = mode === 'install'
        ? await startInstall(trimmed, settings as unknown as Record<string, string>)
        : await startSdrTest(trimmed, settings as unknown as Record<string, string>);

      if (!data.success) {
        setError(data.error || `Failed to start ${mode === 'install' ? 'installation' : 'SDR test'}`);
        setView('failure');
        return;
      }

      const progressId = data.install_id || data.test_id;
      const progressPath = mode === 'install' ? 'install' : 'sdr-test';
      const evtSource = subscribeProgress(progressPath, progressId);

      evtSource.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          if (parsed.type === 'prep_step') {
            handlePrepStep(parsed.data as PrepStepEvent);
          } else if (parsed.type === 'step_update') {
            handleStepUpdate(parsed.data as StepUpdateEvent);
          } else if (parsed.type === completeEvent) {
            const r = parsed.data;
            setResult(r);
            if (r.metrics) setSdrMetrics(r.metrics);
            setView(r.result === 'pass' ? 'success' : 'failure');
            evtSource.close();
          } else if (parsed.type === errorEvent) {
            setError((parsed.data as { error: string }).error);
            setView('failure');
            evtSource.close();
          } else if (parsed.type === 'done') {
            if (parsed.data.status === 'failed') {
              setError(parsed.data.error || `${mode === 'install' ? 'Installation' : 'SDR test'} failed`);
              setView('failure');
            } else if (parsed.data.result) {
              setResult(parsed.data.result);
              if (parsed.data.result.metrics) setSdrMetrics(parsed.data.result.metrics);
              setView(parsed.data.result.result === 'pass' ? 'success' : 'failure');
            }
            evtSource.close();
          }
        } catch {
          // ignore
        }
      };

      evtSource.onerror = () => evtSource.close();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to start ${mode === 'install' ? 'installation' : 'SDR test'}`);
      setView('failure');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') startAction();
    if (e.key === 'Escape') setView('idle');
  };

  const reset = () => {
    setView('idle');
    setSerialNumber('');
    setPrepSteps([]);
    setSteps([]);
    setResult(null);
    setSdrMetrics(null);
    setError('');
  };

  const retry = () => setView('serial_input');

  const startMode = (m: ActionMode) => {
    setMode(m);
    setView('serial_input');
  };

  // Idle view
  if (view === 'idle') {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-6">
        {missingCreds && (
          <div className="px-4 py-2 bg-amber-900/30 border border-amber-700/50 rounded-lg text-amber-400 text-sm">
            Configure GHCR credentials in Settings before programming devices.
          </div>
        )}
        <div className="flex gap-6">
          <button
            onClick={() => startMode('install')}
            disabled={missingCreds}
            className="flex flex-col items-center gap-4 px-12 py-8 bg-zinc-800 hover:bg-zinc-750 border-2 border-zinc-700 hover:border-emerald-600 rounded-2xl transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
          >
            <svg className="w-12 h-12 text-emerald-500 group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
            </svg>
            <span className="text-lg font-semibold text-zinc-200">Program New Device</span>
          </button>
          <button
            onClick={() => startMode('sdr_test')}
            className="flex flex-col items-center gap-4 px-12 py-8 bg-zinc-800 hover:bg-zinc-750 border-2 border-zinc-700 hover:border-blue-600 rounded-2xl transition-all group"
          >
            <svg className="w-12 h-12 text-blue-500 group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.348 14.651a3.75 3.75 0 010-5.303m5.304 0a3.75 3.75 0 010 5.303m-7.425 2.122a6.75 6.75 0 010-9.546m9.546 0a6.75 6.75 0 010 9.546M5.106 18.894c-3.808-3.808-3.808-9.98 0-13.789m13.788 0c3.808 3.808 3.808 9.981 0 13.79M12 12h.008v.007H12V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
            </svg>
            <span className="text-lg font-semibold text-zinc-200">SDR Test</span>
          </button>
        </div>
      </div>
    );
  }

  // Serial number input
  if (view === 'serial_input') {
    const isValid = /^[a-zA-Z0-9]{3,}$/.test(serialNumber.trim());
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-40" onClick={() => setView('idle')}>
        <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-md p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
          <h2 className="text-lg font-semibold text-zinc-100 mb-4">
            {mode === 'install' ? 'Enter Device Serial Number' : 'Enter Device Serial Number (SDR Test)'}
          </h2>
          <div className="mb-4">
            <input ref={serialInputRef} type="text" value={serialNumber} onChange={e => setSerialNumber(e.target.value)} onKeyDown={handleKeyDown} placeholder="e.g. 12345"
              className="w-full px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-200 text-lg placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" />
            {serialNumber.trim() && (
              <p className="text-sm text-zinc-500 mt-2">Hostname will be: <span className="text-zinc-300 font-mono">T3S-{serialNumber.trim()}</span></p>
            )}
            {serialNumber.trim() && !isValid && (
              <p className="text-sm text-red-400 mt-1">Must be alphanumeric, at least 3 characters.</p>
            )}
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={() => setView('idle')} className="px-4 py-2 text-zinc-400 hover:text-zinc-200 transition-colors">Cancel</button>
            <button onClick={startAction} disabled={!isValid} className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors">Start</button>
          </div>
        </div>
      </div>
    );
  }

  // Programming progress view — shows both prep and install steps
  if (view === 'programming') {
    const allPrepDone = prepSteps.every(s => s.status === 'pass');
    return (
      <div className="flex flex-col items-center justify-center flex-1 py-8">
        <div className="w-full max-w-xl">
          {/* Prep phase */}
          {!allPrepDone && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Preparing Files</h3>
              <div className="space-y-1">
                {prepSteps.map(s => (
                  <div key={s.id} className={`flex items-center gap-3 py-2 px-3 rounded-lg ${s.status === 'in_progress' ? 'bg-zinc-800/50' : ''}`}>
                    <div className="flex-shrink-0">
                      {s.status === 'pending' && <div className="w-4 h-4 rounded-full border-2 border-zinc-700" />}
                      {s.status === 'in_progress' && (
                        <svg className="w-4 h-4 animate-spin text-amber-500" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      )}
                      {s.status === 'pass' && (
                        <svg className="w-4 h-4 text-emerald-500" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                      )}
                      {s.status === 'fail' && (
                        <svg className="w-4 h-4 text-red-500" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className={`text-sm ${s.status === 'pending' ? 'text-zinc-600' : 'text-zinc-300'}`}>{s.label}</span>
                      {s.message && s.status !== 'pending' && (
                        <p className="text-xs text-zinc-500 mt-0.5">{s.message}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Install phase */}
          {allPrepDone && (
            <ProgressChecklist steps={steps} serialNumber={serialNumber.trim()} startTime={startTime} />
          )}

          {/* Show both when prep is done but install hasn't started */}
          {!allPrepDone && prepSteps.some(s => s.status !== 'pending') && (
            <div className="mt-4 text-center text-sm text-zinc-500">
              Preparing files for transfer...
            </div>
          )}
        </div>
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
          <h2 className="text-xl font-semibold text-zinc-100 mb-4">
            {mode === 'install' ? 'Device programmed successfully!' : 'SDR test passed!'}
          </h2>
          <div className="space-y-2 text-sm text-zinc-400 mb-6">
            <p>Device: <span className="text-zinc-200 font-mono">T3S-{serialNumber.trim()}</span></p>
            {mode === 'install' && result?.version && <p>Firmware: <span className="text-zinc-200">{result.version}</span></p>}
            {mode === 'install' && result?.image && <p>Image: <span className="text-zinc-200 font-mono text-xs">{result.image}</span></p>}
            {mode === 'sdr_test' && sdrMetrics && (
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div className="bg-zinc-800 rounded-lg p-3 text-center">
                  <div className="text-xs text-zinc-500">SNR</div>
                  <div className="text-lg font-mono text-emerald-400">{sdrMetrics.snr_db} dB</div>
                  <div className="text-xs text-zinc-600">threshold: {sdrMetrics.snr_threshold_db} dB</div>
                </div>
                <div className="bg-zinc-800 rounded-lg p-3 text-center">
                  <div className="text-xs text-zinc-500">Freq Error</div>
                  <div className="text-lg font-mono text-emerald-400">{sdrMetrics.freq_error_hz} Hz</div>
                </div>
                <div className="bg-zinc-800 rounded-lg p-3 text-center">
                  <div className="text-xs text-zinc-500">Peak Frequency</div>
                  <div className="text-lg font-mono text-zinc-200">{sdrMetrics.peak_freq_hz} Hz</div>
                </div>
                <div className="bg-zinc-800 rounded-lg p-3 text-center">
                  <div className="text-xs text-zinc-500">Noise Floor</div>
                  <div className="text-lg font-mono text-zinc-200">{sdrMetrics.noise_floor_db} dB</div>
                </div>
              </div>
            )}
          </div>
          <button onClick={reset} className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium transition-colors">
            Program Another Device
          </button>
        </div>
      </div>
    );
  }

  // Failure view
  if (view === 'failure') {
    const failedStep = steps.find(s => s.status === 'fail');
    const failedPrep = prepSteps.find(s => s.status === 'fail');
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-6">
        <div className="bg-zinc-800/50 border border-zinc-700 rounded-xl p-8 text-center max-w-md">
          <svg className="w-16 h-16 text-red-500 mx-auto mb-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
          <h2 className="text-xl font-semibold text-zinc-100 mb-2">Programming failed</h2>
          {(failedStep || failedPrep) && (
            <p className="text-sm text-zinc-400 mb-1">
              Failed at: <span className="text-red-400">{failedStep?.label || failedPrep?.label}</span>
            </p>
          )}
          <p className="text-sm text-red-400/80 mb-6">
            {error || failedStep?.message || failedPrep?.message || 'Unknown error'}
          </p>
          <div className="flex justify-center gap-3">
            <button onClick={retry} className="px-5 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded-lg font-medium transition-colors">Retry</button>
            <button onClick={reset} className="px-5 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded-lg font-medium transition-colors">Program Another</button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Settings, InstallStep, INSTALL_STEPS, SDR_TEST_STEPS, StepUpdateEvent, PrepStepEvent, InstallResult, SdrMetrics, ChannelMetrics } from '@/lib/types';
import { startInstall, startSdrTest, subscribeProgress } from '@/lib/api';
import ProgressChecklist from './ProgressChecklist';

type View = 'idle' | 'serial_input' | 'programming' | 'success' | 'failure';
type ActionMode = 'install' | 'sdr_test';

interface DeviceProgrammerProps {
  settings: Settings;
  onDeviceProgrammed?: () => void;
}

const DEFAULT_ERROR = 'Une erreur est survenue. Réessayez ou signalez au responsable.';

export default function DeviceProgrammer({ settings, onDeviceProgrammed }: DeviceProgrammerProps) {
  const [view, setView] = useState<View>('idle');
  const [mode, setMode] = useState<ActionMode>('install');
  const [serialNumber, setSerialNumber] = useState('');
  const [steps, setSteps] = useState<InstallStep[]>([]);
  const [startTime, setStartTime] = useState(0);
  const [result, setResult] = useState<InstallResult | null>(null);
  const [sdrMetrics, setSdrMetrics] = useState<SdrMetrics | null>(null);
  const [error, setError] = useState('');
  const [endTime, setEndTime] = useState(0);
  const [dualChannel, setDualChannel] = useState(true);
  const serialInputRef = useRef<HTMLInputElement>(null);

  const missingCreds = !settings.ghcrUsername || !settings.ghcrToken;

  useEffect(() => {
    if (view === 'serial_input' && serialInputRef.current) {
      serialInputRef.current.focus();
    }
  }, [view]);

  const initSteps = (m: ActionMode): InstallStep[] => {
    const stepDefs = m === 'install' ? INSTALL_STEPS : SDR_TEST_STEPS;
    let installCounter = 0;
    return stepDefs.map((s, i) => {
      const step: InstallStep = {
        id: s.id,
        number: i + 1,
        label: s.label,
        status: 'pending',
        source: s.source,
      };
      if (s.source === 'install') {
        installCounter++;
        step.backendNumber = installCounter;
      }
      return step;
    });
  };

  const handlePrepStep = useCallback((update: PrepStepEvent) => {
    setSteps(prev => prev.map(s =>
      s.source === 'prep' && s.id === update.step_id
        ? {
            ...s,
            status: update.status,
            message: update.operator_message || update.message,
            startedAt: update.status === 'in_progress' ? Date.now() : s.startedAt,
          }
        : s
    ));
  }, []);

  const handleStepUpdate = useCallback((update: StepUpdateEvent) => {
    setSteps(prev => {
      const next = [...prev];
      const idx = next.findIndex(s => s.source === 'install' && s.backendNumber === update.step_number);
      if (idx >= 0) {
        next[idx] = {
          ...next[idx],
          status: update.status,
          message: update.operator_message || update.message || next[idx].message,
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

  const runAction = async (actionMode: ActionMode, serial: string) => {
    const completeEvent = actionMode === 'install' ? 'install_complete' : 'test_complete';
    const errorEvent = actionMode === 'install' ? 'install_error' : 'test_error';

    try {
      const data = actionMode === 'install'
        ? await startInstall(serial, settings as unknown as Record<string, string>)
        : await startSdrTest(serial, settings as unknown as Record<string, string>, dualChannel);

      if (!data.success) {
        setError(data.operator_message || data.error || DEFAULT_ERROR);
        setEndTime(Date.now());
        setView('failure');
        return;
      }

      const progressId = data.install_id || data.test_id;
      const progressPath = actionMode === 'install' ? 'install' : 'sdr-test';
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
            setEndTime(Date.now());
            setView(r.result === 'pass' ? 'success' : 'failure');
            evtSource.close();
          } else if (parsed.type === errorEvent) {
            setError(parsed.data.operator_message || parsed.data.error || DEFAULT_ERROR);
            setEndTime(Date.now());
            setView('failure');
            evtSource.close();
          } else if (parsed.type === 'done') {
            setEndTime(Date.now());
            if (parsed.data.status === 'failed') {
              setError(parsed.data.operator_message || parsed.data.error || DEFAULT_ERROR);
              setView('failure');
            } else if (parsed.data.result) {
              setResult(parsed.data.result);
              if (parsed.data.result.metrics) setSdrMetrics(parsed.data.result.metrics);
              setView(parsed.data.result.result === 'pass' ? 'success' : 'failure');
            }
            evtSource.close();
          }
        } catch {
          // ignore parse errors
        }
      };

      evtSource.onerror = () => evtSource.close();
    } catch {
      setError(DEFAULT_ERROR);
      setEndTime(Date.now());
      setView('failure');
    }
  };

  const startAction = () => {
    const trimmed = serialNumber.trim();
    if (!trimmed || !/^[a-zA-Z0-9]{3,}$/.test(trimmed)) return;

    setSteps(initSteps(mode));
    setStartTime(Date.now());
    setEndTime(0);
    setResult(null);
    setSdrMetrics(null);
    setError('');
    setView('programming');
    runAction(mode, trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') startAction();
    if (e.key === 'Escape') setView('idle');
  };

  const reset = () => {
    setView('idle');
    setSerialNumber('');
    setSteps([]);
    setResult(null);
    setSdrMetrics(null);
    setError('');
  };

  const nextDevice = () => {
    onDeviceProgrammed?.();
    reset();
  };

  const retry = () => setView('serial_input');

  const startSdrAfterInstall = () => {
    const trimmed = serialNumber.trim();
    setMode('sdr_test');
    setSteps(initSteps('sdr_test'));
    setStartTime(Date.now());
    setEndTime(0);
    setResult(null);
    setSdrMetrics(null);
    setError('');
    setView('programming');
    runAction('sdr_test', trimmed);
  };

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
            Configurez les identifiants GHCR dans les Paramètres avant de programmer.
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
            <span className="text-lg font-semibold text-zinc-200">Programmer un appareil</span>
          </button>
          <button
            onClick={() => startMode('sdr_test')}
            className="flex flex-col items-center gap-4 px-12 py-8 bg-zinc-800 hover:bg-zinc-750 border-2 border-zinc-700 hover:border-blue-600 rounded-2xl transition-all group"
          >
            <svg className="w-12 h-12 text-blue-500 group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.348 14.651a3.75 3.75 0 010-5.303m5.304 0a3.75 3.75 0 010 5.303m-7.425 2.122a6.75 6.75 0 010-9.546m9.546 0a6.75 6.75 0 010 9.546M5.106 18.894c-3.808-3.808-3.808-9.98 0-13.789m13.788 0c3.808 3.808 3.808 9.981 0 13.79M12 12h.008v.007H12V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
            </svg>
            <span className="text-lg font-semibold text-zinc-200">Tester le SDR</span>
          </button>
        </div>
        <div className="flex items-center gap-4 text-sm text-zinc-500">
          <span>Mode test SDR :</span>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="radio" checked={!dualChannel} onChange={() => setDualChannel(false)}
              className="accent-blue-500" />
            <span className={!dualChannel ? 'text-zinc-200' : ''}>Canal unique</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="radio" checked={dualChannel} onChange={() => setDualChannel(true)}
              className="accent-blue-500" />
            <span className={dualChannel ? 'text-zinc-200' : ''}>Double canal</span>
          </label>
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
            Entrez le numéro de série
          </h2>
          <div className="mb-4">
            <input ref={serialInputRef} type="text" value={serialNumber} onChange={e => setSerialNumber(e.target.value)} onKeyDown={handleKeyDown} placeholder="ex. 12345"
              className="w-full px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-200 text-lg placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" />
            {serialNumber.trim() && (
              <p className="text-sm text-zinc-500 mt-2">Nom de l&apos;appareil : <span className="text-zinc-300 font-mono">T3S-{serialNumber.trim()}</span></p>
            )}
            {serialNumber.trim() && !isValid && (
              <p className="text-sm text-red-400 mt-1">Doit être alphanumérique, au moins 3 caractères.</p>
            )}
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={() => setView('idle')} className="px-4 py-2 text-zinc-400 hover:text-zinc-200 transition-colors">Annuler</button>
            <button onClick={startAction} disabled={!isValid} className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors">Démarrer</button>
          </div>
        </div>
      </div>
    );
  }

  // Programming progress — single unified step list
  if (view === 'programming') {
    return (
      <div className="flex flex-col items-center justify-center flex-1 py-8">
        <div className="w-full max-w-xl">
          <ProgressChecklist steps={steps} serialNumber={serialNumber.trim()} startTime={startTime} mode={mode} />
        </div>
      </div>
    );
  }

  // Success view
  if (view === 'success') {
    const elapsedSeconds = endTime && startTime ? Math.floor((endTime - startTime) / 1000) : 0;
    const elapsedMin = Math.floor(elapsedSeconds / 60);
    const elapsedSec = elapsedSeconds % 60;
    const elapsedStr = elapsedMin > 0
      ? `${elapsedMin}m ${elapsedSec.toString().padStart(2, '0')}s`
      : `${elapsedSec}s`;

    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-6">
        <div className="bg-zinc-800/50 border border-zinc-700 rounded-xl p-8 text-center max-w-md">
          <svg className="w-16 h-16 text-emerald-500 mx-auto mb-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          <h2 className="text-xl font-semibold text-zinc-100 mb-4">
            {mode === 'install' ? 'Appareil programmé avec succès !' : 'Test SDR réussi !'}
          </h2>
          <div className="space-y-2 text-sm text-zinc-400 mb-6">
            <p>Appareil : <span className="text-zinc-200 font-mono">T3S-{serialNumber.trim()}</span></p>
            <p>Durée : <span className="text-zinc-200 font-mono">{elapsedStr}</span></p>
            {mode === 'install' && result?.version && <p>Firmware : <span className="text-zinc-200">{result.version}</span></p>}
            {mode === 'install' && result?.image && <p>Image : <span className="text-zinc-200 font-mono text-xs">{result.image}</span></p>}
            {mode === 'sdr_test' && sdrMetrics && (
              sdrMetrics.channel_a && sdrMetrics.channel_b ? (
                <div className="space-y-3 mt-3">
                  <ChannelCard label="Canal A" metrics={sdrMetrics.channel_a} />
                  <ChannelCard label="Canal B" metrics={sdrMetrics.channel_b} />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div className="bg-zinc-800 rounded-lg p-3 text-center">
                    <div className="text-xs text-zinc-500">SNR</div>
                    <div className="text-lg font-mono text-emerald-400">{sdrMetrics.snr_db} dB</div>
                    <div className="text-xs text-zinc-600">seuil : {sdrMetrics.snr_threshold_db} dB</div>
                  </div>
                  <div className="bg-zinc-800 rounded-lg p-3 text-center">
                    <div className="text-xs text-zinc-500">Erreur fréq.</div>
                    <div className="text-lg font-mono text-emerald-400">{sdrMetrics.freq_error_hz} Hz</div>
                  </div>
                  <div className="bg-zinc-800 rounded-lg p-3 text-center">
                    <div className="text-xs text-zinc-500">Fréquence pic</div>
                    <div className="text-lg font-mono text-zinc-200">{sdrMetrics.peak_freq_hz} Hz</div>
                  </div>
                  <div className="bg-zinc-800 rounded-lg p-3 text-center">
                    <div className="text-xs text-zinc-500">Plancher de bruit</div>
                    <div className="text-lg font-mono text-zinc-200">{sdrMetrics.noise_floor_db} dB</div>
                  </div>
                </div>
              )
            )}
          </div>
          {mode === 'install' ? (
            <div className="flex justify-center gap-3">
              <button onClick={startSdrAfterInstall} className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors">
                Tester le SDR
              </button>
              <button onClick={nextDevice} className="px-5 py-2.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded-lg font-medium transition-colors">
                Autre appareil
              </button>
            </div>
          ) : (
            <button onClick={nextDevice} className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium transition-colors">
              Appareil suivant
            </button>
          )}
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
          <h2 className="text-xl font-semibold text-zinc-100 mb-2">
            {mode === 'install' ? 'Programmation échouée' : 'Test SDR échoué'}
          </h2>
          {failedStep && (
            <p className="text-sm text-zinc-400 mb-1">
              Échoué à : <span className="text-red-400">{failedStep.label}</span>
            </p>
          )}
          <p className="text-sm text-red-400/80 mb-6">
            {error || failedStep?.message || DEFAULT_ERROR}
          </p>
          <div className="flex justify-center gap-3">
            <button onClick={retry} className="px-5 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded-lg font-medium transition-colors">Réessayer</button>
            <button onClick={reset} className="px-5 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded-lg font-medium transition-colors">Autre appareil</button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

function ChannelCard({ label, metrics }: { label: string; metrics: ChannelMetrics }) {
  const pass = metrics.status === 'PASS';
  return (
    <div className={`rounded-lg border p-3 ${pass ? 'border-emerald-800/50 bg-emerald-900/10' : 'border-red-800/50 bg-red-900/10'}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-zinc-300">{label}</span>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded ${pass ? 'bg-emerald-900/50 text-emerald-400' : 'bg-red-900/50 text-red-400'}`}>
          {metrics.status}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="text-center">
          <div className="text-xs text-zinc-500">SNR</div>
          <div className={`text-sm font-mono ${pass ? 'text-emerald-400' : 'text-red-400'}`}>{metrics.snr_db} dB</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-zinc-500">Erreur fréq.</div>
          <div className={`text-sm font-mono ${pass ? 'text-emerald-400' : 'text-red-400'}`}>{metrics.freq_error_hz} Hz</div>
        </div>
      </div>
    </div>
  );
}

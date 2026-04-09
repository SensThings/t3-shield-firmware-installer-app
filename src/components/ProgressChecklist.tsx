'use client';

import { useEffect, useState } from 'react';
import { InstallStep } from '@/lib/types';

interface ProgressChecklistProps {
  steps: InstallStep[];
  serialNumber: string;
  startTime: number;
  mode: 'install' | 'sdr_test';
}

export default function ProgressChecklist({ steps, serialNumber, startTime, mode }: ProgressChecklistProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed((Date.now() - startTime) / 1000);
    }, 100);
    return () => clearInterval(interval);
  }, [startTime]);

  const allDone = steps.every(s => s.status === 'pass' || s.status === 'fail' || s.status === 'skipped');

  return (
    <div className="w-full max-w-xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-zinc-100">
          {mode === 'install' ? 'Programmation' : 'Test SDR'} : T3S-{serialNumber}
        </h2>
        <span className="text-sm text-zinc-400 font-mono">
          {elapsed.toFixed(1)}s
        </span>
      </div>

      <div className="space-y-1">
        {steps.map((step) => (
          <StepRow key={step.id} step={step} />
        ))}
      </div>

      {!allDone && (
        <div className="mt-6 text-center text-sm text-zinc-500">
          Temps écoulé : {elapsed.toFixed(1)}s...
        </div>
      )}
    </div>
  );
}

function StepRow({ step }: { step: InstallStep }) {
  const [liveElapsed, setLiveElapsed] = useState(0);

  useEffect(() => {
    if (step.status !== 'in_progress' || !step.startedAt) return;
    const interval = setInterval(() => {
      setLiveElapsed((Date.now() - step.startedAt!) / 1000);
    }, 100);
    return () => clearInterval(interval);
  }, [step.status, step.startedAt]);

  return (
    <div
      className={`flex items-start gap-3 py-2 px-3 rounded-lg ${
        step.status === 'in_progress' ? 'bg-zinc-800/50' : ''
      } ${step.status === 'fail' ? 'bg-red-900/20' : ''}`}
    >
      <div className="mt-0.5 flex-shrink-0">
        {step.status === 'pending' && (
          <div className="w-5 h-5 rounded-full border-2 border-zinc-700" />
        )}
        {step.status === 'in_progress' && (
          <div className="w-5 h-5">
            <svg className="w-5 h-5 animate-spin text-amber-500" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        )}
        {step.status === 'pass' && (
          <svg className="w-5 h-5 text-emerald-500" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
        )}
        {step.status === 'fail' && (
          <svg className="w-5 h-5 text-red-500" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
        )}
        {step.status === 'skipped' && (
          <div className="w-5 h-5 rounded-full border-2 border-zinc-800 bg-zinc-800/50" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span
            className={`text-sm ${
              step.status === 'pending' || step.status === 'skipped'
                ? 'text-zinc-600'
                : step.status === 'fail'
                ? 'text-red-400'
                : 'text-zinc-300'
            }`}
          >
            {step.number}. {step.label}
          </span>
          {step.status === 'pass' && step.duration !== undefined && (
            <span className="text-xs text-zinc-500 font-mono">{step.duration.toFixed(1)}s</span>
          )}
          {step.status === 'in_progress' && (
            <span className="text-xs text-amber-500 font-mono">{liveElapsed.toFixed(1)}s...</span>
          )}
        </div>
        {step.message && step.status !== 'pending' && (
          <p
            className={`text-xs mt-0.5 ${
              step.status === 'fail' ? 'text-red-400/80' : 'text-zinc-500'
            }`}
          >
            {step.message}
          </p>
        )}
      </div>
    </div>
  );
}

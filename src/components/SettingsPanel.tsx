'use client';

import { useState } from 'react';
import { Settings } from '@/lib/types';

interface SettingsPanelProps {
  settings: Settings;
  onSave: (settings: Settings) => void;
  onClose: () => void;
}

export default function SettingsPanel({ settings, onSave, onClose }: SettingsPanelProps) {
  const [form, setForm] = useState<Settings>({ ...settings });
  const [showPassword, setShowPassword] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [testingGhcr, setTestingGhcr] = useState(false);
  const [ghcrResult, setGhcrResult] = useState<{ success: boolean; message: string } | null>(null);

  const update = (key: keyof Settings, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/settings/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: form.deviceIp,
          username: form.sshUsername,
          password: form.sshPassword,
        }),
      });
      const data = await res.json();
      setTestResult(data);
    } catch {
      setTestResult({ success: false, message: 'Request failed' });
    } finally {
      setTesting(false);
    }
  };

  const handleTestGhcr = async () => {
    setTestingGhcr(true);
    setGhcrResult(null);
    try {
      const res = await fetch('/api/settings/test-ghcr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: form.ghcrUsername,
          token: form.ghcrToken,
          image: form.firmwareImage,
        }),
      });
      const data = await res.json();
      setGhcrResult(data);
    } catch {
      setGhcrResult({ success: false, message: 'Request failed' });
    } finally {
      setTestingGhcr(false);
    }
  };

  const handleSave = () => {
    onSave(form);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-lg p-6 shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-zinc-100">Settings</h2>
          <button
            onClick={onClose}
            className="p-1 text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Connection */}
        <div className="mb-6">
          <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Connection</h3>
          <div className="space-y-3 bg-zinc-800/50 rounded-lg p-4">
            <Field label="Device IP" value={form.deviceIp} onChange={v => update('deviceIp', v)} />
            <Field label="SSH Username" value={form.sshUsername} onChange={v => update('sshUsername', v)} />
            <div className="relative">
              <Field
                label="SSH Password"
                value={form.sshPassword}
                onChange={v => update('sshPassword', v)}
                type={showPassword ? 'text' : 'password'}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-7 text-zinc-500 hover:text-zinc-300 text-xs"
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>

            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={handleTestConnection}
                disabled={testing}
                className="px-3 py-1.5 text-sm bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-zinc-200 rounded-md transition-colors"
              >
                {testing ? 'Testing...' : 'Test Connection'}
              </button>
              {testResult && (
                <span className={`text-sm ${testResult.success ? 'text-emerald-400' : 'text-red-400'}`}>
                  {testResult.success ? '\u2713' : '\u2717'} {testResult.message}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Container Registry */}
        <div className="mb-6">
          <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Container Registry</h3>
          <div className="space-y-3 bg-zinc-800/50 rounded-lg p-4">
            <Field label="GHCR Username" value={form.ghcrUsername} onChange={v => update('ghcrUsername', v)} placeholder="GitHub username" />
            <div className="relative">
              <Field
                label="GHCR Token"
                value={form.ghcrToken}
                onChange={v => update('ghcrToken', v)}
                type={showToken ? 'text' : 'password'}
                placeholder="GitHub PAT with read:packages"
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="absolute right-2 top-7 text-zinc-500 hover:text-zinc-300 text-xs"
              >
                {showToken ? 'Hide' : 'Show'}
              </button>
            </div>
            <Field label="Firmware Image" value={form.firmwareImage} onChange={v => update('firmwareImage', v)} />

            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={handleTestGhcr}
                disabled={testingGhcr || !form.ghcrUsername || !form.ghcrToken}
                className="px-3 py-1.5 text-sm bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-zinc-200 rounded-md transition-colors"
              >
                {testingGhcr ? 'Testing...' : 'Test GHCR'}
              </button>
              {ghcrResult && (
                <span className={`text-sm ${ghcrResult.success ? 'text-emerald-400' : 'text-red-400'}`}>
                  {ghcrResult.success ? '\u2713' : '\u2717'} {ghcrResult.message}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-zinc-500 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-1.5 bg-zinc-900 border border-zinc-700 rounded-md text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
      />
    </div>
  );
}

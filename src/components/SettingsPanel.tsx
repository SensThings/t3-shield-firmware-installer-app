'use client';

import { useState, useEffect } from 'react';
import { Settings } from '@/lib/types';
import { UserRole } from '@/lib/auth';
import {
  testConnection as apiTestConnection,
  testGhcr as apiTestGhcr,
  clearCache as apiClearCache,
  getSdrTestConfig,
  updateSdrTestConfig,
  getAntennaTestConfig,
  updateAntennaTestConfig,
} from '@/lib/api';

interface SettingsPanelProps {
  settings: Settings;
  role?: UserRole;
  onSave: (settings: Settings) => void;
  onClose: () => void;
}

const SDR_CONFIG_FIELDS: { key: string; label: string; unit: string }[] = [
  { key: 'center_freq_hz', label: 'Fréquence centrale', unit: 'Hz' },
  { key: 'sample_rate_hz', label: 'Taux d\'échantillonnage', unit: 'Hz' },
  { key: 'tone_offset_a_hz', label: 'Offset tone A', unit: 'Hz' },
  { key: 'tone_offset_b_hz', label: 'Offset tone B', unit: 'Hz' },
  { key: 'tx_gain', label: 'Gain TX', unit: 'dB' },
  { key: 'rx_gain', label: 'Gain RX', unit: 'dB' },
  { key: 'capture_duration_s', label: 'Durée capture', unit: 's' },
  { key: 'snr_threshold_db', label: 'Seuil SNR', unit: 'dB' },
  { key: 'freq_tolerance_hz', label: 'Tolérance fréquence', unit: 'Hz' },
  { key: 'search_bandwidth_hz', label: 'Bande de recherche', unit: 'Hz' },
  { key: 'rx_analysis_samples', label: 'Échantillons analyse', unit: '' },
  { key: 'tx_init_wait_s', label: 'Attente init TX', unit: 's' },
  { key: 'tx_init_wait_dual_s', label: 'Attente init TX (dual)', unit: 's' },
  { key: 'rx_init_timeout_s', label: 'Timeout init RX', unit: 's' },
];

const ANTENNA_CONFIG_FIELDS: { key: string; label: string; unit: string }[] = [
  { key: 'center_freq_hz', label: 'Fréquence centrale', unit: 'Hz' },
  { key: 'sample_rate_hz', label: 'Taux d\'échantillonnage', unit: 'Hz' },
  { key: 'tone_offset_a_hz', label: 'Offset tone A', unit: 'Hz' },
  { key: 'tx_gain', label: 'Gain TX', unit: 'dB' },
  { key: 'rx_gain', label: 'Gain RX', unit: 'dB' },
  { key: 'capture_duration_s', label: 'Durée capture', unit: 's' },
  { key: 'snr_threshold_db', label: 'Seuil SNR', unit: 'dB' },
  { key: 'freq_tolerance_hz', label: 'Tolérance fréquence', unit: 'Hz' },
  { key: 'search_bandwidth_hz', label: 'Bande de recherche', unit: 'Hz' },
  { key: 'rx_analysis_samples', label: 'Échantillons analyse', unit: '' },
  { key: 'tx_init_wait_s', label: 'Attente init TX', unit: 's' },
  { key: 'rx_init_timeout_s', label: 'Timeout init RX', unit: 's' },
];

export default function SettingsPanel({ settings, role = 'op', onSave, onClose }: SettingsPanelProps) {
  const [form, setForm] = useState<Settings>({ ...settings });
  const [showPassword, setShowPassword] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [testingGhcr, setTestingGhcr] = useState(false);
  const [ghcrResult, setGhcrResult] = useState<{ success: boolean; message: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<string | null>(null);

  // SDR config
  const [sdrConfig, setSdrConfig] = useState<Record<string, number>>({});
  const [antennaConfig, setAntennaConfig] = useState<Record<string, number>>({});
  const [configSaving, setConfigSaving] = useState(false);
  const [configMsg, setConfigMsg] = useState('');
  const [showSdrConfig, setShowSdrConfig] = useState(false);
  const [showAntennaConfig, setShowAntennaConfig] = useState(false);

  useEffect(() => {
    getSdrTestConfig().then(setSdrConfig).catch(() => {});
    getAntennaTestConfig().then(setAntennaConfig).catch(() => {});
  }, []);

  const update = (key: keyof Settings, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const data = await apiTestConnection(form.deviceIp, form.sshUsername, form.sshPassword);
      setTestResult(data);
    } catch {
      setTestResult({ success: false, message: 'Requête échouée' });
    } finally {
      setTesting(false);
    }
  };

  const handleTestGhcr = async () => {
    setTestingGhcr(true);
    setGhcrResult(null);
    try {
      const data = await apiTestGhcr(form.ghcrUsername, form.ghcrToken, form.firmwareImage);
      setGhcrResult(data);
    } catch {
      setGhcrResult({ success: false, message: 'Requête échouée' });
    } finally {
      setTestingGhcr(false);
    }
  };

  const handleSaveConfig = async (type: 'sdr' | 'antenna') => {
    setConfigSaving(true);
    setConfigMsg('');
    try {
      if (type === 'sdr') {
        await updateSdrTestConfig(sdrConfig);
      } else {
        await updateAntennaTestConfig(antennaConfig);
      }
      setConfigMsg('Configuration sauvegardée');
    } catch {
      setConfigMsg('Erreur de sauvegarde');
    } finally {
      setConfigSaving(false);
      setTimeout(() => setConfigMsg(''), 3000);
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
          <h2 className="text-lg font-semibold text-zinc-100">Paramètres</h2>
          <button onClick={onClose} className="p-1 text-zinc-400 hover:text-zinc-200 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Target Device — only for op role */}
        {role === 'op' && (
          <div className="mb-6">
            <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Appareil cible</h3>
            <div className="space-y-3 bg-zinc-800/50 rounded-lg p-4">
              <Field label="Adresse IP" value={form.deviceIp} onChange={v => update('deviceIp', v)} />
              <Field label="Utilisateur SSH" value={form.sshUsername} onChange={v => update('sshUsername', v)} />
              <div className="relative">
                <Field label="Mot de passe SSH" value={form.sshPassword} onChange={v => update('sshPassword', v)} type={showPassword ? 'text' : 'password'} />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-2 top-7 text-zinc-500 hover:text-zinc-300 text-xs">
                  {showPassword ? 'Masquer' : 'Afficher'}
                </button>
              </div>
              <div className="flex items-center gap-3 pt-1">
                <button onClick={handleTestConnection} disabled={testing} className="px-3 py-1.5 text-sm bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-zinc-200 rounded-md transition-colors">
                  {testing ? 'Test en cours...' : 'Tester la connexion'}
                </button>
                {testResult && (
                  <span className={`text-sm ${testResult.success ? 'text-emerald-400' : 'text-red-400'}`}>
                    {testResult.success ? '\u2713' : '\u2717'} {testResult.message}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Container Registry — only for op role */}
        {role === 'op' && (
          <div className="mb-6">
            <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Registre de conteneurs</h3>
            <div className="space-y-3 bg-zinc-800/50 rounded-lg p-4">
              <Field label="Utilisateur GHCR" value={form.ghcrUsername} onChange={v => update('ghcrUsername', v)} placeholder="Nom d'utilisateur GitHub" />
              <div className="relative">
                <Field label="Jeton GHCR" value={form.ghcrToken} onChange={v => update('ghcrToken', v)} type={showToken ? 'text' : 'password'} placeholder="PAT GitHub avec read:packages" />
                <button type="button" onClick={() => setShowToken(!showToken)} className="absolute right-2 top-7 text-zinc-500 hover:text-zinc-300 text-xs">
                  {showToken ? 'Masquer' : 'Afficher'}
                </button>
              </div>
              <Field label="Image firmware" value={form.firmwareImage} onChange={v => update('firmwareImage', v)} />
              <div className="flex items-center gap-3 pt-1 flex-wrap">
                <button onClick={handleTestGhcr} disabled={testingGhcr || !form.ghcrUsername || !form.ghcrToken} className="px-3 py-1.5 text-sm bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-zinc-200 rounded-md transition-colors">
                  {testingGhcr ? 'Test en cours...' : 'Tester GHCR'}
                </button>
                <button
                  onClick={async () => {
                    setRefreshing(true); setRefreshResult(null);
                    try { await apiClearCache(); setRefreshResult('Cache vidé'); } catch { setRefreshResult('Échec'); }
                    finally { setRefreshing(false); }
                  }}
                  disabled={refreshing}
                  className="px-3 py-1.5 text-sm bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-zinc-200 rounded-md transition-colors"
                >
                  {refreshing ? 'Vidage...' : 'Rafraîchir l\'image'}
                </button>
                {ghcrResult && <span className={`text-sm ${ghcrResult.success ? 'text-emerald-400' : 'text-red-400'}`}>{ghcrResult.success ? '\u2713' : '\u2717'} {ghcrResult.message}</span>}
                {refreshResult && <span className="text-sm text-zinc-400">{refreshResult}</span>}
              </div>
            </div>
          </div>
        )}

        {/* SDR Test Config — for op role */}
        {role === 'op' && (
          <div className="mb-6">
            <button onClick={() => setShowSdrConfig(!showSdrConfig)} className="flex items-center gap-2 text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3 hover:text-zinc-200 transition-colors">
              <span className={`transition-transform ${showSdrConfig ? 'rotate-90' : ''}`}>&#9654;</span>
              Paramètres test SDR
            </button>
            {showSdrConfig && (
              <div className="space-y-2 bg-zinc-800/50 rounded-lg p-4">
                {SDR_CONFIG_FIELDS.map(f => (
                  <ConfigField
                    key={f.key}
                    label={f.label}
                    unit={f.unit}
                    value={sdrConfig[f.key] ?? ''}
                    onChange={v => setSdrConfig(prev => ({ ...prev, [f.key]: parseFloat(v) || 0 }))}
                  />
                ))}
                <div className="flex items-center gap-3 pt-2">
                  <button onClick={() => handleSaveConfig('sdr')} disabled={configSaving} className="px-3 py-1.5 text-sm bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white rounded-md transition-colors">
                    {configSaving ? 'Sauvegarde...' : 'Sauvegarder SDR'}
                  </button>
                  {configMsg && <span className="text-sm text-zinc-400">{configMsg}</span>}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Antenna Test Config — for antenna role (or both) */}
        <div className="mb-6">
          <button onClick={() => setShowAntennaConfig(!showAntennaConfig)} className="flex items-center gap-2 text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3 hover:text-zinc-200 transition-colors">
            <span className={`transition-transform ${showAntennaConfig ? 'rotate-90' : ''}`}>&#9654;</span>
            Paramètres test antenne
          </button>
          {showAntennaConfig && (
            <div className="space-y-2 bg-zinc-800/50 rounded-lg p-4">
              {ANTENNA_CONFIG_FIELDS.map(f => (
                <ConfigField
                  key={f.key}
                  label={f.label}
                  unit={f.unit}
                  value={antennaConfig[f.key] ?? ''}
                  onChange={v => setAntennaConfig(prev => ({ ...prev, [f.key]: parseFloat(v) || 0 }))}
                />
              ))}
              <div className="flex items-center gap-3 pt-2">
                <button onClick={() => handleSaveConfig('antenna')} disabled={configSaving} className="px-3 py-1.5 text-sm bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white rounded-md transition-colors">
                  {configSaving ? 'Sauvegarde...' : 'Sauvegarder antenne'}
                </button>
                {configMsg && <span className="text-sm text-zinc-400">{configMsg}</span>}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <button onClick={handleSave} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium transition-colors">
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', placeholder }: {
  label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-zinc-500 mb-1">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full px-3 py-1.5 bg-zinc-900 border border-zinc-700 rounded-md text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500" />
    </div>
  );
}

function ConfigField({ label, unit, value, onChange }: {
  label: string; unit: string; value: number | string; onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-zinc-500 w-40 flex-shrink-0">{label}</label>
      <input type="number" value={value} onChange={e => onChange(e.target.value)} step="any"
        className="flex-1 px-2 py-1 bg-zinc-900 border border-zinc-700 rounded-md text-xs text-zinc-200 font-mono focus:outline-none focus:ring-1 focus:ring-emerald-500" />
      {unit && <span className="text-xs text-zinc-600 w-8">{unit}</span>}
    </div>
  );
}

export interface Settings {
  deviceIp: string;
  sshUsername: string;
  sshPassword: string;
  ghcrUsername: string;
  ghcrToken: string;
  firmwareImage: string;
}

export const DEFAULT_SETTINGS: Settings = {
  deviceIp: '192.168.137.100',
  sshUsername: 'dragon',
  sshPassword: 'Sensthings@012',
  ghcrUsername: 'elmoadin',
  ghcrToken: 'REPLACE_WITH_YOUR_GHCR_TOKEN',
  firmwareImage: 'ghcr.io/sensthings/t3shield-firmware:latest',
};

export type StepStatus = 'pending' | 'in_progress' | 'pass' | 'fail' | 'skipped';

export interface InstallStep {
  id: string;
  number: number;
  label: string;
  status: StepStatus;
  message?: string;
  duration?: number;
  startedAt?: number;
  /** Whether this step is updated via prep_step (by id) or step_update (by number) */
  source: 'prep' | 'install';
  /** For install-source steps, the backend step_number (1-based within install phase) */
  backendNumber?: number;
}

// Unified install steps: prep + install in one list, French labels
export const INSTALL_STEPS: { id: string; label: string; source: 'prep' | 'install' }[] = [
  // Prep phase (updated via prep_step events by step_id)
  { id: 'prepare_docker', label: 'Préparer les binaires Docker', source: 'prep' },
  { id: 'prepare_firmware', label: 'Préparer l\'image firmware', source: 'prep' },
  { id: 'upload_script', label: 'Transférer le script d\'installation', source: 'prep' },
  { id: 'upload_docker', label: 'Transférer les binaires Docker', source: 'prep' },
  { id: 'upload_firmware', label: 'Transférer l\'image firmware', source: 'prep' },
  // Install phase (updated via step_update events by step_number)
  { id: 'set_hostname', label: 'Définir le nom de l\'appareil', source: 'install' },
  { id: 'expand_partition', label: 'Étendre la partition SD', source: 'install' },
  { id: 'configure_network', label: 'Configurer le réseau', source: 'install' },
  { id: 'docker_install', label: 'Installer Docker', source: 'install' },
  { id: 'create_dirs', label: 'Créer les répertoires', source: 'install' },
  { id: 'write_config', label: 'Écrire la configuration', source: 'install' },
  { id: 'registry_login', label: 'Connexion au registre', source: 'install' },
  { id: 'pull_image', label: 'Télécharger l\'image firmware', source: 'install' },
  { id: 'install_update_script', label: 'Installer le script de mise à jour', source: 'install' },
  { id: 'start_container', label: 'Démarrer le conteneur', source: 'install' },
  { id: 'health_check', label: 'Vérification de santé', source: 'install' },
  { id: 'sdr_warmup', label: 'Préchauffage SDR', source: 'install' },
  { id: 'sdr_verify', label: 'Vérifier le statut SDR', source: 'install' },
];

// Unified SDR test steps: prep + test in one list, French labels
export const SDR_TEST_STEPS: { id: string; label: string; source: 'prep' | 'install' }[] = [
  // Prep phase
  { id: 'check_desktop_sdr', label: 'Vérifier le SDR du poste', source: 'prep' },
  { id: 'upload_test_scripts', label: 'Transférer les scripts de test', source: 'prep' },
  { id: 'start_transmitter', label: 'Démarrer l\'émetteur', source: 'prep' },
  // Test phase (updated via step_update events)
  { id: 'init_receiver', label: 'Initialiser le récepteur SDR', source: 'install' },
  { id: 'run_test', label: 'Capturer et analyser le signal RF', source: 'install' },
  { id: 'validate_results', label: 'Valider les résultats', source: 'install' },
];

// Antenna test steps: prep (desktop-side) + test (desktop-side, no SSH)
export const ANTENNA_TEST_STEPS: { id: string; label: string; source: 'prep' | 'install' }[] = [
  // Prep phase
  { id: 'check_desktop_sdrs', label: 'Vérifier les SDR du poste', source: 'prep' },
  { id: 'start_transmitter', label: 'Démarrer l\'émetteur', source: 'prep' },
  // Test phase (step_update events)
  { id: 'start_receiver', label: 'Démarrer le récepteur', source: 'install' },
  { id: 'capture', label: 'Capturer le signal RF', source: 'install' },
  { id: 'validate_results', label: 'Valider les résultats', source: 'install' },
];

export interface InstallResult {
  operation: string;
  image: string;
  version: string | null;
  started_at: string;
  finished_at: string;
  result: 'pass' | 'fail';
  steps: {
    id: number;
    name: string;
    label: string;
    status: 'pass' | 'fail' | 'skipped';
    message: string | null;
    duration_s: number | null;
  }[];
}

// Backend sends snake_case
export interface StepUpdateEvent {
  step_number: number;
  status: StepStatus;
  message?: string;
  operator_message?: string;
  duration?: number;
}

export interface PrepStepEvent {
  step_id: string;
  status: StepStatus;
  message?: string;
  operator_message?: string;
}

export interface CacheStatus {
  dockerBinaries: boolean;
  firmwareImage: boolean;
  firmwareTag: string | null;
}

export interface InstallCompleteEvent {
  result: InstallResult;
}

export interface InstallErrorEvent {
  error: string;
  operator_message?: string;
}

// SDR metrics — single channel (flat) or dual channel (per-channel)
export interface ChannelMetrics {
  status: string;
  peak_freq_hz: number;
  expected_freq_hz: number;
  freq_error_hz: number;
  snr_db: number;
  snr_threshold_db: number;
  peak_power_db: number;
  noise_floor_db: number;
}

export interface SdrMetrics {
  status: string;
  // Single-channel fields (flat)
  peak_freq_hz?: number;
  expected_freq_hz?: number;
  freq_error_hz?: number;
  snr_db?: number;
  snr_threshold_db?: number;
  peak_power_db?: number;
  noise_floor_db?: number;
  // Dual-channel fields
  channel_a?: ChannelMetrics;
  channel_b?: ChannelMetrics;
}

export interface TestConnectionResult {
  success: boolean;
  message: string;
  latencyMs?: number;
}

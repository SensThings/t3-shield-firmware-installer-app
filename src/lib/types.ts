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
  ghcrUsername: '',
  ghcrToken: '',
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
}

export const PREP_STEPS: { id: string; label: string }[] = [
  { id: 'prepare_docker', label: 'Prepare Docker binaries' },
  { id: 'prepare_firmware', label: 'Prepare firmware image' },
  { id: 'upload_script', label: 'Upload install script' },
  { id: 'upload_docker', label: 'Upload Docker binaries' },
  { id: 'upload_firmware', label: 'Upload firmware image' },
];

export const INSTALL_STEPS: { id: string; label: string }[] = [
  { id: 'set_hostname', label: 'Set device hostname' },
  { id: 'configure_network', label: 'Configure network' },
  { id: 'docker_install', label: 'Install Docker' },
  { id: 'create_dirs', label: 'Create data directories' },
  { id: 'write_config', label: 'Write default config' },
  { id: 'registry_login', label: 'Login to registry' },
  { id: 'pull_image', label: 'Pull firmware image' },
  { id: 'install_update_script', label: 'Install update script' },
  { id: 'start_container', label: 'Start container' },
  { id: 'health_check', label: 'Health check' },
  { id: 'sdr_warmup', label: 'SDR warmup' },
  { id: 'sdr_verify', label: 'Verify SDR status' },
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

export interface StepUpdateEvent {
  stepNumber: number;
  status: StepStatus;
  message?: string;
  duration?: number;
}

export interface PrepStepEvent {
  stepId: string;
  status: StepStatus;
  message?: string;
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
}

export interface TestConnectionResult {
  success: boolean;
  message: string;
  latencyMs?: number;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export async function startInstall(serialNumber: string, settings: Record<string, string>) {
  const res = await fetch(`${API_BASE}/install`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      serial_number: serialNumber,
      settings: {
        device_ip: settings.deviceIp,
        ssh_username: settings.sshUsername,
        ssh_password: settings.sshPassword,
        ghcr_username: settings.ghcrUsername,
        ghcr_token: settings.ghcrToken,
        firmware_image: settings.firmwareImage,
      },
    }),
  });
  return res.json();
}

export function subscribeProgress(apiPath: string, id: string): EventSource {
  return new EventSource(`${API_BASE}/${apiPath}/${id}/progress`);
}

export async function startSdrTest(serialNumber: string, settings: Record<string, string>, dualChannel: boolean = true) {
  const res = await fetch(`${API_BASE}/sdr-test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      serial_number: serialNumber,
      dual_channel: dualChannel,
      settings: {
        device_ip: settings.deviceIp,
        ssh_username: settings.sshUsername,
        ssh_password: settings.sshPassword,
        ghcr_username: settings.ghcrUsername,
        ghcr_token: settings.ghcrToken,
        firmware_image: settings.firmwareImage,
      },
    }),
  });
  return res.json();
}

export async function startAntennaTest(label: string, dualChannel: boolean = true) {
  const res = await fetch(`${API_BASE}/antenna-test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      label,
      dual_channel: dualChannel,
    }),
  });
  return res.json();
}

export async function testConnection(host: string, username: string, password: string) {
  const res = await fetch(`${API_BASE}/settings/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ host, username, password }),
  });
  return res.json();
}

export async function testGhcr(username: string, token: string, image: string) {
  const res = await fetch(`${API_BASE}/settings/test-ghcr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, token, image }),
  });
  return res.json();
}

export async function getCacheStatus() {
  const res = await fetch(`${API_BASE}/cache`);
  return res.json();
}

export async function clearCache() {
  const res = await fetch(`${API_BASE}/cache`, { method: 'DELETE' });
  return res.json();
}

export async function getDeviceSettings() {
  const res = await fetch(`${API_BASE}/config/settings`);
  return res.json();
}

export async function updateDeviceSettings(config: Record<string, string>) {
  const res = await fetch(`${API_BASE}/config/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  return res.json();
}

export async function getSdrTestConfig() {
  const res = await fetch(`${API_BASE}/config/sdr-test`);
  return res.json();
}

export async function updateSdrTestConfig(config: Record<string, number>) {
  const res = await fetch(`${API_BASE}/config/sdr-test`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  return res.json();
}

export async function getAntennaTestConfig() {
  const res = await fetch(`${API_BASE}/config/antenna-test`);
  return res.json();
}

export async function updateAntennaTestConfig(config: Record<string, number>) {
  const res = await fetch(`${API_BASE}/config/antenna-test`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  return res.json();
}

export async function login(username: string, password: string) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return res.json();
}

export interface ChecklistItem {
  id: string;
  label: string;
}

export async function getChecklist(): Promise<ChecklistItem[]> {
  const res = await fetch(`${API_BASE}/checklist`);
  const data = await res.json();
  return data.items || data;
}

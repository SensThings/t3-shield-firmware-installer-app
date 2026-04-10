const AUTH_KEY = 't3shield-auth';

export type UserRole = 'op' | 'antenna';

interface AuthState {
  username: string;
  role: UserRole;
  loggedInAt: string;
}

export function isLoggedIn(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(AUTH_KEY) !== null;
}

export function getAuth(): AuthState | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(AUTH_KEY);
    if (!stored) return null;
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

export function setAuth(username: string, role: UserRole): void {
  if (typeof window === 'undefined') return;
  const state: AuthState = { username, role, loggedInAt: new Date().toISOString() };
  localStorage.setItem(AUTH_KEY, JSON.stringify(state));
}

export function clearAuth(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(AUTH_KEY);
}

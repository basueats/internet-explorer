export interface SavedSpaceBookmark {
  spaceName: string;
  normalizedName: string;
  passphrase: string;
  alias: string;
  updatedAt: number;
}

const LAST_SESSION_KEY = 'veil_last_session';
const AUTO_RESUME_KEY = 'veil_auto_resume';

export function buildMeetingInviteUrl(normalizedName: string, passphrase: string): string {
  return `${window.location.origin}/?space=${encodeURIComponent(
    normalizedName
  )}#${encodeURIComponent(passphrase)}`;
}

export function saveLastSession(bookmark: SavedSpaceBookmark, autoResume = true): void {
  try {
    localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(bookmark));
    localStorage.setItem(AUTO_RESUME_KEY, autoResume ? 'true' : 'false');
  } catch {
    // Ignore storage quota / privacy mode errors
  }
}

export function setAutoResumeSession(autoResume: boolean): void {
  try {
    localStorage.setItem(AUTO_RESUME_KEY, autoResume ? 'true' : 'false');
  } catch {
    // Ignore
  }
}

export function getSavedLastSession(): {
  bookmark: SavedSpaceBookmark;
  autoResume: boolean;
} | null {
  try {
    const raw = localStorage.getItem(LAST_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedSpaceBookmark>;
    if (!parsed.spaceName || !parsed.normalizedName || !parsed.passphrase) {
      return null;
    }
    const autoResume = localStorage.getItem(AUTO_RESUME_KEY) === 'true';
    return {
      bookmark: {
        spaceName: parsed.spaceName,
        normalizedName: parsed.normalizedName,
        passphrase: parsed.passphrase,
        alias: parsed.alias || 'Partner',
        updatedAt: parsed.updatedAt || Date.now(),
      },
      autoResume,
    };
  } catch {
    return null;
  }
}

export function clearSavedLastSession(): void {
  try {
    localStorage.removeItem(LAST_SESSION_KEY);
    localStorage.removeItem(AUTO_RESUME_KEY);
  } catch {
    // Ignore
  }
}

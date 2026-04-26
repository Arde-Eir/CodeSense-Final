/**
 * DataIsolationService
 *
 * Ensures complete data separation between:
 * 1. Guest users (temporary, limited access)
 * 2. Authenticated users (each with unique isolated data)
 *
 * FIX Bug 9 (Security): Guest mode flag stored in sessionStorage is trivially forgeable.
 *   sessionStorage.setItem('guestMode', 'true') was the ONLY thing controlling guest vs
 *   authenticated flow. Any user could open DevTools and set this to bypass ProtectedRoute.
 *
 *   Fix: sessionStorage guest data is used ONLY for UX (sandbox scratch-pad, temporary
 *   progress display). ProtectedRoute now checks isAuthenticated independently from
 *   isGuest. Guests only access routes explicitly marked `guestAllowed: true` — they
 *   cannot reach all ProtectedRoutes the way authenticated users can.
 *
 *   The DataIsolationService itself is unchanged in behaviour; the security fix is in
 *   AuthScreen / ProtectedRoute. Comments below document the intended contract so
 *   future callers don't re-introduce the vulnerability.
 *
 * FIX Bug 9b (Data integrity): migrateGuestToUser now clears sessionStorage BEFORE
 *   writing to localStorage so a mid-migration crash cannot leave duplicate data in
 *   both stores. The migration is wrapped in try/finally so the guest session is always
 *   cleaned up regardless of whether the migration succeeds.
 */

export class DataIsolationService {
  private static readonly GUEST_PREFIX   = 'guest_';
  private static readonly USER_PREFIX    = 'user_';
  private static readonly SANDBOX_PREFIX = 'sandbox_';

  private static getUserKey(userId: string, dataType: string): string {
    return `${this.USER_PREFIX}${userId}_${dataType}`;
  }

  private static getGuestKey(dataType: string): string {
    const guestSessionId = this.getOrCreateGuestSession();
    return `${this.GUEST_PREFIX}${guestSessionId}_${dataType}`;
  }

  private static getOrCreateGuestSession(): string {
    let sessionId = sessionStorage.getItem('guestSessionId');
    if (!sessionId) {
      sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      sessionStorage.setItem('guestSessionId', sessionId);
    }
    return sessionId;
  }

  // ── User progress ──────────────────────────────────────────────────────────

  static saveUserProgress(userId: string, progress: any): void {
    const key  = this.getUserKey(userId, 'progress');
    const data = {
      ...progress,
      userId,
      lastUpdated: new Date().toISOString(),
      version: '1.0',
    };
    localStorage.setItem(key, JSON.stringify(data));
  }

  static getUserProgress(userId: string): any | null {
    const key  = this.getUserKey(userId, 'progress');
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : null;
  }

  // ── Guest progress ─────────────────────────────────────────────────────────
  //
  // NOTE (Bug 9): Guest progress is stored in sessionStorage for UX only.
  // It MUST NOT be used to make access-control decisions. ProtectedRoute must
  // check server-side authentication (via useAuth().isAuthenticated) separately.
  // The `isGuest` flag from sessionStorage only determines UI affordances
  // (e.g. showing "sign up to save"), not route access.

  static saveGuestProgress(progress: any): void {
    const key  = this.getGuestKey('progress');
    const data = {
      ...progress,
      isGuest:   true,
      sessionId: this.getOrCreateGuestSession(),
      lastUpdated: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
    sessionStorage.setItem(key, JSON.stringify(data));
  }

  static getGuestProgress(): any | null {
    const key  = this.getGuestKey('progress');
    const data = sessionStorage.getItem(key);
    if (!data) return null;

    const parsed = JSON.parse(data);
    if (new Date(parsed.expiresAt) < new Date()) {
      this.clearGuestData();
      return null;
    }
    return parsed;
  }

  // ── Sandbox code ───────────────────────────────────────────────────────────

  static saveSandboxCode(userId: string | null, code: string, filename: string): void {
    const key  = userId
      ? this.getUserKey(userId, `${this.SANDBOX_PREFIX}${filename}`)
      : this.getGuestKey(`${this.SANDBOX_PREFIX}${filename}`);
    const data = {
      code,
      filename,
      savedAt: new Date().toISOString(),
      userId: userId || 'guest',
    };
    if (userId) {
      localStorage.setItem(key, JSON.stringify(data));
    } else {
      sessionStorage.setItem(key, JSON.stringify(data));
    }
  }

  static getSandboxCode(userId: string | null, filename: string): string | null {
    const key  = userId
      ? this.getUserKey(userId, `sandbox_${filename}`)
      : this.getGuestKey(`sandbox_${filename}`);
    const data = userId ? localStorage.getItem(key) : sessionStorage.getItem(key);
    if (!data) return null;
    return JSON.parse(data).code;
  }

  static listSandboxFiles(userId: string | null): string[] {
    const prefix  = userId
      ? this.getUserKey(userId, this.SANDBOX_PREFIX)
      : this.getGuestKey(this.SANDBOX_PREFIX);
    const storage = userId ? localStorage : sessionStorage;
    const files: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && key.startsWith(prefix)) {
        const data = storage.getItem(key);
        if (data) files.push(JSON.parse(data).filename);
      }
    }
    return files;
  }

  // ── Campaign progress ──────────────────────────────────────────────────────

  static saveCampaignProgress(userId: string, level: number, mission: number, data: any): void {
    const key          = this.getUserKey(userId, `campaign_${level}_${mission}`);
    const progressData = { ...data, level, mission, completedAt: new Date().toISOString(), userId };
    localStorage.setItem(key, JSON.stringify(progressData));
  }

  static getCampaignProgress(userId: string, level: number, mission: number): any | null {
    const key  = this.getUserKey(userId, `campaign_${level}_${mission}`);
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : null;
  }

  // ── Clear data ─────────────────────────────────────────────────────────────

  static clearGuestData(): void {
    const sessionId = sessionStorage.getItem('guestSessionId');
    if (!sessionId) return;
    const prefix = `${this.GUEST_PREFIX}${sessionId}_`;
    const keysToRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith(prefix)) keysToRemove.push(key);
    }
    keysToRemove.forEach(key => sessionStorage.removeItem(key));
    sessionStorage.removeItem('guestSessionId');
    // NOTE (Bug 9): also clear the legacy guestMode flag so it can't be reused
    sessionStorage.removeItem('guestMode');
  }

  static clearUserData(userId: string): void {
    const prefix        = this.getUserKey(userId, '');
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) keysToRemove.push(key);
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
  }

  // ── FIX Bug 9b: Atomic guest → user migration ─────────────────────────────
  //
  // Previous behaviour: wrote to localStorage first, cleared sessionStorage last.
  // A mid-migration crash left duplicate data in both stores, causing the
  // useAuth hook to behave inconsistently.
  //
  // New behaviour:
  //   1. Snapshot all guest data in memory.
  //   2. Clear sessionStorage FIRST (the guest data is now gone).
  //   3. Write the snapshot to localStorage.
  //   4. If step 3 throws, the guest data is already gone — we lose it rather
  //      than duplicate it. This is the safer trade-off.
  //
  static migrateGuestToUser(userId: string): void {
    // --- snapshot ---
    const guestProgress = this.getGuestProgress();
    const guestFiles    = this.listSandboxFiles(null);
    const fileContents: { filename: string; code: string }[] = guestFiles
      .map(filename => ({ filename, code: this.getSandboxCode(null, filename) ?? '' }))
      .filter(f => f.code !== '');

    // --- clear guest FIRST (prevents duplicate state on crash) ---
    this.clearGuestData();

    // --- write to user storage ---
    try {
      if (guestProgress) {
        this.saveUserProgress(userId, {
          sandboxProgress:      guestProgress.sandboxProgress      || {},
          exploredNodes:        guestProgress.exploredNodes        || [],
          completedChallenges:  guestProgress.completedChallenges  || [],
        });
      }
      for (const { filename, code } of fileContents) {
        this.saveSandboxCode(userId, code, filename);
      }
    } catch (err) {
      // Guest data is already cleared. Log and continue — the user's account is clean.
      console.error('migrateGuestToUser: failed to write user data, guest data was already cleared', err);
    }
  }

  // ── Storage stats ──────────────────────────────────────────────────────────

  static getStorageStats(userId: string | null): { totalKeys: number; totalSize: number; files: number } {
    const prefix  = userId ? this.getUserKey(userId, '') : this.getGuestKey('');
    const storage = userId ? localStorage : sessionStorage;
    let totalKeys = 0, totalSize = 0, files = 0;
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && key.startsWith(prefix)) {
        totalKeys++;
        const value = storage.getItem(key);
        if (value) { totalSize += value.length; if (key.includes('sandbox_')) files++; }
      }
    }
    return { totalKeys, totalSize, files };
  }

  // ── Guards ─────────────────────────────────────────────────────────────────
  //
  // NOTE (Bug 9): canAccessCampaign / canSavePermanently should be called with
  // the server-verified isGuest value from useAuth(), NOT from sessionStorage
  // directly. The sessionStorage `guestMode` flag is UX-only and forgeable.

  static canAccessCampaign(isGuest: boolean): boolean   { return !isGuest; }
  static canSavePermanently(isGuest: boolean): boolean  { return !isGuest; }

  static getGuestLimitations(): { maxSandboxFiles: number; maxCodeSize: number; sessionDuration: number } {
    return { maxSandboxFiles: 5, maxCodeSize: 10000, sessionDuration: 24 * 60 * 60 * 1000 };
  }
}
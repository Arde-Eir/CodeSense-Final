import { useEffect, useState, type ReactElement } from 'react';
import { assertAdminAuditReady } from '@/admin/adminAudit';
import { errorMessage } from '@/admin/adminPanelModel';
import { requireXpAmount } from '@/campaign/retakeXp';
import { readLevelXpCap, saveLevelXpCap } from '@/services/campaignXpSettings';
import { phaseForLevel } from '@/types/campaign';

export function LevelXpSettings({ level, userId }: { level: number; userId: string }): ReactElement {
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const cap = await readLevelXpCap(phaseForLevel(level));
        if (!cancelled) setDraft(String(cap));
      } catch (caught: unknown) {
        if (!cancelled) setError(errorMessage(caught));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [level]);

  async function save(): Promise<void> {
    setError(null);
    setMessage(null);
    setSaving(true);
    try {
      const cap = requireXpAmount(draft.trim() === '' ? NaN : Number(draft), `Level ${level} maximum XP`);
      await assertAdminAuditReady();
      const saved = await saveLevelXpCap(phaseForLevel(level), cap, userId);
      setDraft(String(saved));
      setMessage(`Level ${level} maximum XP saved: ${saved.toLocaleString()} XP.`);
    } catch (caught: unknown) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border-top pt-2 mt-3" data-testid="level-xp-settings">
      <label className="form-label" htmlFor="level-max-xp">Max XP for Level {level}</label>
      <div className="d-flex gap-2">
        <input id="level-max-xp" data-testid="level-max-xp" type="number" min={0} max={2_147_483_647} step={1}
          className="form-control form-control-sm" value={draft} disabled={loading || saving}
          onChange={event => { setDraft(event.target.value); setMessage(null); }} />
        <button type="button" data-testid="save-level-max-xp" className="btn btn-sm btn-primary"
          disabled={loading || saving || draft.trim() === ''} onClick={() => void save()}>
          {loading ? 'Loading…' : saving ? 'Saving…' : 'Save Level XP Limit'}
        </button>
      </div>
      <div className="text-muted mt-1" style={{ fontSize: '12px' }}>
        Total XP a learner can earn across all quests and retakes in this level. Saved separately from the quest reward. Already earned XP is preserved.
      </div>
      {error && <div role="alert" className="text-danger mt-1">{error}</div>}
      {message && <div role="status" className="text-success mt-1">{message}</div>}
    </div>
  );
}

// frontend/src/campaign/buildQuests.ts
// Pure gating logic for the per-phase dashboard. Extracted from
// CampaignInside.tsx so it can be unit-tested without mounting the page.
//
// Gating model (linear, exploit-proof):
//   • A quest is `completed` when mission_progress.status === 'completed'.
//   • A quest is `active` when the previous quest in sortorder has been
//     finished at least once (mission_progress.first_completed_at IS NOT NULL).
//   • Otherwise `locked`.
//
// `first_completed_at` survives retakes (RPC uses COALESCE + DB trigger), so
// retaking a quest never closes the gate on later quests. Replay XP cannot
// grind unlocks because gating is decoupled from XP — only real "first finish"
// timestamps move the gate.

import type {
  Quest, MissionProgress, QuestRow, QuestUIStatus, LevelStats,
} from '@/types/campaign';
import { levelXpCapForPhase } from './retakeXp';

export function buildQuests(quests: Quest[], progress: MissionProgress[]): {
  rows: QuestRow[];
  stats: LevelStats;
} {
  // Dedupe progress (UNIQUE constraint should make this a no-op, but keep
  // the safety net for older rows).
  const pMap: Record<string, MissionProgress> = {};
  for (const p of progress) {
    const existing = pMap[p.questid];
    if (!existing) { pMap[p.questid] = p; continue; }
    if (!existing.first_completed_at && p.first_completed_at) { pMap[p.questid] = p; continue; }
    if ((p.updatedat ?? '') > (existing.updatedat ?? '')) pMap[p.questid] = p;
  }

  const sorted = [...quests].sort((a, b) => (a.sortorder ?? 0) - (b.sortorder ?? 0));
  let prevEverCompleted = true;

  const rows: QuestRow[] = sorted.map(q => {
    const p = pMap[q.id];
    const currentlyCompleted = p?.status === 'completed';
    const everCompleted      = currentlyCompleted || p?.first_completed_at != null;

    let uiStatus: QuestUIStatus;
    if (currentlyCompleted)     uiStatus = 'completed';
    else if (prevEverCompleted) uiStatus = 'active';
    else                         uiStatus = 'locked';

    if (!everCompleted) prevEverCompleted = false;

    return {
      ...q,
      uiStatus,
      xpGained:           p?.xp_gained ?? 0,
      everCompleted,
      currentlyCompleted,
    };
  });

  const finished = rows.filter(r => r.everCompleted).length;
  const xpEarned = rows.reduce((s, r) => s + r.xpGained, 0);
  const xpTotal  = levelXpCapForPhase(rows[0]?.phase);

  let streak = 0;
  for (const r of rows) {
    if (r.everCompleted) streak++;
    else break;
  }

  return {
    rows,
    stats: { finished, total: rows.length, xpEarned, xpTotal, streak },
  };
}

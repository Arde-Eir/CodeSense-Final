import type {
  Quest, MissionProgress, QuestRow, QuestUIStatus, LevelStats,
} from '@/types/campaign';
import { requireXpAmount } from './retakeXp';

export function buildQuests(quests: Quest[], progress: MissionProgress[], levelXpCap: number): {
  rows: QuestRow[];
  stats: LevelStats;
} {
  // Prefer durable completion and recent progress when duplicate rows exist.
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
  const xpEarned = Object.values(pMap).reduce((sum, row) => sum + row.xp_gained, 0);
  const xpTotal = requireXpAmount(levelXpCap, 'Level XP limit');

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

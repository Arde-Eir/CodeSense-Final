export interface CompletedMissionRow {
  id?: string | null
  questid?: string | null
  status?: string | null
  completedat?: string | null
  first_completed_at?: string | null
}

export const isCompletedMissionRow = (row: CompletedMissionRow): boolean =>
  Boolean(row.first_completed_at || row.status === 'completed')

export const missionDoneAt = (row: CompletedMissionRow): string | null =>
  row.first_completed_at ?? row.completedat ?? null

export const countUniqueCompletedQuests = (rows: CompletedMissionRow[]): number =>
  new Set(rows.filter(isCompletedMissionRow).map(row => row.questid ?? row.id)).size

import type { Phase } from '@/types/campaign';
import { levelXpCapForPhase, requireXpAmount } from '@/campaign/retakeXp';
import { supabase } from './supabase';

/** An absent setting retains the original level limit until an admin configures it. */
export async function readLevelXpCap(phase: Phase): Promise<number> {
  const key = `campaign_level_xp_cap:${phase}`;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const result = await supabase.from('system_settings').select('value').eq('key', key).maybeSingle();
      if (result.error) {
        throw new Error(`Reading XP limit for ${phase} (key=${key}) failed (HTTP ${result.status}, ${result.error.code}): ${result.error.message}. ${result.error.details} ${result.error.hint}`.trim());
      }
      return result.data === null
        ? levelXpCapForPhase(phase)
        : requireXpAmount(result.data.value, `Saved XP limit for ${phase}`);
    } catch (error: unknown) {
      console.warn('Campaign XP limit read failed', { phase, key, attempt, error });
      if (attempt === 2) throw error;
    }
  }
  throw new Error(`Reading XP limit for ${phase} ended without a response.`);
}

export async function saveLevelXpCap(phase: Phase, cap: number, userId: string): Promise<number> {
  const value = requireXpAmount(cap, `XP limit for ${phase}`);
  const key = `campaign_level_xp_cap:${phase}`;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const result = await supabase.from('system_settings')
        .upsert({ key, value, updated_by: userId }, { onConflict: 'key' })
        .select('value').single();
      if (result.error) {
        throw new Error(`Saving XP limit for ${phase} (key=${key}, value=${value}) failed (HTTP ${result.status}, ${result.error.code}): ${result.error.message}. ${result.error.details} ${result.error.hint}`.trim());
      }
      const saved = requireXpAmount(result.data.value, `Saved XP limit for ${phase}`);
      if (saved !== value) throw new Error(`Saving XP limit for ${phase} returned ${saved}; expected ${value}. Reload the setting before retrying.`);
      return saved;
    } catch (error: unknown) {
      console.warn('Campaign XP limit save failed', { phase, key, value, attempt, error });
      if (attempt === 2) throw error;
    }
  }
  throw new Error(`Saving XP limit for ${phase} ended without a response.`);
}

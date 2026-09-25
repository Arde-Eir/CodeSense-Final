import { supabase } from '@/services/supabase';

export interface ProfileImageUrls {
  avatarUrl: string | null;
  bannerUrl: string | null;
}

async function getAvatarUrl(userId: string): Promise<string | null> {
  const { data: avatarFiles, error: avatarError } = await supabase.storage
    .from('Avatars')
    .list(userId, { limit: 10 });
  if (avatarError) throw new Error(`Avatar list failed for user ${userId}: ${avatarError.message}`);

  const avatarFile = avatarFiles?.find(file =>
    file.id && file.name && !file.name.includes('banner') && file.metadata?.mimetype?.startsWith('image/')
  ) ?? avatarFiles?.find(file => file.id && file.name && file.name !== 'banner');
  return avatarFile
    ? supabase.storage.from('Avatars').getPublicUrl(`${userId}/${avatarFile.name}`).data.publicUrl
    : null;
}

export async function getProfileImageUrls(userId: string): Promise<ProfileImageUrls> {
  const avatarUrl = await getAvatarUrl(userId);

  const { data: bannerFiles, error: bannerError } = await supabase.storage
    .from('Avatars')
    .list(`${userId}/banner`, { limit: 10 });
  if (bannerError) throw new Error(`Banner list failed for user ${userId}: ${bannerError.message}`);

  const bannerFile = bannerFiles?.find(file => file.id && file.name && file.metadata?.mimetype?.startsWith('image/'))
    ?? bannerFiles?.find(file => file.id && file.name);
  const bannerUrl = bannerFile
    ? supabase.storage.from('Avatars').getPublicUrl(`${userId}/banner/${bannerFile.name}`).data.publicUrl
    : null;

  return { avatarUrl, bannerUrl };
}

export async function getProfileImageUrlMap(userIds: string[]): Promise<Map<string, ProfileImageUrls>> {
  const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));
  const entries = await Promise.all(
    uniqueIds.map(async userId => [userId, await getProfileImageUrls(userId)] as const)
  );
  return new Map(entries);
}

export async function getAvatarUrlMap(userIds: string[]): Promise<Map<string, ProfileImageUrls>> {
  const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));
  const entries = await Promise.all(uniqueIds.map(async userId => {
    const avatarUrl = await getAvatarUrl(userId);
    return [userId, { avatarUrl, bannerUrl: null }] as const;
  }));
  return new Map(entries);
}

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const learnerId = '10000000-0000-0000-0000-000000000001';
const otherId = '10000000-0000-0000-0000-000000000002';
const adminId = '10000000-0000-0000-0000-000000000003';
const bannedAdminId = '10000000-0000-0000-0000-000000000004';
const newId = '10000000-0000-0000-0000-000000000005';
const prepareSql = await readFile(new URL('../supabase/migrations/202610220001_prepare_private_profiles.sql', import.meta.url), 'utf8');
const restrictSql = await readFile(new URL('../supabase/migrations/202610220002_restrict_private_profiles.sql', import.meta.url), 'utf8');

/** Execute the migrations against PostgreSQL with Supabase's JWT role model. */
async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create schema codesense_private;
    create publication supabase_realtime;
    grant usage on schema auth, codesense_private to anon, authenticated, service_role;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    create table public.users (
      id uuid primary key, email text unique not null, playername text unique not null,
      is_admin boolean default false, is_banned boolean default false,
      ban_reason text, banned_at timestamptz, isactive boolean default true,
      totalxp integer default 0, currentlevel integer default 1,
      sandbox_runs integer default 0, quests_completed integer default 0,
      createdat timestamptz default now(), lastactive timestamptz default now(),
      charactertype text default 'squire', user_type text default 'student',
      displayed_title text, badges jsonb default '[]', unlocked_titles jsonb default '[]',
      updatedat timestamptz default now()
    );
    create function codesense_private.is_current_user_admin() returns boolean
      language sql stable security definer set search_path = '' as $$
      select exists (select 1 from public.users where id = auth.uid()
        and is_admin and not coalesce(is_banned, false));
    $$;
    create function codesense_private.is_admin() returns boolean
      language sql stable security definer set search_path = '' as $$
      select coalesce((select is_admin from public.users where id = auth.uid()), false);
    $$;
    alter table public.users enable row level security;
    grant all on public.users to anon, authenticated, service_role;
    create policy anon_can_read_login_profiles on public.users for select to anon using (true);
    create policy authenticated_can_read_all on public.users for select to authenticated using (true);
    create policy users_select_by_playername on public.users for select to public using (true);
    create policy users_select_leaderboard on public.users for select to public using (true);
    create policy users_select_own on public.users for select to public using (id = auth.uid() or auth.uid() is null);
    create policy users_insert_own on public.users for insert to authenticated with check (id = auth.uid());
    create policy users_update_own on public.users for update to authenticated
      using (id = auth.uid()) with check (id = auth.uid());
    create policy admins_update_any on public.users for update to authenticated
      using (codesense_private.is_current_user_admin()) with check (codesense_private.is_current_user_admin());
    create policy "block self-admin grant" on public.users as restrictive for update to public using (
      is_admin = (select is_admin from public.users where id = auth.uid())
      or exists (select 1 from public.users where id = auth.uid() and is_admin)
    );
    insert into public.users (id, email, playername, is_admin, is_banned) values
      ('${learnerId}', 'learner@example.invalid', 'Learner', false, false),
      ('${otherId}', 'other@example.invalid', 'Other', false, false),
      ('${adminId}', 'admin@example.invalid', 'Admin', true, false),
      ('${bannedAdminId}', 'banned@example.invalid', 'Banned', true, true);
  `);
  await database.exec(prepareSql);
  await database.exec(restrictSql);
  return database;
}

async function queryAs(database, role, userId, sql, params) {
  await database.exec('begin');
  try {
    await database.query("select set_config('role', $1, true), set_config('request.jwt.claim.sub', $2, true)", [role, userId]);
    const result = await database.query(sql, params);
    await database.exec('commit');
    return result;
  } catch (error) {
    await database.exec('rollback');
    throw error;
  }
}

test('anonymous and learner queries cannot read other private profiles; public cards remain readable', async () => {
  const database = await createDatabase();
  try {
    await assert.rejects(queryAs(database, 'anon', '', 'select email from public.users', []), { code: '42501' });
    const publicRows = await queryAs(database, 'anon', '', 'select id, playername from public.player_profiles order by id', []);
    assert.deepEqual(publicRows.rows.map(row => row.id), [learnerId, otherId, adminId]);
    await assert.rejects(queryAs(database, 'anon', '', 'select email from public.player_profiles', []), { code: '42703' });
    await assert.rejects(queryAs(database, 'authenticated', learnerId, 'update public.player_profiles set totalxp = 9000', []), { code: '42501' });
    const own = await queryAs(database, 'authenticated', learnerId, 'select id, email from public.users', []);
    assert.deepEqual(own.rows, [{ id: learnerId, email: 'learner@example.invalid' }]);
    const admin = await queryAs(database, 'authenticated', adminId, 'select id from public.users', []);
    assert.equal(admin.rows.length, 4);
    const banned = await queryAs(database, 'authenticated', bannedAdminId, 'select id from public.users', []);
    assert.deepEqual(banned.rows, [{ id: bannedAdminId }]);
    await queryAs(database, 'authenticated', learnerId, 'update public.users set playername = $1 where id = $2', ['Renamed', learnerId]);
    const renamed = await queryAs(database, 'anon', '', 'select playername from public.player_profiles where id = $1', [learnerId]);
    assert.equal(renamed.rows[0].playername, 'Renamed');
    await queryAs(database, 'authenticated', adminId, 'update public.users set is_banned = true where id = $1', [otherId]);
    const hidden = await queryAs(database, 'anon', '', 'select id from public.player_profiles where id = $1', [otherId]);
    assert.equal(hidden.rows.length, 0);
    const published = await database.query("select tablename from pg_publication_tables where pubname = 'supabase_realtime'");
    assert.deepEqual(published.rows, [{ tablename: 'player_profiles' }]);
  } finally {
    await database.close();
  }
});

test('profile creation cannot assign administrator or ban fields, while ordinary creation and existing updates work', async () => {
  const database = await createDatabase();
  try {
    for (const fields of [{ is_admin: true }, { is_banned: true }, { ban_reason: 'forged' }, { banned_at: '2026-01-01T00:00:00Z' }]) {
      const [column, value] = Object.entries(fields)[0];
      await assert.rejects(queryAs(database, 'authenticated', newId,
        `insert into public.users (id, email, playername, ${column}) values ($1, $2, $3, $4)`,
        [newId, 'new@example.invalid', 'New', value]), { code: '42501' });
    }
    await queryAs(database, 'authenticated', newId,
      'insert into public.users (id, email, playername) values ($1, $2, $3)', [newId, 'new@example.invalid', 'New']);
    await assert.rejects(queryAs(database, 'authenticated', learnerId,
      'update public.users set playername = $1 where id = $2', ['nEw', learnerId]), { code: '23505' });
    await assert.rejects(queryAs(database, 'authenticated', newId,
      'update public.users set is_admin = true where id = $1', [newId]), { code: '42501' });
    await queryAs(database, 'authenticated', adminId,
      'update public.users set is_admin = true where id = $1', [newId]);
    const result = await queryAs(database, 'authenticated', newId, 'select is_admin from public.users where id = $1', [newId]);
    assert.equal(result.rows[0].is_admin, true);
  } finally {
    await database.close();
  }
});

test('shared login limits protect both player names and IP addresses and cannot be called by clients', async () => {
  const database = await createDatabase();
  const bucket = index => index.toString(16).padStart(64, '0');
  const consume = (ip, player) => queryAs(database, 'service_role', '',
    'select public.consume_player_login_attempt($1, $2) as retry_after', [`ip:${bucket(ip)}`, `player:${bucket(player)}`]);
  try {
    await assert.rejects(queryAs(database, 'anon', '', 'select public.consume_player_login_attempt($1, $2)',
      [`ip:${bucket(1)}`, `player:${bucket(1)}`]), { code: '42501' });
    await assert.rejects(queryAs(database, 'authenticated', learnerId, 'select public.consume_player_login_attempt($1, $2)',
      [`ip:${bucket(1)}`, `player:${bucket(1)}`]), { code: '42501' });
    for (let attempt = 1; attempt <= 10; attempt++) assert.equal((await consume(attempt, 100)).rows[0].retry_after, 0);
    assert.ok((await consume(11, 100)).rows[0].retry_after > 0);
    for (let attempt = 1; attempt <= 60; attempt++) assert.equal((await consume(200, attempt + 200)).rows[0].retry_after, 0);
    assert.ok((await consume(200, 999)).rows[0].retry_after > 0);
    await database.exec("update codesense_private.player_login_attempts set expires_at = now() - interval '1 second'");
    assert.equal((await consume(200, 999)).rows[0].retry_after, 0);
  } finally {
    await database.close();
  }
});

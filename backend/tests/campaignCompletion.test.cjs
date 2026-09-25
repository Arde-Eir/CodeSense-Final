const { after, before, beforeEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const { join } = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const QUEST_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_USER_ID = '33333333-3333-4333-8333-333333333333';

describe('Campaign completion SQL transaction', () => {
    let db;

    before(async () => {
        db = new PGlite();
        // Only the columns used by the deployed completion contract are needed.
        // PostgreSQL executes the real migration, grants, RLS and transaction.
        await db.exec(`
            create role authenticated;
            create role anon;
            create schema auth;
            create function auth.uid() returns uuid language sql stable as $$
                select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
            $$;
            grant usage on schema auth to authenticated;
            create type public.mission_status as enum ('active', 'completed');
            create table public.users (
                id uuid primary key, totalxp integer, currentlevel integer, lastactive timestamptz
            );
            create table public.mission_progress (
                userid uuid references public.users, questid uuid,
                status public.mission_status, xp_gained integer,
                completed_activities jsonb, hintsused integer, completedat timestamptz,
                first_completed_at timestamptz, updatedat timestamptz, startedat timestamptz,
                attempts integer, completion_time_seconds integer,
                primary key (userid, questid)
            );
            create table public.activity_log (
                userid uuid, type text, title text, description text, xp_gained integer
            );
            grant select, insert, update on public.users, public.mission_progress, public.activity_log to authenticated;
            alter table public.users enable row level security;
            alter table public.mission_progress enable row level security;
            alter table public.activity_log enable row level security;
            create policy own_user on public.users to authenticated using (id = auth.uid()) with check (id = auth.uid());
            create policy own_progress on public.mission_progress to authenticated using (userid = auth.uid()) with check (userid = auth.uid());
            create policy own_activity on public.activity_log to authenticated using (userid = auth.uid()) with check (userid = auth.uid());
        `);
        const migration = await readFile(join(__dirname, '../../supabase/migrations/202609240001_campaign_completion_time.sql'), 'utf8');
        await db.exec(migration);
    });

    beforeEach(async () => {
        await db.exec('reset role; truncate public.mission_progress, public.users, public.activity_log;');
        await db.query('insert into public.users (id, totalxp, currentlevel) values ($1, 4990, 1)', [USER_ID]);
        await db.query("select set_config('request.jwt.claim.sub', $1, false)", [USER_ID]);
        await db.exec('set role authenticated');
    });

    after(async () => { await db.close(); });

    async function complete(userId, xp, delta, activities, fullCompletion, seconds) {
        return db.query(`select public.complete_campaign_quest(
            p_userid => $1::uuid, p_questid => $2::uuid,
            p_xp_gained => $3::integer, p_xp_delta => $4::integer,
            p_completed_activities => $5::jsonb, p_hintsused => 0,
            p_is_full_completion => $6::boolean, p_completion_time_seconds => $7::integer
        ) as result`, [userId, QUEST_ID, xp, delta, JSON.stringify(activities), fullCompletion, seconds]);
    }

    async function progress() {
        return (await db.query('select status, xp_gained, completion_time_seconds, first_completed_at::text from public.mission_progress')).rows;
    }

    it('saves elapsed time, progress, level and one activity event together', async () => {
        await complete(USER_ID, 0, 0, ['mc'], false, null);
        assert.equal((await progress())[0].completion_time_seconds, null);
        const { rows } = await complete(USER_ID, 200, 200, ['mc', 'ordering'], true, 137);
        assert.deepEqual(rows[0].result, { levelled_up: true, new_level: 2, total_xp: 5190 });
        const [saved] = await progress();
        assert.equal(saved.status, 'completed');
        assert.equal(saved.completion_time_seconds, 137);
        assert.ok(saved.first_completed_at);
        assert.equal((await db.query('select * from public.activity_log')).rows.length, 1);
    });

    it('updates the retake time while retaining the first completion and activity', async () => {
        await complete(USER_ID, 200, 200, ['mc'], true, 137);
        const [first] = await progress();
        await db.query("update public.mission_progress set status = 'active', completedat = null, completed_activities = '[]'");
        await complete(USER_ID, 200, 0, ['ordering'], false, null);
        assert.equal((await progress())[0].completion_time_seconds, 137);
        await complete(USER_ID, 220, 20, ['ordering', 'mc'], true, 92);
        const [retake] = await progress();
        assert.equal(retake.completion_time_seconds, 92);
        assert.equal(retake.first_completed_at, first.first_completed_at);
        assert.equal((await db.query('select * from public.activity_log')).rows.length, 1);
        assert.equal((await db.query('select totalxp from public.users')).rows[0].totalxp, 5210);
    });

    it('rejects invalid timing before writing progress or XP', async () => {
        await assert.rejects(complete(USER_ID, 200, 200, ['mc'], true, null), { code: '22023' });
        await assert.rejects(complete(USER_ID, 200, 200, ['mc'], true, -1), { code: '22023' });
        await assert.rejects(complete(USER_ID, 0, 0, ['mc'], false, 12), { code: '22023' });
        assert.deepEqual(await progress(), []);
        assert.equal((await db.query('select totalxp from public.users')).rows[0].totalxp, 4990);
    });

    it('denies another user and anonymous calls', async () => {
        await assert.rejects(complete(OTHER_USER_ID, 200, 200, ['mc'], true, 10), { code: '42501' });
        await db.exec('reset role; set role anon;');
        await assert.rejects(complete(USER_ID, 200, 200, ['mc'], true, 10), { code: '42501' });
    });

    it('rolls back completion time and XP if the activity write fails', async () => {
        await db.exec('reset role; revoke insert on public.activity_log from authenticated; set role authenticated;');
        try {
            await assert.rejects(complete(USER_ID, 200, 200, ['mc'], true, 137), { code: '42501' });
            assert.deepEqual(await progress(), []);
            assert.equal((await db.query('select totalxp from public.users')).rows[0].totalxp, 4990);
        } finally {
            await db.exec('reset role; grant insert on public.activity_log to authenticated;');
        }
    });
});

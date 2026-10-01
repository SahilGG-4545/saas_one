import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';

const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;

async function database() {
    const db = new PGlite({ extensions: { btree_gist } });
    await db.exec(`
        CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
        CREATE TABLE users(id uuid primary key, is_master_admin boolean default false, is_approved boolean default true, approval_status text default 'approved');
        CREATE TABLE properties(id uuid primary key, name text, organization_id uuid, is_active boolean default true, deleted_at timestamptz);
        CREATE TABLE organization_memberships(user_id uuid, organization_id uuid, role text, is_active boolean default true);
        CREATE TABLE property_memberships(user_id uuid, property_id uuid, role text, is_active boolean default true);
        CREATE TABLE tickets(id uuid primary key default gen_random_uuid());
        CREATE TABLE meeting_rooms(id uuid primary key, property_id uuid, name text, status text default 'active');
        CREATE TABLE meeting_room_slots(id uuid primary key, start_time time, end_time time);
        CREATE TABLE companies(id uuid primary key, property_id uuid);
        CREATE TABLE company_members(user_id uuid, company_id uuid);
        CREATE TABLE meeting_room_credits(id uuid primary key, property_id uuid, user_id uuid, company_id uuid, remaining_hours numeric, updated_at timestamptz);
        CREATE TABLE meeting_room_bookings(id uuid primary key default gen_random_uuid(), meeting_room_id uuid, property_id uuid, organization_id uuid, user_id uuid, company_id uuid, booking_date date, start_time time, end_time time, status text, comment text);
        CREATE TABLE meeting_room_credit_log(id uuid primary key default gen_random_uuid(), credit_id uuid, user_id uuid, company_id uuid, action text, hours_changed numeric, hours_after numeric, booking_id uuid, performed_by uuid, notes text, created_at timestamptz);
    `);
    // Use the real existing credit-deduction implementation, not a stub.
    const creditSql = await readFile(new URL('../backend/db/migrations/20260521_fix_meeting_room_bugs.sql', import.meta.url), 'utf8');
    const deduct = creditSql.slice(creditSql.indexOf('CREATE OR REPLACE FUNCTION deduct_meeting_room_credit('), creditSql.indexOf('-- Function: Atomically refund'));
    await db.exec(deduct);
    await db.exec(await readFile(new URL('../supabase/migrations/20261001000001_whatsapp_assistant.sql', import.meta.url), 'utf8'));
    await db.exec(`
        INSERT INTO users(id) VALUES ('${uuid(1)}'),('${uuid(2)}'),('${uuid(3)}');
        INSERT INTO properties(id,name,organization_id) VALUES ('${uuid(10)}','Hub One','${uuid(20)}'),('${uuid(11)}','Hub Two','${uuid(20)}'),('${uuid(12)}','Other Org','${uuid(21)}');
        INSERT INTO organization_memberships(user_id,organization_id,role) VALUES ('${uuid(1)}','${uuid(20)}','ops_super_admin');
        INSERT INTO property_memberships(user_id,property_id,role) VALUES ('${uuid(2)}','${uuid(10)}','tenant'),('${uuid(3)}','${uuid(11)}','property_admin');
        INSERT INTO meeting_rooms(id,property_id,name) VALUES ('${uuid(30)}','${uuid(10)}','Boardroom'),('${uuid(31)}','${uuid(11)}','Meeting Room');
        INSERT INTO meeting_room_slots(id,start_time,end_time) VALUES ('${uuid(40)}','10:00','11:00'),('${uuid(41)}','11:00','12:00'),('${uuid(42)}','10:30','11:30');
        INSERT INTO companies(id,property_id) VALUES ('${uuid(50)}','${uuid(10)}'),('${uuid(51)}','${uuid(11)}');
        INSERT INTO company_members VALUES ('${uuid(2)}','${uuid(50)}'),('${uuid(2)}','${uuid(51)}');
        INSERT INTO meeting_room_credits(id,property_id,company_id,remaining_hours) VALUES ('${uuid(60)}','${uuid(10)}','${uuid(50)}',2),('${uuid(61)}','${uuid(11)}','${uuid(51)}',9);
    `);
    return db;
}

test('migration and booking RPC enforce property scope, credits, idempotency, and overlap', async () => {
    const db = await database();
    try {
        const adminProps = await db.query('select id from whatsapp_assistant_properties($1)', [uuid(1)]);
        assert.equal(adminProps.rows.length, 2);
        const siteProps = await db.query('select id from whatsapp_assistant_properties($1)', [uuid(3)]);
        assert.deepEqual(siteProps.rows.map(row => row.id), [uuid(11)]);
        const book = (user, room, slot, request) => db.query('select whatsapp_assistant_book($1,$2,$3,$4,$5,$6) as booking', [uuid(user), uuid(10), uuid(room), uuid(slot), '2099-10-01', uuid(request)]);
        const first = await book(2, 30, 40, 100);
        const replay = await book(2, 30, 40, 100);
        assert.equal(first.rows[0].booking.id, replay.rows[0].booking.id);
        assert.equal(Number((await db.query('select remaining_hours from meeting_room_credits where id=$1', [uuid(60)])).rows[0].remaining_hours), 1);
        assert.equal(Number((await db.query('select remaining_hours from meeting_room_credits where id=$1', [uuid(61)])).rows[0].remaining_hours), 9);
        assert.equal((await db.query('select count(*)::int as n from meeting_room_credit_log')).rows[0].n, 1);
        await assert.rejects(book(1, 30, 42, 101), /SLOT_UNAVAILABLE/);
        await assert.rejects(db.query(`insert into meeting_room_bookings(meeting_room_id,property_id,user_id,booking_date,start_time,end_time,status) values ($1,$2,$3,'2099-10-01','10:15','10:45','confirmed')`, [uuid(30), uuid(10), uuid(1)]), /exclusion constraint/);
        await assert.rejects(book(3, 30, 41, 102), /No active access/);
        await assert.rejects(book(1, 31, 41, 103), /Room is not active/);
        await db.exec(`UPDATE meeting_room_credits SET remaining_hours = 0 WHERE id = '${uuid(60)}'`);
        await assert.rejects(book(2, 30, 41, 104), /INSUFFICIENT_CREDITS/);
        assert.equal((await db.query('select count(*)::int as n from meeting_room_bookings')).rows[0].n, 1);
        await db.exec(`UPDATE property_memberships SET is_active = false WHERE user_id = '${uuid(2)}'`);
        await assert.rejects(book(2, 30, 40, 100), /No active access/);
    } finally { await db.close(); }
});

test('event RPCs deduplicate, serialize a sender, persist prompts, and expire sessions', async () => {
    const db = await database();
    try {
        const payload = { phone: '919876543210', messageId: 'w1', text: 'hi', mediaType: 'text' };
        const enqueue = () => db.query('select whatsapp_assistant_enqueue($1) as id', [payload]);
        const id = (await enqueue()).rows[0].id;
        assert.equal((await enqueue()).rows[0].id, null);
        const claim = async token => (await db.query('select whatsapp_assistant_claim($1,$2) as event', [payload.phone, token])).rows[0].event;
        const event = await claim(uuid(200));
        assert.equal(event.id, id);
        assert.equal(await claim(uuid(201)), null);
        await db.query('select whatsapp_assistant_save($1,$2,$3,$4)', [id, uuid(200), { id, step: 'menu' }, { key: 'menu', params: [] }]);
        await assert.rejects(db.query('select whatsapp_assistant_finish($1,$2,null)', [id, uuid(201)]), /lease lost/);
        await db.query('select whatsapp_assistant_finish($1,$2,$3)', [id, uuid(200), 'provider temporarily unavailable']);
        const retry = await claim(uuid(202));
        assert.deepEqual(retry.reply, { key: 'menu', params: [] });
        assert.equal(retry.snapshot, null);
        await db.exec(`UPDATE whatsapp_assistant_sessions SET expires_at = now() - interval '21 minutes'`);
        await db.query('select whatsapp_assistant_finish($1,$2,null)', [id, uuid(202)]);
        assert.equal((await db.query('select expires_at > now() as active from whatsapp_assistant_sessions')).rows[0].active, true);
        assert.equal(await claim(uuid(203)), null);
        await db.exec(`UPDATE whatsapp_assistant_sessions SET expires_at = now() - interval '1 minute'`);
        await db.query('select whatsapp_assistant_enqueue($1)', [{ ...payload, messageId: 'w2' }]);
        assert.equal((await claim(uuid(204))).snapshot, null);
        const grants = await db.query("select has_function_privilege('authenticated','whatsapp_assistant_book(uuid,uuid,uuid,uuid,date,uuid)','EXECUTE') as allowed");
        assert.equal(grants.rows[0].allowed, false);
    } finally { await db.close(); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as protocol from '../backend/lib/whatsapp/assistant/protocol.mjs';

const require = createRequire(import.meta.url);
const next = require('next/server');
const source = await readFile(new URL('../app/api/webhooks/aisensy/route.ts', import.meta.url), 'utf8');

function handler(env, enqueue = async () => 'event-1') {
    const callbacks = [];
    const logs = [];
    const exports = {};
    const imports = {
        'node:crypto': require('node:crypto'),
        'next/server': { ...next, after: callback => callbacks.push(callback) },
        '@/backend/lib/whatsapp/assistant/protocol.mjs': protocol,
        '@/backend/lib/whatsapp/assistant/runtime': { enqueueAssistantMessage: enqueue, drainWhatsAppPhone: async () => {} },
        '@/backend/lib/whatsapp/processMessage': { processIncomingMessage: async () => {} },
        '@/backend/lib/whatsapp/greeting': { isGreetingMessage: () => false },
        '@/backend/services/AiSensyService': { AiSensyService: { sendGreeting: async () => {} } },
    };
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(compiled, { exports, require: name => { if (!(name in imports)) throw new Error('Unexpected import ' + name); return imports[name]; },
        Buffer, URL, process: { env }, console: { info: (...args) => logs.push(args), error() {} } });
    return { ...exports, callbacks, logs };
}

const payload = { topic: 'message.sender.user', data: { phone: '919876543210', messageId: 'wamid-1', message: 'Hi' } };
const request = (body = payload, token = 'secret') => new next.NextRequest('https://example.com/api/webhooks/aisensy', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-aisensy-secret': token }, body: typeof body === 'string' ? body : JSON.stringify(body),
});

test('enabled webhook accepts the plain URL without a secret', async () => {
    const route = handler({ AISENSY_ASSISTANT_ENABLED: 'true' });
    const plainRequest = new next.NextRequest('https://example.com/api/webhooks/aisensy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const response = await route.POST(plainRequest);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, queued: true, duplicate: false });
    assert.equal(route.callbacks.length, 1);
});

test('a leftover webhook secret environment variable does not reject inbound messages', async () => {
    const route = handler({ AISENSY_ASSISTANT_ENABLED: 'true', AISENSY_WEBHOOK_SECRET: 'old-secret' });
    assert.equal((await route.POST(request(payload, 'wrong'))).status, 200);
});

test('webhook validates JSON and requires stable message ID', async () => {
    const route = handler({ AISENSY_ASSISTANT_ENABLED: 'true', AISENSY_WEBHOOK_SECRET: 'secret' });
    assert.equal((await route.POST(request('{bad'))).status, 400);
    assert.equal((await route.POST(request({ ...payload, data: { ...payload.data, messageId: '' } }))).status, 400);
    assert.equal(route.callbacks.length, 0);
});

test('webhook persists before acknowledging and defers work without waiting for cron', async () => {
    let stored;
    const route = handler({ AISENSY_ASSISTANT_ENABLED: 'true', AISENSY_WEBHOOK_SECRET: 'secret' }, async input => { stored = input; return 'event-1'; });
    const response = await route.POST(request());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, queued: true, duplicate: false });
    assert.equal(stored.messageId, 'wamid-1');
    assert.equal(route.callbacks.length, 1);
});

test('outbound events are ignored and persistence failure requests delivery retry', async () => {
    let called = false;
    const route = handler({ AISENSY_ASSISTANT_ENABLED: 'true', AISENSY_WEBHOOK_SECRET: 'secret' }, async () => { called = true; throw new Error('DB unavailable'); });
    const ignored = await route.POST(request({ ...payload, topic: 'message.sent.business' }));
    assert.equal((await ignored.json()).ignored, true);
    assert.equal(called, false);
    assert.equal((await route.POST(request())).status, 503);
    assert.equal(route.callbacks.length, 0);
});


test('ignored payloads report their nested structure without exposing message or phone values', async () => {
    const route = handler({ AISENSY_ASSISTANT_ENABLED: 'true' });
    const unknown = { topic: 'message.sender.user', data: { unusualContact: { number: '919876543210' }, unusualMessage: { body: 'private greeting text', id: 'private-id' } } };
    const response = await route.POST(request(unknown));
    assert.deepEqual(await response.json(), { ok: true, ignored: true });
    const diagnostic = route.logs.find(entry => entry[0] === '[AiSensyWebhook] Payload inspected');
    assert.ok(diagnostic, 'every parsed request should emit a diagnostic');
    assert.equal(typeof diagnostic[1], 'string');
    const details = JSON.parse(diagnostic[1]);
    assert.equal(details.assistantEnabled, true);
    assert.equal(details.normalized, false);
    assert.equal(details.shape.data.unusualContact.number, 'string');
    assert.equal(details.shape.data.unusualMessage.body, 'string');
    const output = JSON.stringify(route.logs);
    for (const sensitive of ['919876543210', 'private greeting text', 'private-id']) assert.equal(output.includes(sensitive), false);
    assert.equal(route.callbacks.length, 0);
});


test('AiSensy nested project message is persisted and schedules the reply worker', async () => {
    let stored;
    const route = handler({ AISENSY_ASSISTANT_ENABLED: 'true' }, async input => { stored = input; return 'event-aisensy'; });
    const response = await route.POST(request({ topic: 'message.sender.user', data: { message: {
        phone_number: '919876543210', message_content: { text: 'Hi' }, message_type: 'TEXT',
        type: 'message', id: 'provider-record', messageId: 'wamid-project-1',
    } } }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, queued: true, duplicate: false });
    assert.equal(stored.text, 'Hi');
    assert.equal(stored.messageId, 'wamid-project-1');
    assert.equal(route.callbacks.length, 1);
});

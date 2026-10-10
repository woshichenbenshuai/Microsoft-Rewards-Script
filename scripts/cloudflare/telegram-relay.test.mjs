import assert from 'node:assert/strict'
import test from 'node:test'
import worker from './telegram-relay.mjs'
const env = {
    RELAY_TOKEN: 'relay-test-secret',
    TELEGRAM_BOT_TOKEN: '123:test-bot-secret',
    TELEGRAM_CHAT_ID: 'fixed-chat'
}
const request = (data, auth = true) =>
    new Request('https://relay.example/notify', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(auth ? { Authorization: `Bearer ${env.RELAY_TOKEN}` } : {})
        },
        body: JSON.stringify(data)
    })

test('rejects anonymous requests and caller-supplied destinations before contacting Telegram', async () => {
    const original = globalThis.fetch
    let calls = 0
    globalThis.fetch = async () => {
        calls++
        throw new Error('Must not contact Telegram')
    }
    try {
        assert.equal((await worker.fetch(request({ text: 'hello' }, false), env)).status, 401)
        assert.equal((await worker.fetch(request({ text: 'hello', chat_id: 'another-chat' }), env)).status, 400)
        assert.equal(calls, 0)
    } finally {
        globalThis.fetch = original
    }
})

test('sends only to the secret-bound chat and returns no Telegram response or credentials', async () => {
    const original = globalThis.fetch
    globalThis.fetch = async (url, init) => {
        assert.equal(url, `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`)
        assert.deepEqual(JSON.parse(init.body), {
            chat_id: 'fixed-chat',
            text: '北京华为云\ncloud summary',
            disable_notification: false
        })
        return Response.json({ ok: true, result: { chat: { id: 'fixed-chat' }, message_id: 42 } })
    }
    try {
        const response = await worker.fetch(request({ text: 'cloud summary' }), env)
        assert.equal(response.status, 200)
        assert.deepEqual(await response.json(), { ok: true })
    } finally {
        globalThis.fetch = original
    }
})

test('redacts upstream failures and handles upstream ok=false as failure', async () => {
    const original = globalThis.fetch
    try {
        for (const mode of ['throws', 'ok-false']) {
            globalThis.fetch = async () => {
                if (mode === 'throws') throw new Error(env.TELEGRAM_BOT_TOKEN)
                return Response.json({ ok: false, description: env.TELEGRAM_BOT_TOKEN })
            }
            const response = await worker.fetch(request({ text: 'summary' }), env)
            assert.equal(response.status, 502)
            assert.deepEqual(await response.json(), { ok: false })
        }
    } finally {
        globalThis.fetch = original
    }
})

test('limits oversized bodies, text, and parse modes', async () => {
    assert.equal((await worker.fetch(request({ text: 'x'.repeat(10000) }), env)).status, 413)
    assert.equal((await worker.fetch(request({ text: 'x'.repeat(4097) }), env)).status, 400)
    assert.equal((await worker.fetch(request({ text: 'hello', parse_mode: 'HTML' }), env)).status, 400)
})

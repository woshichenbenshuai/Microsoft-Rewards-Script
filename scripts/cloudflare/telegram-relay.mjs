const sourceLabel = '北京华为云\n'
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

async function authorized(header, token) {
    if (!token || !header || header.length > 200) return false
    const encoder = new TextEncoder()
    const [a, b] = await Promise.all([
        crypto.subtle.digest('SHA-256', encoder.encode(header)),
        crypto.subtle.digest('SHA-256', encoder.encode(`Bearer ${token}`))
    ])
    const left = new Uint8Array(a),
        right = new Uint8Array(b)
    let mismatch = 0
    for (let i = 0; i < left.length; i++) mismatch |= left[i] ^ right[i]
    return mismatch === 0
}

export default {
    async fetch(request, env) {
        const path = new URL(request.url).pathname
        if (request.method === 'GET' && path === '/health') return json({ ok: true, service: 'rewards-telegram-relay' })
        if (path !== '/notify') return json({ ok: false }, 404)
        if (request.method !== 'POST') return json({ ok: false }, 405)
        if (!(await authorized(request.headers.get('Authorization'), env.RELAY_TOKEN))) return json({ ok: false }, 401)
        if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return json({ ok: false }, 503)
        if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))
            return json({ ok: false }, 415)
        if (Number(request.headers.get('Content-Length')) > 8192) return json({ ok: false }, 413)
        let payload
        try {
            const reader = request.body?.getReader()
            if (!reader) return json({ ok: false }, 400)
            const chunks = []
            let size = 0
            while (true) {
                const { value, done } = await reader.read()
                if (done) break
                size += value.byteLength
                if (size > 8192) {
                    await reader.cancel()
                    return json({ ok: false }, 413)
                }
                chunks.push(value)
            }
            const body = new Uint8Array(size)
            let offset = 0
            for (const chunk of chunks) {
                body.set(chunk, offset)
                offset += chunk.byteLength
            }
            payload = JSON.parse(new TextDecoder().decode(body))
        } catch {
            return json({ ok: false }, 400)
        }
        if (
            !payload ||
            typeof payload !== 'object' ||
            typeof payload.text !== 'string' ||
            !payload.text.trim() ||
            payload.text.length > 4096 - sourceLabel.length
        )
            return json({ ok: false }, 400)
        if (Object.keys(payload).some(key => !['text', 'parse_mode', 'disable_notification'].includes(key)))
            return json({ ok: false }, 400)
        if (payload.parse_mode !== undefined && payload.parse_mode !== 'MarkdownV2') return json({ ok: false }, 400)
        if (payload.disable_notification !== undefined && typeof payload.disable_notification !== 'boolean')
            return json({ ok: false }, 400)
        const data = {
            chat_id: env.TELEGRAM_CHAT_ID,
            text: sourceLabel + payload.text,
            disable_notification: payload.disable_notification === true
        }
        if (payload.parse_mode) data.parse_mode = payload.parse_mode
        try {
            const result = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
                signal: AbortSignal.timeout(10000)
            })
            const response = await result.json()
            if (!result.ok || response.ok !== true) return json({ ok: false }, 502)
            return json({ ok: true })
        } catch {
            return json({ ok: false }, 502)
        }
    }
}

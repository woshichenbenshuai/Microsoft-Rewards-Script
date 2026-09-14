import net from 'node:net'

export const MIN_API_TOKEN_LENGTH = 32

export function isLoopbackHost(host) {
    const normalized = String(host).trim().toLowerCase()
    if (normalized === 'localhost' || normalized === '::1') return true

    if (net.isIP(normalized) !== 4) return false
    return Number(normalized.split('.')[0]) === 127
}

export function validateApiExposure(host, token) {
    if (token && token.length < MIN_API_TOKEN_LENGTH) {
        return {
            ok: false,
            error: `API_TOKEN must contain at least ${MIN_API_TOKEN_LENGTH} characters.`
        }
    }

    if (!token && !isLoopbackHost(host)) {
        return {
            ok: false,
            error: 'API_TOKEN is required when API_HOST is not a loopback address.'
        }
    }

    return { ok: true }
}

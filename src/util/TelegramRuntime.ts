import type { Config, WebhookTelegramConfig } from '../interface/Config'

const TELEGRAM_PROXY_PROTOCOLS = new Set(['http:', 'https:', 'socks4:', 'socks5:'])

function envValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
    const value = env[key]?.trim()
    return value ? value : undefined
}

function envBoolean(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
    const value = envValue(env, key)
    if (value === undefined) return fallback
    if (['1', 'true', 'yes', 'on'].includes(value.toLowerCase())) return true
    if (['0', 'false', 'no', 'off'].includes(value.toLowerCase())) return false
    throw new Error(`${key} must be true or false.`)
}

export function normalizeTelegramProxyUrl(value: string | undefined): string | undefined {
    const input = value?.trim()
    if (!input) return undefined

    let parsed: URL
    try {
        parsed = new URL(input)
    } catch {
        throw new Error('CONFIG_TELEGRAM_PROXY_URL must be a valid absolute proxy URL.')
    }

    if (!TELEGRAM_PROXY_PROTOCOLS.has(parsed.protocol.toLowerCase()) || !parsed.hostname) {
        throw new Error('CONFIG_TELEGRAM_PROXY_URL must use http, https, socks4, or socks5.')
    }

    return parsed.toString()
}

export function resolveTelegramRuntimeConfig(
    base: WebhookTelegramConfig | undefined,
    env: NodeJS.ProcessEnv = process.env
): WebhookTelegramConfig {
    const enabled = envBoolean(env, 'CONFIG_TELEGRAM_ENABLED', Boolean(base?.enabled))
    const summaryOnly = envBoolean(env, 'CONFIG_TELEGRAM_SUMMARY_ONLY', Boolean(base?.summaryOnly))
    const botToken = envValue(env, 'CONFIG_TELEGRAM_BOTTOKEN') ?? ''
    const chatId = envValue(env, 'CONFIG_TELEGRAM_CHATID') ?? ''
    const proxyUrl = normalizeTelegramProxyUrl(envValue(env, 'CONFIG_TELEGRAM_PROXY_URL'))

    const relayUrl = envValue(env, 'CONFIG_TELEGRAM_RELAY_URL')
    const relayToken = envValue(env, 'CONFIG_TELEGRAM_RELAY_TOKEN')
    if (Boolean(relayUrl) !== Boolean(relayToken)) {
        throw new Error('CONFIG_TELEGRAM_RELAY_URL and CONFIG_TELEGRAM_RELAY_TOKEN must be configured together.')
    }
    if (relayUrl) {
        let parsed: URL
        try {
            parsed = new URL(relayUrl)
        } catch {
            throw new Error('CONFIG_TELEGRAM_RELAY_URL must be a valid HTTPS URL.')
        }
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
            throw new Error(
                'CONFIG_TELEGRAM_RELAY_URL must use HTTPS without credentials, query parameters, or fragments.'
            )
        }
    }

    if (enabled && !relayUrl && (!botToken || !chatId)) {
        throw new Error('Telegram is enabled but CONFIG_TELEGRAM_BOTTOKEN or CONFIG_TELEGRAM_CHATID is missing.')
    }

    return {
        enabled,
        botToken,
        chatId,
        summaryOnly,
        proxyUrl,
        relayUrl,
        relayToken,
        sourceLabel: envValue(env, 'CONFIG_TELEGRAM_SOURCE_LABEL')?.slice(0, 80)
    }
}

export function applyTelegramRuntimeConfig(config: Config, env: NodeJS.ProcessEnv = process.env): Config {
    return {
        ...config,
        webhook: {
            ...config.webhook,
            telegram: resolveTelegramRuntimeConfig(config.webhook.telegram, env)
        }
    }
}

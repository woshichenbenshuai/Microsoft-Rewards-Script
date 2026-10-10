import { httpRequest } from '../util/Http'
import type { HttpRequestConfig } from '../util/Http'
import PQueue from 'p-queue'
import type { WebhookTelegramConfig } from '../interface/Config'
import type { LogLevel } from './Logger'
import { flushQueue } from './Queue'

const telegramQueue = new PQueue({
    interval: 1000,
    intervalCap: 2,
    carryoverConcurrencyCount: true
})

export interface TelegramAccountSummary {
    email: string
    success: boolean
    consecutiveSuccessfulDays: number | null
    totalSuccessfulDays: number | null
    pointsGained: number
    previousBalance: number | null
    currentBalance: number | null
    runtimeMinutes: number | string
    failureReason?: string
}

export interface TelegramRunSummary {
    accounts?: TelegramAccountSummary[]
    expectedAccounts: number
    successfulAccounts: number
    failedAccounts: number
    pointsGained: number
    currentBalance: number | null
    runtimeMinutes: number | string
    completedAt?: Date
    timeZone?: string
    failureReasons?: string[]
    safetyPaused?: boolean
    safetyReason?: string
}

function getTelegramEmoji(level: LogLevel): string {
    switch (level) {
        case 'error':
            return '❌'
        case 'warn':
            return '⚠️'
        case 'info':
            return 'ℹ️'
        case 'debug':
            return '🐛'
        default:
            return '📝'
    }
}

function safeReason(value: string): string {
    return value
        .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[账号]')
        .replace(/bot\d+:[A-Za-z0-9_-]+/gi, 'bot[已隐藏]')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 300)
}

function localCompletionTime(date: Date, timeZone: string): string {
    try {
        return new Intl.DateTimeFormat('zh-CN', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        }).format(date)
    } catch {
        return date.toISOString()
    }
}

export function formatTelegramRunSummary(summary: TelegramRunSummary): string {
    if (summary.accounts?.length) {
        return summary.accounts
            .map(account => {
                const lines = [
                    account.success ? '✅ Microsoft Rewards 任务完成' : '❌ Microsoft Rewards 任务未完整完成',
                    '',
                    `账号：${account.email}`,
                    `连续成功：${account.consecutiveSuccessfulDays ?? '未知'} 天`,
                    `累计成功：${account.totalSuccessfulDays ?? '未知'} 天`,
                    '',
                    `本次获得：${account.pointsGained} 分`,
                    `积分变化：${account.previousBalance ?? '未知'} → ${account.currentBalance ?? '未知'}`,
                    `耗时：${account.runtimeMinutes} 分钟`,
                    `完成时间：${localCompletionTime(summary.completedAt ?? new Date(), summary.timeZone || process.env.TZ || 'Asia/Shanghai')}`
                ]
                if (!account.success) lines.push(`失败原因：${safeReason(account.failureReason ?? '账号任务未完成')}`)
                if (account.consecutiveSuccessfulDays === null || account.totalSuccessfulDays === null)
                    lines.push('统计状态：记录读取或保存失败，请检查 run-history.json')
                if (summary.safetyPaused)
                    lines.push(
                        '状态：风控熔断已开启，后续定时任务已暂停',
                        `熔断原因：${safeReason(summary.safetyReason ?? '需要人工检查')}`,
                        '恢复方式：检查账号后执行 npm run safety:reset'
                    )
                return lines.join('\n')
            })
            .join('\n\n')
    }
    const complete = summary.failedAccounts === 0 && summary.successfulAccounts === summary.expectedAccounts
    const heading = summary.safetyPaused
        ? '⚠️ Microsoft Rewards 风控熔断已开启'
        : complete
          ? '✅ Microsoft Rewards 每日任务完成'
          : '❌ Microsoft Rewards 每日任务未完整完成'
    const balanceLabel = complete ? '当前总积分' : '已知总积分'
    const balance = summary.currentBalance == null ? '未知' : String(summary.currentBalance)
    const timeZone = summary.timeZone || process.env.TZ || 'Asia/Shanghai'
    const completedAt = localCompletionTime(summary.completedAt ?? new Date(), timeZone)
    const lines = [
        heading,
        `账号：${summary.successfulAccounts}/${summary.expectedAccounts} 成功`,
        `本次获得：${summary.pointsGained}`,
        `${balanceLabel}：${balance}`,
        `耗时：${summary.runtimeMinutes} 分钟`,
        `完成时间：${completedAt} (${timeZone})`
    ]

    if (summary.safetyPaused) {
        lines.push('状态：后续定时任务已暂停')
        lines.push(`熔断原因：${safeReason(summary.safetyReason ?? '需要人工检查')}`)
        lines.push('恢复方式：检查账号后执行 npm run safety:reset')
    }

    const reasons = (summary.failureReasons ?? []).map(safeReason).filter(Boolean).slice(0, 3)
    if (!complete && reasons.length) lines.push(`原因：${reasons.join('；')}`)

    return lines.join('\n')
}

export function formatTelegramFatalFailure(reason: string, timeZone = process.env.TZ || 'Asia/Shanghai'): string {
    return [
        '❌ Microsoft Rewards 任务失败',
        `原因：${safeReason(reason) || '未知错误'}`,
        `时间：${localCompletionTime(new Date(), timeZone)} (${timeZone})`
    ].join('\n')
}

async function deliverTelegram(
    config: WebhookTelegramConfig,
    text: string,
    options: { parseMode?: 'MarkdownV2'; silent?: boolean; throwOnError?: boolean } = {}
): Promise<boolean> {
    if (!config.enabled || (!config.relayUrl && (!config.botToken || !config.chatId))) return false
    if (config.relayUrl && !config.relayToken) return false

    const url = config.relayUrl ?? `https://api.telegram.org/bot${config.botToken}/sendMessage`
    const data: Record<string, unknown> = {
        text: config.sourceLabel ? `${config.sourceLabel}\n${text}` : text,
        disable_notification: Boolean(options.silent)
    }
    if (!config.relayUrl) data.chat_id = config.chatId
    if (options.parseMode) data.parse_mode = options.parseMode

    const request: HttpRequestConfig = {
        method: 'POST',
        url,
        headers: {
            'Content-Type': 'application/json',
            ...(config.relayUrl
                ? { Authorization: `Bearer ${config.relayToken}`, 'User-Agent': 'Microsoft-Rewards-Notification/4.3.2' }
                : {})
        },
        data,
        timeout: 10000,
        retries: 2,
        proxyUrl: config.proxyUrl
    }

    const result = await telegramQueue.add(async () => {
        try {
            const response = await httpRequest<{ ok?: boolean }>(request)
            if (response.data?.ok !== true) throw new Error('Telegram response did not confirm delivery.')
            return true
        } catch (error) {
            const status =
                (error as { response?: { status?: number }; status?: number })?.response?.status ??
                (error as { status?: number })?.status
            if (options.throwOnError) {
                throw new Error(
                    status ? `Telegram notification failed with HTTP ${status}.` : 'Telegram notification failed.'
                )
            }
            console.warn(
                status
                    ? `[telegram] Notification delivery failed (HTTP ${status}); credentials and URL were redacted.`
                    : '[telegram] Notification delivery failed; credentials and URL were redacted.'
            )
            return false
        }
    })

    return result === true
}

export function sendTelegram(config: WebhookTelegramConfig, content: string, level: LogLevel): Promise<boolean> {
    const emoji = getTelegramEmoji(level)
    const message = `${emoji}\n\`\`\`\n${content}\n\`\`\``
    return deliverTelegram(config, message, { parseMode: 'MarkdownV2', silent: level === 'debug' })
}

export async function sendTelegramRunSummary(
    config: WebhookTelegramConfig,
    summary: TelegramRunSummary
): Promise<boolean> {
    // Send one message per account so large deployments do not exceed Telegram's text limit.
    if (summary.accounts?.length) {
        let delivered = true
        const completedAt = summary.completedAt ?? new Date()
        for (const account of summary.accounts) {
            if (
                !(await deliverTelegram(
                    config,
                    formatTelegramRunSummary({ ...summary, completedAt, accounts: [account] })
                ))
            )
                delivered = false
        }
        return delivered
    }
    return deliverTelegram(config, formatTelegramRunSummary(summary))
}

export function sendTelegramFatalFailure(config: WebhookTelegramConfig, reason: string): Promise<boolean> {
    return deliverTelegram(config, formatTelegramFatalFailure(reason))
}

export function sendTelegramTest(config: WebhookTelegramConfig): Promise<boolean> {
    const timeZone = process.env.TZ || 'Asia/Shanghai'
    const message = [
        '✅ Microsoft Rewards Telegram 通知测试成功',
        '未运行 Rewards 任务，也未发送任何账号信息。',
        `时间：${localCompletionTime(new Date(), timeZone)} (${timeZone})`
    ].join('\n')
    return deliverTelegram(config, message, { throwOnError: true })
}

export function flushTelegramQueue(timeoutMs = 5000): Promise<void> {
    return flushQueue(telegramQueue, timeoutMs)
}

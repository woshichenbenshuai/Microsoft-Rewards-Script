import type { TelegramAccountSummary } from '../logging/Telegram'
import { recordAccountRunHistory } from './RunHistory'

interface AccountResult {
    email: string
    success: boolean
    balanceKnown: boolean
    initialPoints: number
    finalPoints: number
    collectedPoints: number
    duration: number
    error?: string
}

export async function summarizeAccountRuns(
    emails: string[],
    stats: AccountResult[],
    options: Parameters<typeof recordAccountRunHistory>[1] = {}
): Promise<TelegramAccountSummary[]> {
    const outcomes = emails.map(email => {
        const result = stats.find(stat => stat.email.trim().toLowerCase() === email.trim().toLowerCase())
        return {
            email,
            success: result?.success === true,
            consecutiveSuccessfulDays: null,
            totalSuccessfulDays: null,
            pointsGained: result?.collectedPoints ?? 0,
            previousBalance: result?.balanceKnown ? result.initialPoints : null,
            currentBalance: result?.balanceKnown ? result.finalPoints : null,
            runtimeMinutes: result ? (result.duration / 60).toFixed(1) : '未知',
            failureReason: result?.error ?? (result?.success ? undefined : '任务进程异常退出或账号未完成')
        } satisfies TelegramAccountSummary
    })
    try {
        const counts = await recordAccountRunHistory(outcomes, options)
        return outcomes.map(outcome => ({ ...outcome, ...counts[outcome.email.trim().toLowerCase()] }))
    } catch {
        console.warn('[run-history] Could not save statistics; existing records were not reset.')
        return outcomes
    }
}

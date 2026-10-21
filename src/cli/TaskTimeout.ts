import { loadConfig } from '../util/Load'
import { getSafetyState, recordRunOutcome } from '../util/SafetyState'
import { sendTelegramFatalFailure, flushTelegramQueue } from '../logging/Telegram'

async function main(): Promise<void> {
    const minutes = process.argv[2]
    if (!minutes || !/^[1-9][0-9]*$/.test(minutes)) throw new Error('Invalid task deadline.')
    // A graceful SIGTERM may already have finalized the run as interrupted.
    // Preserve that outcome, the daily marker, and all existing success dates.
    const state = await getSafetyState()
    if (state.lastRun?.status === 'success') {
        console.log('[timeout] Run was already successful; no failure alert was sent.')
        return
    }
    if (state.lastRun?.status === 'running') await recordRunOutcome({ status: 'failed' })
    const telegram = loadConfig().webhook.telegram
    if (!telegram?.enabled) return
    const delivered = await sendTelegramFatalFailure(
        telegram,
        `任务超过 ${minutes} 分钟未结束，已停止本次任务。今日未完整成功，不会自动重跑；请检查任务日志。`
    )
    await flushTelegramQueue(15000)
    if (!delivered) throw new Error('Timeout alert delivery was not confirmed.')
    console.log('[timeout] Alert delivered; no Rewards task was started.')
}

main().catch(() => {
    console.error('[timeout] Could not finalize state or deliver alert; inspect task logs.')
    process.exitCode = 1
})

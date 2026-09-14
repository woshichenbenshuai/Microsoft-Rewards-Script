import { sendTelegramTest, flushTelegramQueue } from '../logging/Telegram'
import { loadConfig } from '../util/Load'

async function main(): Promise<void> {
    const telegram = loadConfig().webhook.telegram
    if (!telegram?.enabled) throw new Error('Telegram is disabled. Set CONFIG_TELEGRAM_ENABLED=true.')

    await sendTelegramTest(telegram)
    await flushTelegramQueue(15000)
    console.log('[telegram] Test message delivered successfully; no Rewards task was run.')
}

main().catch(error => {
    console.error(`[telegram] Test failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
})

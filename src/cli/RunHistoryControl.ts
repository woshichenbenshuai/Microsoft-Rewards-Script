import { loadAccounts } from '../util/Load'
import { businessDate, getSafetyState } from '../util/SafetyState'
import { getAccountSuccessDays, initializeRunHistory } from '../util/RunHistory'

async function main(): Promise<void> {
    const command = process.argv[2]
    if (command !== 'init' && command !== 'status') throw new Error('Use init or status.')
    const accounts = loadAccounts()
    const safety = await getSafetyState()
    if (command === 'init') {
        await initializeRunHistory(
            accounts.map(account => account.email),
            safety.lastRun
        )
        console.log('[run-history] Initialized from the last confirmed result; no Rewards task was run.')
    }
    // Before today's task, show the streak through yesterday rather than resetting it early.
    const today = businessDate(new Date(), safety.timeZone)
    const previous = new Date(`${today}T00:00:00Z`)
    previous.setUTCDate(previous.getUTCDate() - 1)
    const date =
        safety.lastRun?.date === today && safety.lastRun.status !== 'running'
            ? today
            : previous.toISOString().slice(0, 10)
    for (const [index, account] of accounts.entries()) {
        const days = await getAccountSuccessDays(account.email, { date })
        console.log(
            `[run-history] Account ${index + 1}: consecutive=${days.consecutiveSuccessfulDays} total=${days.totalSuccessfulDays} asOf=${date}`
        )
    }
}

main().catch(() => {
    console.error('[run-history] Could not read or initialize statistics; existing records were not reset.')
    process.exitCode = 1
})

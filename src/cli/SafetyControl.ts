import {
    businessDate,
    getSafetyState,
    precheckDailyRun,
    recordRunOutcome,
    resetSafetyCircuit,
    resolveSafetyStatePath
} from '../util/SafetyState'

async function printStatus(scope: 'all' | 'run'): Promise<void> {
    const state = await getSafetyState()
    if (scope === 'all') {
        console.log(`[safety] Circuit: ${state.circuit.open ? 'OPEN' : 'CLOSED'}`)
        if (state.circuit.open) {
            console.log(`[safety] Reason: ${state.circuit.reason ?? 'unknown'}`)
            console.log(`[safety] Opened at: ${state.circuit.openedAt ?? 'unknown'}`)
        }
        console.log(`[safety] Consecutive login failure days: ${state.loginFailures.consecutiveRunDays}`)
    }

    if (!state.lastRun) {
        console.log('[safety] Last run: none')
        return
    }
    console.log(`[safety] Last run date: ${state.lastRun.date}`)
    console.log(`[safety] Last run status: ${state.lastRun.status}`)
    console.log(`[safety] Last run started: ${state.lastRun.startedAt}`)
    if (state.lastRun.finishedAt) console.log(`[safety] Last run finished: ${state.lastRun.finishedAt}`)
}

function fail(error: unknown): void {
    console.error(`[safety] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
}

async function main(): Promise<void> {
    const command = process.argv[2]

    switch (command) {
        case 'precheck': {
            const decision = await precheckDailyRun()
            if (decision.allowed) {
                console.log(`[safety] Run is allowed for ${decision.date}`)
                return
            }
            if (decision.reason === 'already_ran_today') {
                console.log(`[safety] Skipping: a run already started on ${decision.date}`)
                process.exitCode = 20
                return
            }
            console.log(
                `[safety] Skipping: circuit is open (${decision.state.circuit.reason ?? 'manual review required'})`
            )
            process.exitCode = 21
            return
        }

        case 'status':
            await printStatus('all')
            return

        case 'run-status':
            await printStatus('run')
            return

        case 'reset': {
            const state = await resetSafetyCircuit()
            console.log('[safety] Circuit reset; no Rewards task was started.')
            if (state.lastRun) {
                console.log(`[safety] Daily run marker remains: ${state.lastRun.date} (${state.lastRun.status})`)
            }
            return
        }

        case 'finish': {
            const requestedStatus = process.argv[3]
            if (requestedStatus !== 'success' && requestedStatus !== 'failed' && requestedStatus !== 'interrupted') {
                throw new Error('finish requires success, failed, or interrupted')
            }
            const current = await getSafetyState()
            const today = businessDate(new Date(), current.timeZone)
            if (current.lastRun?.date === today && current.lastRun.status !== 'running') {
                console.log(
                    `[safety] Run state already finalized as ${current.lastRun.status}; fallback did not overwrite it.`
                )
                return
            }
            await recordRunOutcome({
                status: requestedStatus
            })
            console.log(`[safety] Run state finalized as ${requestedStatus}`)
            return
        }

        default:
            throw new Error(
                `Unknown command. Use precheck, status, run-status, reset, or finish. State: ${resolveSafetyStatePath()}`
            )
    }
}

main().catch(fail)

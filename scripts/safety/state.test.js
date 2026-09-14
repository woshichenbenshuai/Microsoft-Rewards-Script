import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
    claimDailyRun,
    classifyImmediateSafetySignal,
    getSafetyState,
    precheckDailyRun,
    recordRunOutcome,
    resetSafetyCircuit
} from '../../dist/util/SafetyState.js'

async function withStateFile(run) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rewards-safety-'))
    const statePath = path.join(directory, 'safety-state.json')
    try {
        await run(statePath)
    } finally {
        await fs.rm(directory, { recursive: true, force: true })
    }
}

test('allows only one claimed run per Asia/Shanghai calendar day', async () => {
    await withStateFile(async statePath => {
        const now = new Date('2026-09-14T00:00:00.000Z')
        const attempts = await Promise.all([
            claimDailyRun({ statePath, now, timeZone: 'Asia/Shanghai' }),
            claimDailyRun({ statePath, now, timeZone: 'Asia/Shanghai' })
        ])

        assert.equal(attempts.filter(attempt => attempt.allowed).length, 1)
        assert.equal(attempts.filter(attempt => !attempt.allowed).length, 1)
        assert.equal(attempts.find(attempt => !attempt.allowed)?.reason, 'already_ran_today')
    })
})

test('uses the Beijing date boundary instead of a rolling 24-hour window', async () => {
    await withStateFile(async statePath => {
        const beforeMidnight = new Date('2026-09-14T15:59:00.000Z')
        const afterMidnight = new Date('2026-09-14T16:01:00.000Z')

        assert.equal((await claimDailyRun({ statePath, now: beforeMidnight })).date, '2026-09-14')
        assert.equal((await precheckDailyRun({ statePath, now: afterMidnight })).allowed, true)
        assert.equal((await claimDailyRun({ statePath, now: afterMidnight })).date, '2026-09-15')
    })
})

test('opens immediately for a bot warning and remains blocked until reset', async () => {
    await withStateFile(async statePath => {
        const firstDay = new Date('2026-09-14T01:00:00.000Z')
        await claimDailyRun({ statePath, now: firstDay })
        const outcome = await recordRunOutcome({
            statePath,
            now: firstDay,
            status: 'failed',
            immediateSignal: {
                code: 'bot_warning',
                reason: 'untrusted raw reason is not persisted'
            }
        })

        assert.equal(outcome.circuitJustOpened, true)
        assert.equal(outcome.state.circuit.open, true)
        assert.equal(outcome.state.circuit.reason, 'Microsoft 返回 Bot Warning')

        const nextDay = new Date('2026-09-15T01:00:00.000Z')
        assert.equal((await precheckDailyRun({ statePath, now: nextDay })).reason, 'circuit_open')

        await resetSafetyCircuit({ statePath, now: nextDay })
        assert.equal((await precheckDailyRun({ statePath, now: nextDay })).allowed, true)
    })
})

test('opens after login failures on two distinct run days', async () => {
    await withStateFile(async statePath => {
        const dayOne = new Date('2026-09-14T01:00:00.000Z')
        await claimDailyRun({ statePath, now: dayOne })
        const first = await recordRunOutcome({
            statePath,
            now: dayOne,
            status: 'failed',
            hadLoginFailure: true
        })
        assert.equal(first.state.circuit.open, false)
        assert.equal(first.state.loginFailures.consecutiveRunDays, 1)

        const dayTwo = new Date('2026-09-15T01:00:00.000Z')
        await claimDailyRun({ statePath, now: dayTwo })
        const second = await recordRunOutcome({
            statePath,
            now: dayTwo,
            status: 'failed',
            hadLoginFailure: true
        })
        assert.equal(second.circuitJustOpened, true)
        assert.equal(second.state.circuit.open, true)
        assert.equal(second.state.circuit.code, 'consecutive_login_failures')
    })
})

test('a successful login resets the consecutive-login-failure counter', async () => {
    await withStateFile(async statePath => {
        const dayOne = new Date('2026-09-14T01:00:00.000Z')
        await claimDailyRun({ statePath, now: dayOne })
        await recordRunOutcome({ statePath, now: dayOne, status: 'failed', hadLoginFailure: true })

        const dayTwo = new Date('2026-09-15T01:00:00.000Z')
        await claimDailyRun({ statePath, now: dayTwo })
        const success = await recordRunOutcome({
            statePath,
            now: dayTwo,
            status: 'success',
            hadSuccessfulLogin: true
        })
        assert.equal(success.state.loginFailures.consecutiveRunDays, 0)
    })
})

test('corrupt state fails closed instead of silently allowing a run', async () => {
    await withStateFile(async statePath => {
        await fs.writeFile(statePath, '{not-json')
        await assert.rejects(precheckDailyRun({ statePath }), /refusing to run/)
        await assert.rejects(getSafetyState({ statePath }), /refusing to run/)
    })
})

test('classifies only explicit immediate safety signals', () => {
    assert.equal(classifyImmediateSafetySignal(new Error('CAPTCHA required'))?.code, 'captcha')
    assert.equal(classifyImmediateSafetySignal(new Error('Account locked by service abuse'))?.code, 'account_locked')
    assert.equal(classifyImmediateSafetySignal(new Error('network timeout')), undefined)
})

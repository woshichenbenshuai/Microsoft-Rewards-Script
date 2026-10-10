import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { initializeRunHistory, recordAccountRunHistory, getAccountSuccessDays } from '../../dist/util/RunHistory.js'
import { summarizeAccountRuns } from '../../dist/util/AccountRunSummary.js'

async function withHistory(run) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rewards-history-'))
    try {
        await run({ statePath: path.join(directory, 'history.json'), timeZone: 'Asia/Shanghai' })
    } finally {
        await fs.rm(directory, { recursive: true, force: true })
    }
}
const success = [{ email: 'User@example.com', success: true }]
const failed = [{ email: 'user@example.com', success: false }]

test('success days survive repeated runs, case changes and reloads', async () => {
    await withHistory(async options => {
        await recordAccountRunHistory(success, { ...options, date: '2026-10-09' })
        await recordAccountRunHistory(success, { ...options, date: '2026-10-10' })
        await recordAccountRunHistory(success, { ...options, date: '2026-10-10' })
        await recordAccountRunHistory(failed, { ...options, date: '2026-10-10' })
        assert.deepEqual(await getAccountSuccessDays('user@example.com', { ...options, date: '2026-10-10' }), {
            consecutiveSuccessfulDays: 2,
            totalSuccessfulDays: 2
        })
    })
})
test('failed and missed dates break streak but preserve cumulative days', async () => {
    await withHistory(async options => {
        await recordAccountRunHistory(success, { ...options, date: '2026-10-07' })
        await recordAccountRunHistory(failed, { ...options, date: '2026-10-08' })
        assert.deepEqual(await getAccountSuccessDays('user@example.com', { ...options, date: '2026-10-08' }), {
            consecutiveSuccessfulDays: 0,
            totalSuccessfulDays: 1
        })
        await recordAccountRunHistory(success, { ...options, date: '2026-10-10' })
        assert.deepEqual(await getAccountSuccessDays('user@example.com', { ...options, date: '2026-10-10' }), {
            consecutiveSuccessfulDays: 1,
            totalSuccessfulDays: 2
        })
    })
})
test('failure followed by success on same day counts exactly once', async () => {
    await withHistory(async options => {
        const date = '2026-10-10'
        await recordAccountRunHistory(failed, { ...options, date })
        await recordAccountRunHistory(success, { ...options, date })
        assert.deepEqual(await getAccountSuccessDays('user@example.com', { ...options, date }), {
            consecutiveSuccessfulDays: 1,
            totalSuccessfulDays: 1
        })
    })
})
test('uses Beijing midnight and keeps claimed date for cross-midnight task', async () => {
    await withHistory(async options => {
        await recordAccountRunHistory(success, { ...options, now: new Date('2026-10-09T15:59:00Z') })
        await recordAccountRunHistory(success, {
            ...options,
            now: new Date('2026-10-09T16:01:00Z'),
            date: '2026-10-09'
        })
        assert.deepEqual(await getAccountSuccessDays('user@example.com', { ...options, date: '2026-10-09' }), {
            consecutiveSuccessfulDays: 1,
            totalSuccessfulDays: 1
        })
        await recordAccountRunHistory(success, { ...options, now: new Date('2026-10-09T16:01:00Z') })
        assert.equal(
            (await getAccountSuccessDays('user@example.com', { ...options, date: '2026-10-10' }))
                .consecutiveSuccessfulDays,
            2
        )
    })
})
test('concurrent account updates remain independent without losing results', async () => {
    await withHistory(async options => {
        await Promise.all(
            ['a@example.com', 'b@example.com'].map(email =>
                recordAccountRunHistory([{ email, success: true }], { ...options, date: '2026-10-10' })
            )
        )
        for (const email of ['a@example.com', 'b@example.com'])
            assert.equal(
                (await getAccountSuccessDays(email, { ...options, date: '2026-10-10' })).totalSuccessfulDays,
                1
            )
    })
})
test('migration seeds only known last success once; never invents multi-account history', async () => {
    await withHistory(async options => {
        await initializeRunHistory(['user@example.com'], { date: '2026-10-10', status: 'success' }, options)
        await initializeRunHistory(['user@example.com'], { date: '2026-10-11', status: 'success' }, options)
        assert.equal(
            (await getAccountSuccessDays('user@example.com', { ...options, date: '2026-10-10' })).totalSuccessfulDays,
            1
        )
    })
    await withHistory(async options => {
        await initializeRunHistory(
            ['a@example.com', 'b@example.com'],
            { date: '2026-10-10', status: 'success' },
            options
        )
        assert.equal(
            (await getAccountSuccessDays('a@example.com', { ...options, date: '2026-10-10' })).totalSuccessfulDays,
            0
        )
    })
})
test('invalid history and time zone mismatch fail without replacing the original file', async () => {
    await withHistory(async options => {
        for (const original of [
            'null',
            '{broken',
            JSON.stringify({ version: 1, timeZone: 'UTC', accounts: {} }),
            JSON.stringify({
                version: 1,
                timeZone: 'Asia/Shanghai',
                accounts: { 'x@example.com': { successfulDates: ['2026-02-30'] } }
            })
        ]) {
            await fs.writeFile(options.statePath, original)
            await assert.rejects(recordAccountRunHistory(success, { ...options, date: '2026-10-10' }))
            assert.equal(await fs.readFile(options.statePath, 'utf8'), original)
        }
    })
})
test('partial failure and missing worker results never count; successful accounts count separately', async () => {
    await withHistory(async options => {
        const details = await summarizeAccountRuns(
            ['a@example.com', 'b@example.com', 'c@example.com'],
            [
                {
                    email: 'a@example.com',
                    success: true,
                    balanceKnown: true,
                    initialPoints: 50,
                    finalPoints: 370,
                    collectedPoints: 320,
                    duration: 960
                },
                {
                    email: 'b@example.com',
                    success: false,
                    balanceKnown: true,
                    initialPoints: 50,
                    finalPoints: 100,
                    collectedPoints: 50,
                    duration: 300,
                    error: 'Login failed'
                }
            ],
            { ...options, date: '2026-10-10' }
        )
        assert.equal(details[0].totalSuccessfulDays, 1)
        assert.equal(details[0].runtimeMinutes, '16.0')
        assert.equal(details[1].totalSuccessfulDays, 0)
        assert.equal(details[1].pointsGained, 50)
        assert.equal(details[2].totalSuccessfulDays, 0)
        assert.equal(details[2].success, false)
        assert.equal(details[2].currentBalance, null)
    })
})

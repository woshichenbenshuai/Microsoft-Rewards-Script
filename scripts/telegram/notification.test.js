import assert from 'node:assert/strict'
import test from 'node:test'

import { formatTelegramFatalFailure, formatTelegramRunSummary } from '../../dist/logging/Telegram.js'
import { resolveTelegramRuntimeConfig } from '../../dist/util/TelegramRuntime.js'
import { TerminalNotificationGate } from '../../dist/logging/TerminalNotification.js'
import { ENV_OVERRIDES } from '../../dist/util/ConfigEnvOverrides.js'
import { snapshotAccountBalance, totalKnownFinalBalance } from '../../dist/util/RunStats.js'

test('formats one successful run summary with gained and total points', () => {
    const message = formatTelegramRunSummary({
        expectedAccounts: 1,
        successfulAccounts: 1,
        failedAccounts: 0,
        pointsGained: 390,
        currentBalance: 395,
        runtimeMinutes: '19.9',
        completedAt: new Date('2026-09-14T00:20:00Z'),
        timeZone: 'Asia/Shanghai'
    })

    assert.match(message, /每日任务完成/)
    assert.match(message, /本次获得：390/)
    assert.match(message, /当前总积分：395/)
    assert.equal(message.match(/每日任务完成/g)?.length, 1)
})

test('formats a failed summary without exposing account addresses or bot tokens', () => {
    const message = formatTelegramRunSummary({
        expectedAccounts: 1,
        successfulAccounts: 0,
        failedAccounts: 1,
        pointsGained: 0,
        currentBalance: null,
        runtimeMinutes: '1.2',
        failureReasons: ['user@example.com failed with bot123456:ABC_secret']
    })

    assert.match(message, /未完整完成/)
    assert.match(message, /已知总积分：未知/)
    assert.doesNotMatch(message, /user@example\.com|ABC_secret/)
})

test('formats a single circuit-breaker summary without exposing raw secrets', () => {
    const message = formatTelegramRunSummary({
        expectedAccounts: 1,
        successfulAccounts: 0,
        failedAccounts: 1,
        pointsGained: 20,
        currentBalance: 300,
        runtimeMinutes: '4.2',
        safetyPaused: true,
        safetyReason: 'CAPTCHA for user@example.com via bot123456:ABC_secret'
    })

    assert.match(message, /风控熔断已开启/)
    assert.match(message, /后续定时任务已暂停/)
    assert.match(message, /safety:reset/)
    assert.doesNotMatch(message, /user@example\.com/)
    assert.doesNotMatch(message, /ABC_secret/)
})

test('retains known points when an account fails after partial completion', () => {
    const partial = snapshotAccountBalance({ balanceKnown: true, initialPoints: 18, currentPoints: 293 })

    assert.deepEqual(partial, {
        balanceKnown: true,
        initialPoints: 18,
        finalPoints: 293,
        collectedPoints: 275
    })
    assert.equal(totalKnownFinalBalance([partial]), 293)

    const message = formatTelegramRunSummary({
        expectedAccounts: 1,
        successfulAccounts: 0,
        failedAccounts: 1,
        pointsGained: partial.collectedPoints,
        currentBalance: totalKnownFinalBalance([partial]),
        runtimeMinutes: '13.6',
        failureReasons: ['Microsoft login error: Unknown Error']
    })

    assert.match(message, /本次获得：275/)
    assert.match(message, /已知总积分：293/)
})

test('redacts secrets from fatal failure text', () => {
    const message = formatTelegramFatalFailure('request bot123456:ABC_secret failed for user@example.com')
    assert.doesNotMatch(message, /user@example\.com|ABC_secret/)
})

test('loads Telegram secrets only from runtime environment and validates proxy protocol', () => {
    const config = resolveTelegramRuntimeConfig(
        { enabled: false, botToken: 'persisted-secret', chatId: 'persisted-chat', proxyUrl: 'http://persisted:8080' },
        {
            CONFIG_TELEGRAM_ENABLED: 'true',
            CONFIG_TELEGRAM_SUMMARY_ONLY: 'true',
            CONFIG_TELEGRAM_BOTTOKEN: 'runtime-secret',
            CONFIG_TELEGRAM_CHATID: 'runtime-chat',
            CONFIG_TELEGRAM_PROXY_URL: 'socks5://127.0.0.1:1080'
        }
    )

    assert.equal(config.botToken, 'runtime-secret')
    assert.equal(config.chatId, 'runtime-chat')
    assert.equal(config.summaryOnly, true)
    assert.equal(config.proxyUrl, 'socks5://127.0.0.1:1080')
    assert.throws(
        () => resolveTelegramRuntimeConfig(undefined, { CONFIG_TELEGRAM_PROXY_URL: 'ftp://127.0.0.1' }),
        /http, https, socks4, or socks5/
    )
})

test('allows only one terminal notification per process', () => {
    const gate = new TerminalNotificationGate()
    assert.equal(gate.claim(), true)
    assert.equal(gate.claim(), false)
    assert.equal(gate.claim(), false)
})

test('does not persist Telegram secrets through config overrides', () => {
    const overrideNames = new Set(ENV_OVERRIDES.map(item => item.env))
    assert.equal(overrideNames.has('CONFIG_TELEGRAM_BOTTOKEN'), false)
    assert.equal(overrideNames.has('CONFIG_TELEGRAM_CHATID'), false)
    assert.equal(overrideNames.has('CONFIG_TELEGRAM_PROXY_URL'), false)
})

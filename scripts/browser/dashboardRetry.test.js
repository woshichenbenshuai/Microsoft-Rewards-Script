import assert from 'node:assert/strict'
import test from 'node:test'

import browserFuncModule from '../../dist/browser/BrowserFunc.js'

const BrowserFunc = browserFuncModule.default

const PRIMARY_URL = 'https://rewards.bing.com/api/getuserinfo'
const FLYOUT_URL = 'https://www.bing.com/rewards/panelflyout/getuserinfo?channel=BingFlyout&partnerId=BingRewards'

function response(data) {
    return {
        data,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {}
    }
}

function flyoutData(balance = 100) {
    return {
        userInfo: {
            isRewardsUser: true,
            balance,
            profile: { attributes: {} }
        },
        flyoutResult: {
            userStatus: {
                isRewardsUser: true,
                availablePoints: balance,
                counters: {}
            }
        }
    }
}

function createBot(request) {
    const logs = []
    const delays = []
    const record =
        level =>
        (...args) =>
            logs.push({ level, args })

    return {
        bot: {
            fingerprint: { headers: {} },
            isMobile: false,
            cookies: { mobile: [], desktop: [] },
            currentAccountEmail: '',
            http: { request },
            logger: {
                debug: record('debug'),
                info: record('info'),
                warn: record('warn'),
                error: record('error')
            },
            utils: {
                wait: async delay => {
                    delays.push(delay)
                }
            }
        },
        logs,
        delays
    }
}

test('retries the primary dashboard and recovers on the third attempt', async () => {
    let attempts = 0
    const { bot, logs, delays } = createBot(async config => {
        assert.equal(config.url, PRIMARY_URL)
        assert.equal(config.timeout, 20000)
        assert.equal(config.retries, 0)
        attempts++
        if (attempts < 3) throw new Error('temporary timeout')
        return response({ dashboard: { userStatus: { counters: {} } } })
    })

    const dashboard = await new BrowserFunc(bot).getDashboardData([])

    assert.ok(dashboard.dashboard)
    assert.equal(attempts, 3)
    assert.equal(delays.length, 2)
    assert.ok(delays[0] >= 1000 && delays[0] < 1250)
    assert.ok(delays[1] >= 2000 && delays[1] < 2250)
    assert.ok(logs.some(entry => entry.level === 'info' && entry.args[2].includes('recovered on attempt 3/3')))
})

test('falls back after three primary failures and retries the flyout endpoint', async () => {
    let primaryAttempts = 0
    let flyoutAttempts = 0
    const { bot, logs, delays } = createBot(async config => {
        if (config.url === PRIMARY_URL) {
            primaryAttempts++
            throw new Error('dashboard missing')
        }
        assert.equal(config.url, FLYOUT_URL)
        assert.equal(config.timeout, 20000)
        assert.equal(config.retries, 0)
        flyoutAttempts++
        if (flyoutAttempts < 3) throw new Error('temporary timeout')
        return response(flyoutData(321))
    })

    const dashboard = await new BrowserFunc(bot).getDashboardData([])

    assert.equal(dashboard.dashboard.userStatus.availablePoints, 321)
    assert.equal(primaryAttempts, 3)
    assert.equal(flyoutAttempts, 3)
    assert.equal(delays.length, 4)
    assert.ok(
        logs.some(
            entry => entry.level === 'warn' && entry.args[2].includes('Primary dashboard unavailable after 3 attempts')
        )
    )
    assert.ok(logs.some(entry => entry.level === 'info' && entry.args[2].includes('recovered on attempt 3/3')))
})

test('stops after three flyout attempts and reports the final failure', async () => {
    let primaryAttempts = 0
    let flyoutAttempts = 0
    const { bot, logs } = createBot(async config => {
        if (config.url === PRIMARY_URL) {
            primaryAttempts++
            throw new Error('primary unavailable')
        }
        flyoutAttempts++
        throw new Error('flyout unavailable')
    })

    await assert.rejects(() => new BrowserFunc(bot).getDashboardData([]), /flyout unavailable/)

    assert.equal(primaryAttempts, 3)
    assert.equal(flyoutAttempts, 3)
    assert.ok(
        logs.some(
            entry =>
                entry.level === 'error' && entry.args[2].includes('Primary dashboard and Bing flyout fallback failed')
        )
    )
})

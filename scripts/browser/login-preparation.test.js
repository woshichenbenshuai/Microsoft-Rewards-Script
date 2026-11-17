import assert from 'node:assert/strict'
import test from 'node:test'
import loginModule from '../../dist/browser/auth/Login.js'
import utilsModule from '../../dist/browser/BrowserUtils.js'
import asyncModule from '../../dist/util/Async.js'

const { Login } = loginModule
const BrowserUtils = utilsModule.default
const { OperationTimeoutError } = asyncModule

function fixture(route) {
    const calls = []
    const stop = new Error('Stop before authentication')
    const bot = {
        isMobile: true,
        logger: { info() {}, debug() {}, warn() {}, error() {} },
        utils: { wait: async () => calls.push('wait') },
        browser: { utils: null }
    }
    bot.browser.utils = new BrowserUtils(bot)
    bot.browser.utils.reloadBadPage = async () => {
        calls.push('readiness')
        throw stop
    }
    const page = {
        context: () => ({}),
        route: async (pattern, handler) => {
            calls.push('route')
            assert.equal(pattern, '**/GetCredentialType.srf*')
            return route(handler)
        },
        goto: async (_url, options) => {
            calls.push('navigate')
            assert.deepEqual(options, { waitUntil: 'domcontentloaded', timeout: 30000 })
        }
    }
    return { login: new Login(bot), page, calls, stop }
}

test('credential handler is registered before any sign-in navigation', async () => {
    const { login, page, calls, stop } = fixture(async () => {})
    await assert.rejects(login.login(page, {}), error => error === stop)
    assert.deepEqual(calls, ['route', 'navigate', 'wait', 'readiness'])
})

test('stalled route registration exits in 15 seconds and never navigates after late completion', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    let finishRoute
    const { login, page, calls } = fixture(
        () =>
            new Promise(resolve => {
                finishRoute = resolve
            })
    )
    const result = login.login(page, {})
    const rejected = assert.rejects(result, error => {
        assert.ok(error instanceof OperationTimeoutError)
        assert.match(error.message, /credential route registration.*15000ms/)
        return true
    })
    t.mock.timers.tick(15000)
    await rejected
    finishRoute()
    await Promise.resolve()
    assert.deepEqual(calls, ['route'])
})

test('failed route registration is propagated before starting authentication', async () => {
    const failure = new Error('Browser connection closed')
    const { login, page, calls } = fixture(async () => {
        throw failure
    })
    await assert.rejects(login.login(page, {}), error => error === failure)
    assert.deepEqual(calls, ['route'])
})

test('browser navigation RPC is bounded even if its own timeout never fires', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const { login, page, calls } = fixture(async () => {})
    page.goto = async () => {
        calls.push('navigate')
        return new Promise(() => {})
    }
    const result = login.login(page, {})
    const rejected = assert.rejects(result, /sign-in page navigation timed out after 35000ms/)
    for (let i = 0; i < 10; i++) await Promise.resolve()
    t.mock.timers.tick(35000)
    await rejected
    assert.deepEqual(calls, ['route', 'navigate'])
})

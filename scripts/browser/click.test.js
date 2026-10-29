import assert from 'node:assert/strict'
import test from 'node:test'
import utilsModule from '../../dist/browser/BrowserUtils.js'
const BrowserUtils = utilsModule.default

function fixture(click) {
    const calls = []
    const utils = new BrowserUtils({ isMobile: false, logger: { debug() {}, warn() {} } })
    const page = {
        waitForSelector: async (selector, options) => calls.push({ selector, options }),
        locator: selector => ({ first: () => ({ click: options => click(selector, options) }) }),
        // The production cursor failure would never resolve; do not enter this API.
        viewportSize: () => {
            throw new Error('Unbounded cursor lookup entered')
        }
    }
    return { utils, page, calls }
}

test('click action has its own deadline and preserves triple click and button options', async () => {
    const { utils, page, calls } = fixture(async (selector, options) => {
        assert.equal(selector, '#search')
        assert.deepEqual(options, { timeout: 10000, clickCount: 3, button: 'right', delay: 50 })
    })
    assert.equal(await utils.ghostClick(page, '#search', { clickCount: 3, button: 'right', waitForClick: 50 }), true)
    assert.deepEqual(calls, [{ selector: '#search', options: { state: 'visible', timeout: 1000 } }])
})

test('a visible but obstructed target returns failure when the action deadline expires', async () => {
    const { utils, page } = fixture(async () => {
        throw new Error('Timeout 10000ms exceeded: overlay intercepts pointer events')
    })
    assert.equal(await utils.ghostClick(page, '#covered'), false)
})

test('an element removed after visibility detection returns failure without a cursor retry', async () => {
    const { utils, page } = fixture(async () => {
        throw new Error('Element is not attached to the DOM')
    })
    assert.equal(await utils.ghostClick(page, '#removed'), false)
})

test('multiple selector matches use the first target and default primary click', async () => {
    const { utils, page } = fixture(async (_selector, options) => {
        assert.deepEqual(options, { timeout: 10000, clickCount: 1, button: 'left', delay: 0 })
    })
    assert.equal(await utils.ghostClick(page, 'button'), true)
})

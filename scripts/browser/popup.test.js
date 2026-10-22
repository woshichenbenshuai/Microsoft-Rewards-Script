import assert from 'node:assert/strict'
import test from 'node:test'
import utilsModule from '../../dist/browser/BrowserUtils.js'

const BrowserUtils = utilsModule.default

function fixture(visible = [], overlay = false) {
    const probes = []
    const clicks = []
    const logs = []
    const utils = new BrowserUtils({
        isMobile: false,
        logger: { debug: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
        utils: { wait: async () => {} }
    })
    const page = {
        locator: selector => ({
            // Match the production incident: the old API would never return.
            isVisible: () => new Promise(() => {}),
            waitFor: async options => {
                probes.push({ selector, ...options })
                assert.equal(options.timeout, 1000)
                if (selector === '#bnp_overlay_wrapper') {
                    assert.equal(options.state, 'attached')
                    if (overlay) return
                } else {
                    assert.equal(options.state, 'visible')
                    if (visible.includes(selector)) return
                }
                throw new Error('TimeoutError')
            }
        })
    }
    utils.ghostClick = async (_page, selector) => {
        clicks.push(selector)
        return true
    }
    return { utils, page, probes, clicks, logs }
}

test('missing optional banners finish even when isVisible would never return', { timeout: 2000 }, async () => {
    const { utils, page, probes, clicks } = fixture()
    await utils.tryDismissAllMessages(page)
    assert.equal(probes.length, 14)
    assert.deepEqual(clicks, [])
})

test('dismisses visible banners sequentially when the first click removes another', async () => {
    const { utils, page } = fixture(['#acceptButton', '#iNext'])
    let clicking = false
    const results = []
    let nextExists = true
    utils.ghostClick = async (_page, selector) => {
        assert.equal(clicking, false, 'popup clicks must not overlap')
        clicking = true
        await new Promise(resolve => setImmediate(resolve))
        const clicked = selector !== '#iNext' || nextExists
        if (selector === '#acceptButton') nextExists = false
        results.push({ selector, clicked })
        clicking = false
        return clicked
    }
    await utils.tryDismissAllMessages(page)
    assert.deepEqual(results, [
        { selector: '#acceptButton', clicked: true },
        { selector: '#iNext', clicked: false }
    ])
})

test('overlay uses a bounded lookup and falls back to accept if reject is unavailable', async () => {
    const { utils, page, probes } = fixture([], true)
    const clicks = []
    utils.ghostClick = async (_page, selector) => {
        clicks.push(selector)
        return selector === '#bnp_btn_accept'
    }
    await utils.tryDismissAllMessages(page)
    assert.equal(probes.at(-1).state, 'attached')
    assert.deepEqual(clicks, ['#bnp_btn_reject, button[aria-label*="Reject" i]', '#bnp_btn_accept'])
})

test('a disappearing target stops before entering the cursor element lookup', async () => {
    const { utils } = fixture()
    let cursorAccessed = false
    const page = {
        waitForSelector: async (_selector, options) => {
            assert.deepEqual(options, { state: 'visible', timeout: 1000 })
            throw new Error('Target removed')
        },
        viewportSize: () => {
            cursorAccessed = true
            throw new Error('cursor must not be created')
        }
    }
    assert.equal(await BrowserUtils.prototype.ghostClick.call(utils, page, '#removed'), false)
    assert.equal(cursorAccessed, false)
})

test('a closed page does not prevent popup cleanup from returning', async () => {
    const { utils, page, clicks } = fixture()
    page.locator = () => ({
        waitFor: async () => {
            throw new Error('Target page has been closed')
        }
    })
    await utils.tryDismissAllMessages(page)
    assert.deepEqual(clicks, [])
})

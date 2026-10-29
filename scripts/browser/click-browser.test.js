/* global window, document */
import assert from 'node:assert/strict'
import test from 'node:test'
import { chromium } from 'patchright'
import utilsModule from '../../dist/browser/BrowserUtils.js'
const BrowserUtils = utilsModule.default

test(
    'real browser clicks, selects text, and cancels an obstructed click without a late action',
    { timeout: 30000 },
    async () => {
        const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
        try {
            const page = await browser.newPage()
            const utils = new BrowserUtils({ isMobile: false, logger: { debug() {}, warn() {} } })
            await page.setContent(
                '<input id="search" value="original query"><button onclick="window.clicked=(window.clicked||0)+1">First</button><button onclick="window.clicked=100">Second</button>'
            )
            assert.equal(await utils.ghostClick(page, '#search', { clickCount: 3 }), true)
            const selected = await page.locator('#search').evaluate(el => el.selectionEnd - el.selectionStart)
            assert.equal(selected, 'original query'.length)
            assert.equal(await utils.ghostClick(page, 'button'), true)
            assert.equal(await page.evaluate(() => window.clicked), 1)
            await page.evaluate(() => {
                const overlay = document.createElement('div')
                overlay.id = 'overlay'
                overlay.style.cssText = 'position:fixed;inset:0;background:white;z-index:99999'
                document.body.append(overlay)
            })
            const started = Date.now()
            assert.equal(await utils.ghostClick(page, 'button'), false)
            assert.ok(Date.now() - started >= 9000)
            assert.ok(Date.now() - started < 15000)
            await page.locator('#overlay').evaluate(el => el.remove())
            await page.waitForTimeout(1000)
            assert.equal(
                await page.evaluate(() => window.clicked),
                1,
                'timed-out click must not fire after the overlay disappears'
            )
            assert.equal(await utils.ghostClick(page, 'button'), true)
            assert.equal(await page.evaluate(() => window.clicked), 2)
            await page.locator('#search').evaluate(el => el.remove())
            assert.equal(await utils.ghostClick(page, '#search'), false)
        } finally {
            await browser.close()
        }
    }
)

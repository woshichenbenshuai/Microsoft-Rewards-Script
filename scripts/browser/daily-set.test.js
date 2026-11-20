import assert from 'node:assert/strict'
import test from 'node:test'
import pageParser from '../../dist/browser/BingFlyoutPage.js'
import flyoutActivity from '../../dist/functions/activities/rewards/FlyoutDailySet.js'
import dailySetActivity from '../../dist/functions/activities/rewards/DailySet.js'

const { extractFlyoutViewModel, findDailySetCard } = pageParser
const { FlyoutDailySet } = flyoutActivity
const { DailySet } = dailySetActivity
const today = '11/20/2026'
const id = 'Gamification_DailySet_ZHCN_20261120_Child1'
const promotion = {
    offerId: id,
    title: 'Daily topic',
    description: 'Learn about this topic',
    destinationUrl: 'https://www.bing.com/search?q=topic&FORM=old',
    promotionType: 'urlreward',
    pointProgressMax: 10,
    pointProgress: 0,
    complete: false,
    isHidden: false
}
const card = {
    index: 0,
    href: `https://www.bing.com/search?q=topic&filters=${encodeURIComponent(`BTDSUOID:"${id}"`)}`,
    offerIds: [],
    title: promotion.title,
    description: promotion.description,
    visible: true,
    disabled: false
}

test('reads the rendered flyout model without evaluating scripts or truncating quoted braces', () => {
    const model = { isError: false, text: 'quoted " value } { \\', nested: { value: 1 } }
    assert.deepEqual(
        extractFlyoutViewModel(`<script>window.flyoutViewModel = ${JSON.stringify(model)};</script>`),
        model
    )
    for (const source of ['', 'window.flyoutViewModel = bad()', 'window.flyoutViewModel = {"nested":{}']) {
        assert.throws(() => extractFlyoutViewModel(source), /Bing flyout view model/)
    }
})

test('matches the exact daily offer in encoded URLs and accepts the regional Bing host', () => {
    const encoded = { ...card, href: card.href.replace('www.bing.com', 'cn.bing.com') }
    assert.equal(findDailySetCard([encoded], promotion), encoded)
    assert.equal(findDailySetCard([{ ...card, href: card.href.replace(id, `${id}0`) }], promotion), null)
})

test('matches cards without IDs by unique destination or title and description', () => {
    const byUrl = {
        ...card,
        href: 'https://cn.bing.com/search?rnoreward=1&FORM=new&q=topic',
        title: '',
        description: ''
    }
    assert.equal(findDailySetCard([byUrl], promotion), byUrl)
    const byText = { ...card, href: 'https://www.bing.com/search?q=another-topic' }
    assert.equal(findDailySetCard([byText], promotion), byText)
    assert.equal(findDailySetCard([byText, { ...byText, index: 1 }], promotion), null)
    assert.equal(findDailySetCard([{ ...byText, offerIds: ['another-offer'] }], promotion), null)
})

test('refuses hidden, locked, ambiguous and non-Bing controls even with a matching ID', () => {
    for (const invalid of [
        { ...card, visible: false },
        { ...card, disabled: true },
        { ...card, href: card.href.replace('www.bing.com', 'bing.com.example.com') },
        { ...card, href: card.href.replace('https:', 'http:') },
        { ...card, href: `javascript:void(0)?${id}` }
    ]) {
        assert.equal(findDailySetCard([invalid], promotion), null)
    }
    assert.equal(findDailySetCard([card, { ...card, index: 1 }], promotion), null)
})

function fixture(options = {}) {
    const counts = { clicks: 0, legacy: 0, opened: 0, closed: 0, verificationReads: 0 }
    const logs = []
    const logger = Object.fromEntries(
        ['info', 'warn', 'error', 'debug'].map(level => [level, (...args) => logs.push({ level, args })])
    )
    const model = {
        userInfo: { isRewardsUser: true, balance: 100, profile: { attributes: {} } },
        flyoutResult: {
            userStatus: { isRewardsUser: true, availablePoints: 100, counters: {} },
            dailySetPromotions: { [options.modelDate ?? today]: [{ ...promotion, ...options.offer }] }
        }
    }
    const context = {
        cookies: async () => [],
        newPage: async () => {
            counts.opened++
            if (options.creationFails) throw Error('Browser context unavailable')
            return page
        }
    }
    const source = { isClosed: () => options.sourceClosed === true, context: () => context }
    const controls = {
        first: () => ({ waitFor: async () => {} }),
        evaluateAll: async () => options.cards ?? [card],
        nth: () => ({
            click: async () => {
                counts.clicks++
                if (options.clickFails) throw Error('Click response lost')
            }
        })
    }
    const page = {
        on() {},
        off() {},
        goto: async () => {},
        content: async () => `window.flyoutViewModel = ${JSON.stringify(model)};`,
        locator: () => controls,
        close: async () => {
            counts.closed++
        }
    }
    const bot = {
        config: { activities: { urlReward: options.enabled !== false } },
        logger,
        isMobile: true,
        mainMobilePage: source,
        cookies: { mobile: [], desktop: [] },
        reactSnapshot: { offers: options.inEarn ? [{ offerId: id }] : [] },
        userData: { currentPoints: 100, gainedPoints: 0 },
        activities: {
            doUrlReward: async () => {
                counts.legacy++
            }
        },
        utils: { getFormattedDate: () => today, wait: async () => {}, randomDelay: () => 0 },
        browser: {
            func: {
                getDashboardData: async () => {
                    counts.verificationReads++
                    if (options.verificationFails) throw Error('Verification unavailable')
                    return {
                        dashboard: {
                            userStatus: { availablePoints: options.unconfirmed ? 100 : 110 },
                            dailySetPromotions: {
                                [today]: [
                                    {
                                        ...promotion,
                                        complete: !options.unconfirmed,
                                        pointProgress: options.unconfirmed ? 0 : 10
                                    }
                                ]
                            }
                        }
                    }
                }
            }
        }
    }
    return { bot, counts, logs }
}

test('credits the browser fallback only after reading the updated balance and completion', async () => {
    const { bot, counts, logs } = fixture()
    const handled = await new FlyoutDailySet(bot).run([promotion])
    assert.ok(handled.has(id))
    assert.equal(counts.clicks, 1)
    assert.equal(counts.verificationReads, 1)
    assert.equal(bot.userData.currentPoints, 110)
    assert.equal(bot.userData.gainedPoints, 10)
    assert.equal(counts.closed, 1)
    assert.ok(logs.some(l => l.args[2].includes('Daily Set verified')))
})

test('does not retry an uncertain browser submission through the legacy reporter', async () => {
    for (const failure of [{ clickFails: true }, { verificationFails: true }, { unconfirmed: true }]) {
        const { bot, counts } = fixture(failure)
        await new DailySet(bot).run({ dashboard: { dailySetPromotions: { [today]: [promotion] } } })
        assert.equal(counts.clicks, 1)
        assert.equal(counts.legacy, 0)
        assert.equal(bot.userData.gainedPoints, 0)
        assert.equal(counts.closed, 1)
    }
})

test('skips completed, hidden, locked, future and unavailable cards', async () => {
    for (const options of [
        { offer: { complete: true } },
        { offer: { pointProgress: 10 } },
        { offer: { isHidden: true } },
        { offer: { exclusiveLockedFeatureStatus: 'locked' } },
        { modelDate: '11/21/2026' },
        { cards: [] },
        { enabled: false }
    ]) {
        const { bot, counts } = fixture(options)
        await new FlyoutDailySet(bot).run([promotion])
        assert.equal(counts.clicks, 0)
        assert.equal(counts.verificationReads, 0)
        assert.equal(bot.userData.gainedPoints, 0)
    }
})

test('preserves the existing executor when the offer is in the Rewards snapshot', async () => {
    const { bot, counts } = fixture({ inEarn: true })
    await new DailySet(bot).run({ dashboard: { dailySetPromotions: { [today]: [promotion] } } })
    assert.equal(counts.opened, 0)
    assert.equal(counts.legacy, 1)
})

test('handles a closed browser or page creation failure without submitting an activity', async () => {
    for (const options of [{ sourceClosed: true }, { creationFails: true }]) {
        const { bot, counts } = fixture(options)
        const handled = await new FlyoutDailySet(bot).run([promotion])
        assert.equal(handled.size, 0)
        assert.equal(counts.clicks, 0)
        assert.equal(counts.verificationReads, 0)
    }
})

import assert from 'node:assert/strict'
import test from 'node:test'
import searchModule from '../../dist/functions/activities/search/BrowserSearch.js'
const Search = searchModule.Search

function fixture(clickResults = [true]) {
    const calls = []
    const bot = {
        logger: { warn() {} },
        config: {
            searchSettings: {
                scrollRandomResults: false,
                clickRandomResults: false,
                searchDelay: { min: '30sec', max: '1min' }
            }
        },
        utils: { wait: async () => {}, randomDelay: () => 0 },
        browser: {
            utils: {
                tryDismissAllMessages: async () => calls.push('dismiss'),
                ghostClick: async () => {
                    calls.push('click')
                    return clickResults.shift() ?? true
                }
            }
        }
    }
    const box = {
        waitFor: async options => {
            assert.equal(options.timeout, 15000)
            calls.push('visible')
        },
        scrollIntoViewIfNeeded: async options => {
            assert.equal(options.timeout, 10000)
            calls.push('scroll')
        },
        fill: async () => calls.push('fill')
    }
    const page = {
        evaluate: () => {
            throw Error('Unbounded page evaluation entered')
        },
        locator: () => box,
        goto: async (_url, options) => {
            assert.equal(options.timeout, 30000)
            calls.push('refresh')
        },
        waitForLoadState: async () => {},
        keyboard: {
            type: async () => calls.push('type'),
            press: async key => {
                assert.equal(key, 'Enter')
                calls.push('submit')
            }
        }
    }
    return { search: new Search(bot), page, calls }
}

test('the tenth search refreshes the page then uses bounded scroll and click before submitting', async () => {
    const { search, page, calls } = fixture()
    search.searchCount = 9
    await search.bingSearch(page, 'query', false)
    assert.deepEqual(calls, ['refresh', 'dismiss', 'visible', 'scroll', 'click', 'fill', 'type', 'submit'])
})

test('failed click retries before typing, with no duplicate submission', async () => {
    const { search, page, calls } = fixture([false, true])
    await search.bingSearch(page, 'query', false)
    assert.deepEqual(calls, ['visible', 'scroll', 'click', 'visible', 'scroll', 'click', 'fill', 'type', 'submit'])
})

test('five click failures exit without submitting or claiming a search', async () => {
    const { search, page, calls } = fixture([false, false, false, false, false])
    await assert.rejects(search.bingSearch(page, 'query', false), /Search input click failed/)
    assert.equal(calls.filter(v => v === 'click').length, 5)
    assert.ok(!calls.includes('fill') && !calls.includes('submit'))
})

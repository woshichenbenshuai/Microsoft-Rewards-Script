import type { BasePromotion } from '../interface/DashboardData'
import type { RewardsFlyoutData } from './FlyoutDashboard'
import { URLs } from '../constants/urls'

export interface DailySetCard {
    index: number
    href: string
    offerIds: string[]
    title: string
    description: string
    visible: boolean
    disabled: boolean
}

export function extractFlyoutViewModel(html: string): RewardsFlyoutData {
    const marker = /window\.flyoutViewModel\s*=\s*/.exec(html)
    if (!marker) throw new Error('Bing flyout view model is missing')
    const start = html.indexOf('{', marker.index + marker[0].length)
    if (start < 0) throw new Error('Bing flyout view model is missing')
    let depth = 0
    let quoted = false
    let escaped = false
    for (let i = start; i < html.length; i++) {
        const c = html[i]
        if (escaped) {
            escaped = false
            continue
        }
        if (quoted && c === '\\') {
            escaped = true
            continue
        }
        if (c === '"') {
            quoted = !quoted
            continue
        }
        if (quoted) continue
        if (c === '{') depth++
        if (c === '}' && --depth === 0) {
            let model: unknown
            try {
                model = JSON.parse(html.slice(start, i + 1))
            } catch {
                throw new Error('Bing flyout view model is invalid')
            }
            if (!model || typeof model !== 'object' || Array.isArray(model)) {
                throw new Error('Bing flyout view model is invalid')
            }
            return model as RewardsFlyoutData
        }
    }
    throw new Error('Bing flyout view model is incomplete')
}

function normalizeText(text: string): string {
    return text
        .replace(/[\u200b-\u200d\ufeff]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
}

function destination(raw: string): URL | null {
    try {
        const url = new URL(raw, URLs.bing.rewardsFlyoutPage)
        // This fallback opens Bing Daily Set links; other reward types keep their existing executor.
        if (url.protocol !== 'https:' || !['www.bing.com', 'cn.bing.com'].includes(url.hostname)) return null
        if (url.pathname !== '/search' && !url.pathname.startsWith('/spotlight/')) return null
        return url
    } catch {
        return null
    }
}

function offerIds(card: DailySetCard): string[] {
    let decoded = card.href
    for (let i = 0; i < 3; i++) {
        try {
            const next = decodeURIComponent(decoded)
            if (next === decoded) break
            decoded = next
        } catch {
            break
        }
    }
    return [...card.offerIds, ...(decoded.match(/Gamification_DailySet_[A-Za-z0-9_]+/g) ?? [])]
}

function destinationKey(raw: string): string | null {
    const url = destination(raw)
    if (!url) return null
    const ignored = new Set(['form', 'ocid', 'publ', 'crea', 'rnoreward'])
    const entries = [...url.searchParams.entries()]
        .filter(([key]) => !ignored.has(key.toLowerCase()))
        .sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv))
    return `${url.pathname}?${new URLSearchParams(entries)}`
}

export function findDailySetCard(
    cards: DailySetCard[],
    promotion: Pick<BasePromotion, 'offerId' | 'title' | 'description' | 'destinationUrl'>
): DailySetCard | null {
    const identified = cards.filter(card => offerIds(card).includes(promotion.offerId))
    const candidates = identified.length
        ? identified
        : cards.filter(card => {
              if (offerIds(card).length) return false
              const expected = destinationKey(promotion.destinationUrl)
              return (
                  (expected !== null && destinationKey(card.href) === expected) ||
                  (normalizeText(promotion.title).length > 0 &&
                      normalizeText(promotion.description).length > 0 &&
                      normalizeText(card.title) === normalizeText(promotion.title) &&
                      normalizeText(card.description) === normalizeText(promotion.description))
              )
          })
    const card = candidates.length === 1 ? candidates[0] : undefined
    return card && card.visible && !card.disabled && destination(card.href) ? card : null
}

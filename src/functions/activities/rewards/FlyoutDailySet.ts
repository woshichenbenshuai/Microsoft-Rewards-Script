import type { Page } from 'patchright'
import { BaseActivity } from '../BaseActivity'
import type { BasePromotion } from '../../../interface/DashboardData'
import { URLs } from '../../../constants/urls'
import { extractFlyoutViewModel, findDailySetCard, type DailySetCard } from '../../../browser/BingFlyoutPage'
import { mapFlyoutToDashboard } from '../../../browser/FlyoutDashboard'
import { withTimeout } from '../../../util/Async'

export class FlyoutDailySet extends BaseActivity {
    public async run(promotions: BasePromotion[]): Promise<Set<string>> {
        const handled = new Set<string>()
        if (!this.bot.config.activities.urlReward) return handled
        const source = this.bot.isMobile ? this.bot.mainMobilePage : this.bot.mainDesktopPage
        if (!source || source.isClosed()) return handled

        let page: Page
        try {
            page = await withTimeout(source.context().newPage(), 10000, 'Daily Set flyout page creation')
        } catch {
            this.bot.logger.warn(this.bot.isMobile, 'DAILY-SET-FLYOUT', 'Unable to open the Bing flyout')
            return handled
        }
        const popups = new Set<Page>()
        const onPopup = (popup: Page) => popups.add(popup)
        page.on('popup', onPopup)
        try {
            for (const promotion of promotions) {
                if (promotion.promotionType?.toLowerCase() !== 'urlreward') continue
                try {
                    await withTimeout(
                        page.goto(URLs.bing.rewardsFlyoutPage, { waitUntil: 'domcontentloaded', timeout: 20000 }),
                        25000,
                        'Daily Set flyout navigation'
                    )
                    const model = extractFlyoutViewModel(await page.content())
                    const data = mapFlyoutToDashboard(model).dashboard
                    if (data.userWarnings?.length || model.isUnsupportedCountry) {
                        this.bot.logger.warn(
                            this.bot.isMobile,
                            'DAILY-SET-FLYOUT',
                            'Rewards warning present; skipping flyout activities'
                        )
                        for (const item of promotions) handled.add(item.offerId)
                        break
                    }
                    const today = this.bot.utils.getFormattedDate()
                    const current = data.dailySetPromotions[today]?.find(item => item.offerId === promotion.offerId)
                    if (!current) continue
                    if (
                        current.complete ||
                        (current.pointProgressMax > 0 && current.pointProgress >= current.pointProgressMax) ||
                        current.isHidden ||
                        String(current.exclusiveLockedFeatureStatus) === 'locked' ||
                        current.pointProgressMax <= 0
                    ) {
                        handled.add(promotion.offerId)
                        continue
                    }

                    const controls = page.locator('#daily_set_card a[href]')
                    await controls.first().waitFor({ state: 'visible', timeout: 10000 })
                    const cards: DailySetCard[] = await controls.evaluateAll(elements =>
                        elements.map((element, index) => {
                            const heading = element.querySelector(
                                '.promo-title, .text-globalBody2Strong, .c-heading-3, h2, h3'
                            )
                            const description = element.querySelector('.promo-desc') ?? heading?.nextElementSibling
                            const parent = element.closest('.promo_cont') ?? element
                            const style = getComputedStyle(element)
                            const offerId =
                                element.closest('[data-offerid]')?.getAttribute('data-offerid') ??
                                element.closest('[data-offer-id]')?.getAttribute('data-offer-id')
                            return {
                                index,
                                href: element.getAttribute('href') ?? '',
                                offerIds: offerId ? [offerId] : [],
                                title: heading?.textContent ?? '',
                                description: description?.textContent ?? '',
                                visible:
                                    style.display !== 'none' &&
                                    style.visibility !== 'hidden' &&
                                    element.getClientRects().length > 0,
                                disabled:
                                    Boolean(element.closest('[aria-disabled="true"], [disabled], [inert]')) ||
                                    Boolean(
                                        parent.querySelector(
                                            '.locked_point, .locked_level_required_text, #locked_level_required_text'
                                        )
                                    )
                            }
                        })
                    )
                    const card = findDailySetCard(cards, current)
                    if (!card) {
                        this.bot.logger.warn(
                            this.bot.isMobile,
                            'DAILY-SET-FLYOUT',
                            `No unique enabled visible card | offerId=${current.offerId}`
                        )
                        continue
                    }

                    const before = data.userStatus.availablePoints
                    this.bot.userData.currentPoints = before
                    this.bot.logger.info(
                        this.bot.isMobile,
                        'DAILY-SET-FLYOUT',
                        `Opening visible Daily Set card | offerId=${current.offerId} | currentBalance=${before}`
                    )
                    // Once the browser may have submitted the activity, never retry it through the legacy API.
                    handled.add(current.offerId)
                    await withTimeout(
                        controls.nth(card.index).click({ timeout: 10000, noWaitAfter: true }),
                        15000,
                        'Daily Set flyout card click'
                    )
                    await this.bot.utils.wait(2000)
                    for (const popup of popups) await this.closePage(popup)
                    popups.clear()

                    let complete = false
                    let balance = before
                    for (let attempt = 0; attempt < 3; attempt++) {
                        if (attempt) await this.bot.utils.wait(2000)
                        const cookies = await source.context().cookies()
                        if (this.bot.isMobile) this.bot.cookies.mobile = cookies
                        else this.bot.cookies.desktop = cookies
                        const fresh = await withTimeout(
                            this.bot.browser.func.getDashboardData(),
                            25000,
                            'Daily Set completion verification'
                        )
                        balance = fresh.dashboard.userStatus.availablePoints
                        const offer = fresh.dashboard.dailySetPromotions[today]?.find(
                            item => item.offerId === current.offerId
                        )
                        complete = Boolean(
                            offer &&
                            (offer.complete ||
                                (offer.pointProgressMax > 0 && offer.pointProgress >= offer.pointProgressMax))
                        )
                        if (complete) break
                    }
                    const gained = balance - before
                    this.bot.userData.currentPoints = balance
                    if (gained > 0) this.bot.userData.gainedPoints = (this.bot.userData.gainedPoints ?? 0) + gained
                    const summary =
                        `Daily Set ${complete ? 'verified' : 'not confirmed'} | offerId=${current.offerId}` +
                        ` | pointsGained=${gained} | currentBalance=${balance}`
                    if (complete) this.bot.logger.info(this.bot.isMobile, 'DAILY-SET-FLYOUT', summary, 'green')
                    else this.bot.logger.warn(this.bot.isMobile, 'DAILY-SET-FLYOUT', summary)
                } catch (error) {
                    this.bot.logger.warn(
                        this.bot.isMobile,
                        'DAILY-SET-FLYOUT',
                        `Flyout activity unavailable | offerId=${promotion.offerId} | message=${
                            error instanceof Error ? error.message.split('\n')[0] : 'unknown error'
                        }`
                    )
                }
            }
        } finally {
            page.off('popup', onPopup)
            for (const popup of popups) await this.closePage(popup)
            await this.closePage(page)
        }
        return handled
    }

    private async closePage(page: Page): Promise<void> {
        await withTimeout(page.close(), 5000, 'Daily Set flyout cleanup').catch(() => undefined)
    }
}

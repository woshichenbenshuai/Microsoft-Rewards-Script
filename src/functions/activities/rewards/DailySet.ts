import { BaseActivity } from '../BaseActivity'
import type { DashboardData } from '../../../interface/DashboardData'
import { PromotionActivityRunner } from './PromotionActivityRunner'
import { FlyoutDailySet } from './FlyoutDailySet'

export class DailySet extends BaseActivity {
    public async run(data: DashboardData): Promise<void> {
        const today = this.bot.utils.getFormattedDate()
        const pending =
            data.dashboard.dailySetPromotions[today]?.filter(item => !item.complete && item.pointProgressMax > 0) ?? []

        if (!pending.length) {
            this.bot.logger.info(this.bot.isMobile, 'DAILY-SET', 'All "Daily Set" items have already been completed')
            return
        }

        this.bot.logger.info(
            this.bot.isMobile,
            'DAILY-SET',
            `Started solving "Daily Set" items | remaining=${pending.length}`
        )
        const absent = pending.filter(
            item => !this.bot.reactSnapshot?.offers.some(offer => offer.offerId === item.offerId)
        )
        const handled = absent.length ? await new FlyoutDailySet(this.bot).run(absent) : new Set<string>()
        await new PromotionActivityRunner(this.bot).run(pending.filter(item => !handled.has(item.offerId)))
        this.bot.logger.info(this.bot.isMobile, 'DAILY-SET', 'Finished processing "Daily Set" items')
    }
}

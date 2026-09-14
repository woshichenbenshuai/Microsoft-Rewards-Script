import { chromium } from 'patchright'

async function main(): Promise<void> {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
    try {
        const page = await browser.newPage()
        await page.goto('about:blank')
        if (await page.title()) throw new Error('Unexpected title returned for about:blank.')
        console.log('[browser-smoke] Chromium launched, opened about:blank, and is ready to close.')
    } finally {
        await browser.close()
    }
}

main().catch(error => {
    console.error(`[browser-smoke] Failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
})

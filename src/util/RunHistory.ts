import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { businessDate } from './SafetyState'

interface RunHistory {
    version: 1
    timeZone: string
    accounts: Record<string, { successfulDates: string[] }>
}

export interface SuccessDays {
    consecutiveSuccessfulDays: number
    totalSuccessfulDays: number
}

interface HistoryOptions {
    statePath?: string
    timeZone?: string
    now?: Date
    date?: string
}

export function resolveRunHistoryPath(): string {
    return process.env.RUN_HISTORY_FILE?.trim() || path.join(process.cwd(), 'config', 'run-history.json')
}

function validDate(value: unknown): value is string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
    const date = new Date(`${value}T00:00:00Z`)
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function previousDate(date: string): string {
    const value = new Date(`${date}T00:00:00Z`)
    value.setUTCDate(value.getUTCDate() - 1)
    return value.toISOString().slice(0, 10)
}

function resolved(options: HistoryOptions) {
    const timeZone = options.timeZone ?? process.env.TZ ?? 'Asia/Shanghai'
    const date = options.date ?? businessDate(options.now ?? new Date(), timeZone)
    if (!validDate(date)) throw new Error('Invalid run history date.')
    return { statePath: options.statePath ?? resolveRunHistoryPath(), timeZone, date }
}

async function readHistory(statePath: string, timeZone: string): Promise<RunHistory> {
    let raw: string
    try {
        raw = await fs.readFile(statePath, 'utf8')
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, timeZone, accounts: {} }
        throw error
    }
    let parsed: RunHistory
    try {
        parsed = JSON.parse(raw) as RunHistory
    } catch {
        throw new Error('Run history is invalid; existing statistics were not reset.')
    }
    if (
        !parsed ||
        parsed.version !== 1 ||
        parsed.timeZone !== timeZone ||
        !parsed.accounts ||
        Array.isArray(parsed.accounts) ||
        typeof parsed.accounts !== 'object'
    ) {
        throw new Error('Run history is invalid or has a different time zone; statistics were not reset.')
    }
    for (const account of Object.values(parsed.accounts)) {
        if (!account || !Array.isArray(account.successfulDates) || !account.successfulDates.every(validDate)) {
            throw new Error('Run history contains invalid success dates; statistics were not reset.')
        }
        account.successfulDates = [...new Set(account.successfulDates)].sort()
    }
    return parsed
}

async function writeHistory(statePath: string, history: RunHistory): Promise<void> {
    const temporary = `${statePath}.${randomUUID()}.tmp`
    try {
        const handle = await fs.open(temporary, 'wx', 0o600)
        try {
            await handle.writeFile(`${JSON.stringify(history, null, 2)}\n`)
            await handle.sync()
        } finally {
            await handle.close()
        }
        await fs.rename(temporary, statePath)
    } finally {
        await fs.unlink(temporary).catch(() => {})
    }
}

async function withHistoryLock<T>(statePath: string, operation: () => Promise<T>): Promise<T> {
    await fs.mkdir(path.dirname(statePath), { recursive: true, mode: 0o700 })
    const lockPath = `${statePath}.lock`
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined
    for (let attempt = 0; attempt < 100; attempt++) {
        try {
            handle = await fs.open(lockPath, 'wx', 0o600)
            break
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
            const stat = await fs.stat(lockPath).catch(() => null)
            if (stat && Date.now() - stat.mtimeMs > 30_000) await fs.unlink(lockPath).catch(() => {})
            await new Promise(resolve => setTimeout(resolve, 25))
        }
    }
    if (!handle) throw new Error('Could not acquire run history lock.')
    try {
        return await operation()
    } finally {
        await handle.close().catch(() => {})
        await fs.unlink(lockPath).catch(() => {})
    }
}

function counts(history: RunHistory, email: string, date: string): SuccessDays {
    const dates = new Set(history.accounts[email.trim().toLowerCase()]?.successfulDates ?? [])
    let consecutiveSuccessfulDays = 0
    for (let current = date; dates.has(current); current = previousDate(current)) consecutiveSuccessfulDays++
    return { consecutiveSuccessfulDays, totalSuccessfulDays: dates.size }
}

// Seed only the last confirmed successful day of an existing single-account deployment.
// Earlier history and newly added accounts are never inferred from the global safety state.
export async function initializeRunHistory(
    emails: string[],
    previousRun?: { date: string; status: string },
    options: HistoryOptions = {}
): Promise<void> {
    const { statePath, timeZone } = resolved(options)
    await withHistoryLock(statePath, async () => {
        if (
            await fs.stat(statePath).catch(error => {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
                throw error
            })
        ) {
            await readHistory(statePath, timeZone)
            return
        }
        const history: RunHistory = { version: 1, timeZone, accounts: {} }
        for (const email of emails) history.accounts[email.trim().toLowerCase()] = { successfulDates: [] }
        if (emails.length === 1 && previousRun?.status === 'success' && validDate(previousRun.date)) {
            history.accounts[emails[0]!.trim().toLowerCase()]!.successfulDates.push(previousRun.date)
        }
        await writeHistory(statePath, history)
    })
}

export async function recordAccountRunHistory(
    outcomes: Array<{ email: string; success: boolean }>,
    options: HistoryOptions = {}
): Promise<Record<string, SuccessDays>> {
    const { statePath, timeZone, date } = resolved(options)
    return withHistoryLock(statePath, async () => {
        const history = await readHistory(statePath, timeZone)
        for (const outcome of outcomes) {
            const key = outcome.email.trim().toLowerCase()
            const account = (history.accounts[key] ??= { successfulDates: [] })
            if (outcome.success && !account.successfulDates.includes(date)) account.successfulDates.push(date)
            account.successfulDates.sort()
        }
        await writeHistory(statePath, history)
        return Object.fromEntries(
            outcomes.map(outcome => [outcome.email.trim().toLowerCase(), counts(history, outcome.email, date)])
        )
    })
}

export async function getAccountSuccessDays(email: string, options: HistoryOptions = {}): Promise<SuccessDays> {
    const { statePath, timeZone, date } = resolved(options)
    return counts(await readHistory(statePath, timeZone), email, date)
}

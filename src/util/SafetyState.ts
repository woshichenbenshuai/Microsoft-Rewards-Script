import fs from 'node:fs/promises'
import path from 'node:path'

export type SafetySignalCode =
    | 'bot_warning'
    | 'unusual_activity'
    | 'account_locked'
    | 'captcha'
    | 'manual_verification'
    | 'consecutive_login_failures'

export interface SafetySignal {
    code: SafetySignalCode
    reason: string
}

interface RunRecord {
    date: string
    startedAt: string
    finishedAt?: string
    status: 'running' | 'success' | 'failed' | 'interrupted'
}

interface CircuitState {
    open: boolean
    openedAt?: string
    code?: SafetySignalCode
    reason?: string
}

interface LoginFailureState {
    consecutiveRunDays: number
    lastFailureDate?: string
}

export interface SafetyState {
    version: 1
    timeZone: string
    lastRun?: RunRecord
    circuit: CircuitState
    loginFailures: LoginFailureState
}

export interface SafetyStateOptions {
    statePath?: string
    timeZone?: string
    now?: Date
}

export interface RunDecision {
    allowed: boolean
    reason?: 'already_ran_today' | 'circuit_open'
    date: string
    state: SafetyState
}

export interface RunOutcomeInput extends SafetyStateOptions {
    status: 'success' | 'failed' | 'interrupted'
    immediateSignal?: SafetySignal
    hadLoginFailure?: boolean
    hadSuccessfulLogin?: boolean
}

export interface RunOutcomeResult {
    state: SafetyState
    circuitJustOpened: boolean
}

const DEFAULT_TIME_ZONE = 'Asia/Shanghai'
const LOGIN_FAILURE_THRESHOLD = 2
const LOCK_STALE_MS = 30_000
const LOCK_RETRY_COUNT = 100
const LOCK_RETRY_MS = 25

const safetyReasons: Record<SafetySignalCode, string> = {
    bot_warning: 'Microsoft 返回 Bot Warning',
    unusual_activity: 'Microsoft 显示异常活动警告',
    account_locked: 'Microsoft 账号已锁定或受限',
    captcha: 'Microsoft 要求完成 CAPTCHA 或反滥用验证',
    manual_verification: 'Microsoft 要求人工完成身份验证',
    consecutive_login_failures: '连续两个执行日登录失败'
}

export class SafetyTriggerError extends Error {
    readonly safetySignal: SafetySignal

    constructor(code: Exclude<SafetySignalCode, 'consecutive_login_failures'>, reason = safetyReasons[code]) {
        super(reason)
        this.name = 'SafetyTriggerError'
        this.safetySignal = { code, reason: safetyReasons[code] }
    }
}

function defaultState(timeZone: string): SafetyState {
    return {
        version: 1,
        timeZone,
        circuit: { open: false },
        loginFailures: { consecutiveRunDays: 0 }
    }
}

export function resolveSafetyStatePath(env: NodeJS.ProcessEnv = process.env): string {
    return env.SAFETY_STATE_FILE?.trim() || path.join(process.cwd(), 'config', 'safety-state.json')
}

export function businessDate(date: Date, timeZone = DEFAULT_TIME_ZONE): string {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date)
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
    return `${values.year}-${values.month}-${values.day}`
}

function parseState(raw: string, statePath: string): SafetyState {
    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        throw new Error(`Safety state is invalid at ${statePath}; refusing to run.`)
    }

    if (!parsed || typeof parsed !== 'object') {
        throw new Error(`Safety state is invalid at ${statePath}; refusing to run.`)
    }

    const state = parsed as Partial<SafetyState>
    if (
        state.version !== 1 ||
        !state.circuit ||
        typeof state.circuit.open !== 'boolean' ||
        !state.loginFailures ||
        !Number.isInteger(state.loginFailures.consecutiveRunDays) ||
        (state.loginFailures.consecutiveRunDays ?? -1) < 0
    ) {
        throw new Error(`Safety state is invalid at ${statePath}; refusing to run.`)
    }

    return state as SafetyState
}

async function readState(statePath: string, timeZone: string): Promise<SafetyState> {
    try {
        return parseState(await fs.readFile(statePath, 'utf8'), statePath)
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultState(timeZone)
        throw error
    }
}

async function writeState(statePath: string, state: SafetyState): Promise<void> {
    await fs.mkdir(path.dirname(statePath), { recursive: true, mode: 0o700 })
    await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
    await fs.chmod(statePath, 0o600).catch(() => {})
}

async function wait(milliseconds: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function withStateLock<T>(statePath: string, operation: () => Promise<T>): Promise<T> {
    await fs.mkdir(path.dirname(statePath), { recursive: true, mode: 0o700 })
    const lockPath = `${statePath}.lock`
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined

    for (let attempt = 0; attempt < LOCK_RETRY_COUNT; attempt++) {
        try {
            handle = await fs.open(lockPath, 'wx', 0o600)
            break
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error

            const stat = await fs.stat(lockPath).catch(() => null)
            if (stat && Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
                await fs.unlink(lockPath).catch(() => {})
                continue
            }
            await wait(LOCK_RETRY_MS)
        }
    }

    if (!handle) throw new Error(`Unable to acquire safety state lock at ${lockPath}`)

    try {
        await handle.writeFile(`${process.pid}\n`)
        return await operation()
    } finally {
        await handle.close().catch(() => {})
        await fs.unlink(lockPath).catch(() => {})
    }
}

function optionsWithDefaults(options: SafetyStateOptions): Required<Pick<SafetyStateOptions, 'timeZone' | 'now'>> & {
    statePath: string
} {
    return {
        statePath: options.statePath ?? resolveSafetyStatePath(),
        timeZone: options.timeZone ?? process.env.TZ ?? DEFAULT_TIME_ZONE,
        now: options.now ?? new Date()
    }
}

export async function getSafetyState(options: SafetyStateOptions = {}): Promise<SafetyState> {
    const resolved = optionsWithDefaults(options)
    return readState(resolved.statePath, resolved.timeZone)
}

export async function precheckDailyRun(options: SafetyStateOptions = {}): Promise<RunDecision> {
    const resolved = optionsWithDefaults(options)
    const state = await readState(resolved.statePath, resolved.timeZone)
    const date = businessDate(resolved.now, resolved.timeZone)

    if (state.circuit.open) return { allowed: false, reason: 'circuit_open', date, state }
    if (state.lastRun?.date === date) return { allowed: false, reason: 'already_ran_today', date, state }
    return { allowed: true, date, state }
}

export async function claimDailyRun(options: SafetyStateOptions = {}): Promise<RunDecision> {
    const resolved = optionsWithDefaults(options)
    return withStateLock(resolved.statePath, async () => {
        const state = await readState(resolved.statePath, resolved.timeZone)
        const date = businessDate(resolved.now, resolved.timeZone)

        if (state.circuit.open) return { allowed: false, reason: 'circuit_open', date, state }
        if (state.lastRun?.date === date) return { allowed: false, reason: 'already_ran_today', date, state }

        state.timeZone = resolved.timeZone
        state.lastRun = {
            date,
            startedAt: resolved.now.toISOString(),
            status: 'running'
        }
        await writeState(resolved.statePath, state)
        return { allowed: true, date, state }
    })
}

export async function recordRunOutcome(input: RunOutcomeInput): Promise<RunOutcomeResult> {
    const resolved = optionsWithDefaults(input)
    return withStateLock(resolved.statePath, async () => {
        const state = await readState(resolved.statePath, resolved.timeZone)
        const date =
            state.lastRun?.status === 'running' ? state.lastRun.date : businessDate(resolved.now, resolved.timeZone)
        const startedAt = state.lastRun?.date === date ? state.lastRun.startedAt : resolved.now.toISOString()
        let circuitJustOpened = false

        state.timeZone = resolved.timeZone
        state.lastRun = {
            date,
            startedAt,
            finishedAt: resolved.now.toISOString(),
            status: input.status
        }

        let signal = input.immediateSignal
        if (!signal && input.hadLoginFailure) {
            if (state.loginFailures.lastFailureDate !== date) {
                state.loginFailures.consecutiveRunDays += 1
                state.loginFailures.lastFailureDate = date
            }
            if (state.loginFailures.consecutiveRunDays >= LOGIN_FAILURE_THRESHOLD) {
                signal = {
                    code: 'consecutive_login_failures',
                    reason: safetyReasons.consecutive_login_failures
                }
            }
        } else if (!signal && input.hadSuccessfulLogin) {
            state.loginFailures = { consecutiveRunDays: 0 }
        }

        if (signal && !state.circuit.open) {
            state.circuit = {
                open: true,
                openedAt: resolved.now.toISOString(),
                code: signal.code,
                reason: safetyReasons[signal.code]
            }
            circuitJustOpened = true
        }

        await writeState(resolved.statePath, state)
        return { state, circuitJustOpened }
    })
}

export async function resetSafetyCircuit(options: SafetyStateOptions = {}): Promise<SafetyState> {
    const resolved = optionsWithDefaults(options)
    return withStateLock(resolved.statePath, async () => {
        const state = await readState(resolved.statePath, resolved.timeZone)
        state.circuit = { open: false }
        state.loginFailures = { consecutiveRunDays: 0 }
        await writeState(resolved.statePath, state)
        return state
    })
}

export function classifyImmediateSafetySignal(value: unknown): SafetySignal | undefined {
    if (value instanceof SafetyTriggerError) return value.safetySignal

    const message = value instanceof Error ? value.message : String(value ?? '')
    const normalized = message.toLowerCase()
    if (normalized.includes('fraud_userwarning_botscore_ux') || /\bbot[ -]?warning\b/.test(normalized)) {
        return { code: 'bot_warning', reason: safetyReasons.bot_warning }
    }
    if (/account.*(locked|suspended|restricted)|service abuse/.test(normalized)) {
        return { code: 'account_locked', reason: safetyReasons.account_locked }
    }
    if (/captcha|arkose|anti[- ]?abuse challenge/.test(normalized)) {
        return { code: 'captcha', reason: safetyReasons.captcha }
    }
    if (/manual (identity )?verification|requires?.*interactive|verify your identity/.test(normalized)) {
        return { code: 'manual_verification', reason: safetyReasons.manual_verification }
    }
    return undefined
}

export function isLoginFailureReason(value: string | undefined): boolean {
    if (!value) return false
    return /\b(login|sign[- ]?in|authentication|kmsi)\b/i.test(value)
}

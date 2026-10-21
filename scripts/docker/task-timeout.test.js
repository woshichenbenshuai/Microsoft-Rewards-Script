import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash'
const shellPath = value => value.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, drive) => '/' + drive.toLowerCase())

async function runFixture(mode, minutes = '120') {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rewards-deadline-'))
    try {
        const dir = shellPath(directory)
        await fs.mkdir(path.join(directory, 'bin'))
        const original = await fs.readFile(new URL('./run_daily.sh', import.meta.url), 'utf8')
        const script = original
            .replaceAll('/etc/container_env', dir + '/absent_env')
            .replace('cd /usr/src/microsoft-rewards-script', 'cd "' + dir + '"')
            .replace('LOCKFILE=/tmp/run_daily.lock', 'LOCKFILE="' + dir + '/run_daily.lock"')
        await fs.writeFile(path.join(directory, 'run.sh'), script)
        await fs.writeFile(
            path.join(directory, 'bin', 'node'),
            `#!/usr/bin/env bash
printf 'node %s\\n' "$*" >> "$TRACE"
case "$*" in
 *TaskTimeout*) [ "$FIXTURE_MODE" != alert-fails ] ;;
 *) exit 0 ;;
esac
`,
            { mode: 0o755 }
        )
        await fs.writeFile(
            path.join(directory, 'bin', 'npm'),
            `#!/usr/bin/env bash
printf 'npm started\\n' >> "$TRACE"
case "$FIXTURE_MODE" in
 normal) exit 0 ;;
 failure) exit 7 ;;
 term) sleep 2 ;;
 *) trap '' TERM; sleep 2; printf 'orphan survived\\n' >> "$TRACE" ;;
esac
`,
            { mode: 0o755 }
        )
        // Keep the real GNU timeout and process-group behavior; shorten only the deadline.
        await fs.writeFile(
            path.join(directory, 'bin', 'timeout'),
            `#!/usr/bin/env bash
printf 'timeout %s\\n' "$*" >> "$TRACE"
if [[ "$*" == *'npm start'* ]]; then
 exec "$REAL_TIMEOUT" --signal=TERM --kill-after=0.1s 0.1s npm start
fi
exec "$REAL_TIMEOUT" "$@"
`,
            { mode: 0o755 }
        )
        const result = spawnSync(
            bash,
            ['-c', `export REAL_TIMEOUT="$(command -v timeout)"; export PATH="${dir}/bin:$PATH"; bash "${dir}/run.sh"`],
            {
                encoding: 'utf8',
                timeout: 10000,
                env: {
                    ...process.env,
                    TRACE: dir + '/trace',
                    FIXTURE_MODE: mode,
                    MAX_RUN_MINUTES: minutes,
                    SKIP_RANDOM_SLEEP: 'true',
                    API_MODE: 'false'
                }
            }
        )
        assert.ifError(result.error)
        const trace = await fs.readFile(path.join(directory, 'trace'), 'utf8')
        // Wait longer than the fixture's child lifetime: the entire group must be gone.
        if (['hang', 'term', 'alert-fails'].includes(mode)) await new Promise(resolve => setTimeout(resolve, 2100))
        const finalTrace = await fs.readFile(path.join(directory, 'trace'), 'utf8')
        assert.doesNotMatch(finalTrace, /orphan survived/)
        assert.equal(await fs.stat(path.join(directory, 'run_daily.lock')).catch(() => null), null)
        return { ...result, trace: finalTrace || trace }
    } finally {
        await fs.rm(directory, { recursive: true, force: true })
    }
}

test('normal completion preserves success without sending a timeout alert', async () => {
    const result = await runFixture('normal')
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.trace, /timeout --signal=TERM --kill-after=30s 120m npm start/)
    assert.match(result.trace, /SafetyControl.js finish success/)
    assert.doesNotMatch(result.trace, /TaskTimeout/)
})

test('hung run kills its process group, sends one alert, finalizes failure and releases lock', async () => {
    const result = await runFixture('hang')
    assert.equal(result.status, 1, result.stderr)
    assert.equal(result.trace.match(/^node dist\/cli\/TaskTimeout.js 120$/gm)?.length, 1)
    assert.match(result.trace, /SafetyControl.js finish failed/)
    assert.doesNotMatch(result.trace, /finish success/)
})

test('alert failure still finalizes failed state and releases the daily lock', async () => {
    const result = await runFixture('alert-fails')
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Timeout alert or state finalization failed/)
    assert.match(result.trace, /SafetyControl.js finish failed/)
})

test('ordinary task failure does not masquerade as timeout or success', async () => {
    const result = await runFixture('failure')
    assert.equal(result.status, 1)
    assert.match(result.trace, /SafetyControl.js finish failed/)
    assert.doesNotMatch(result.trace, /TaskTimeout/)
})

test('invalid deadline refuses to start a Rewards task', async () => {
    const result = await runFixture('normal', '0')
    assert.equal(result.status, 1)
    assert.match(result.stderr, /MAX_RUN_MINUTES must be a positive integer/)
    assert.doesNotMatch(result.trace, /npm started/)
})

test('graceful TERM timeout also sends an alert and preserves a failed run', async () => {
    const result = await runFixture('term')
    assert.equal(result.status, 1)
    assert.match(result.trace, /^node dist\/cli\/TaskTimeout.js 120$/m)
    assert.match(result.trace, /SafetyControl.js finish failed/)
})

test('timeout CLI finalizes hung state, preserves terminal outcomes and never changes history', async () => {
    for (const status of ['running', 'interrupted', 'success']) {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rewards-timeout-cli-'))
        try {
            await fs.mkdir(path.join(directory, 'config'))
            await fs.writeFile(path.join(directory, 'package.json'), '{}')
            await fs.copyFile(
                new URL('../../config.example.json', import.meta.url),
                path.join(directory, 'config.json')
            )
            const statePath = path.join(directory, 'config', 'safety-state.json')
            const historyPath = path.join(directory, 'config', 'run-history.json')
            const state = {
                version: 1,
                timeZone: 'Asia/Shanghai',
                circuit: { open: false },
                loginFailures: { consecutiveRunDays: 0 },
                lastRun: { date: '2026-10-20', startedAt: '2026-10-19T23:20:00Z', status }
            }
            const history = JSON.stringify({
                version: 1,
                timeZone: 'Asia/Shanghai',
                accounts: { 'user@example.com': { successfulDates: ['2026-10-19'] } }
            })
            await fs.writeFile(statePath, JSON.stringify(state))
            await fs.writeFile(historyPath, history)
            const result = spawnSync(
                process.execPath,
                [fileURLToPath(new URL('../../dist/cli/TaskTimeout.js', import.meta.url)), '120'],
                {
                    cwd: directory,
                    encoding: 'utf8',
                    timeout: 10000,
                    env: {
                        ...process.env,
                        SAFETY_STATE_FILE: statePath,
                        CONFIG_TELEGRAM_ENABLED: 'false',
                        TZ: 'Asia/Shanghai'
                    }
                }
            )
            assert.ifError(result.error)
            assert.equal(result.status, 0, result.stdout + result.stderr)
            const finalState = JSON.parse(await fs.readFile(statePath, 'utf8'))
            assert.equal(finalState.lastRun.status, status === 'running' ? 'failed' : status)
            assert.equal(finalState.lastRun.date, state.lastRun.date)
            assert.equal(finalState.lastRun.startedAt, state.lastRun.startedAt)
            assert.equal(finalState.circuit.open, false)
            assert.equal(await fs.readFile(historyPath, 'utf8'), history)
        } finally {
            await fs.rm(directory, { recursive: true, force: true })
        }
    }
})

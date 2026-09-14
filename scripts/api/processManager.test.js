import assert from 'node:assert/strict'
import test from 'node:test'

import { ProcessManager } from './processManager.js'

test('rejects per-run child-process argument overrides', () => {
    const manager = new ProcessManager({
        command: process.execPath,
        args: ['/trusted/application.js'],
        cwd: process.cwd()
    })

    assert.throws(
        () => manager.start({ args: ['-e', 'process.exit(0)'] }),
        error => error?.code === 'BAD_REQUEST' && /not supported/i.test(error.message)
    )
    assert.equal(manager.getStatus().state, 'idle')
})

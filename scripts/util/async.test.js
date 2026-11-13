import assert from 'node:assert/strict'
import test from 'node:test'
import asyncModule from '../../dist/util/Async.js'

const { OperationTimeoutError, withTimeout } = asyncModule

test('withTimeout resolves a completed operation', async () => {
    assert.equal(await withTimeout(Promise.resolve('ok'), 50, 'test operation'), 'ok')
})

test('withTimeout rejects a stalled operation and observes its late rejection', async () => {
    let rejectOperation
    const stalled = new Promise((_, reject) => {
        rejectOperation = reject
    })

    await assert.rejects(withTimeout(stalled, 10, 'stalled operation'), error => {
        assert.ok(error instanceof OperationTimeoutError)
        assert.match(error.message, /stalled operation timed out after 10ms/)
        return true
    })

    rejectOperation(new Error('late browser RPC failure'))
    await new Promise(resolve => setImmediate(resolve))
})

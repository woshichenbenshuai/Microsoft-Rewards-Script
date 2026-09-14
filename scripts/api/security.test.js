import assert from 'node:assert/strict'
import test from 'node:test'

import { MIN_API_TOKEN_LENGTH, isLoopbackHost, validateApiExposure } from './security.js'

test('recognizes loopback API hosts', () => {
    for (const host of ['localhost', '127.0.0.1', '127.20.30.40', '::1']) {
        assert.equal(isLoopbackHost(host), true, host)
    }

    for (const host of ['0.0.0.0', '192.168.1.10', '10.0.0.5', 'example.com']) {
        assert.equal(isLoopbackHost(host), false, host)
    }
})

test('allows an unauthenticated API only on loopback', () => {
    assert.deepEqual(validateApiExposure('127.0.0.1', undefined), { ok: true })
    assert.equal(validateApiExposure('0.0.0.0', undefined).ok, false)
})

test('requires a sufficiently long API token', () => {
    assert.equal(validateApiExposure('127.0.0.1', 'short-token').ok, false)
    assert.equal(validateApiExposure('0.0.0.0', 'short-token').ok, false)
    assert.deepEqual(validateApiExposure('0.0.0.0', 'a'.repeat(MIN_API_TOKEN_LENGTH)), { ok: true })
})

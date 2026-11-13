export class OperationTimeoutError extends Error {
    constructor(label: string, timeoutMs: number) {
        super(`${label} timed out after ${timeoutMs}ms`)
        this.name = 'OperationTimeoutError'
    }
}

/** Bounds browser and network calls whose underlying RPC may never settle. */
export function withTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new OperationTimeoutError(label, timeoutMs)), timeoutMs)

        operation.then(
            value => {
                clearTimeout(timer)
                resolve(value)
            },
            error => {
                clearTimeout(timer)
                reject(error)
            }
        )
    })
}

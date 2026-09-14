export interface AccountBalanceState {
    balanceKnown: boolean
    initialPoints: number
    currentPoints: number
}

export interface AccountBalanceSnapshot {
    balanceKnown: boolean
    initialPoints: number
    finalPoints: number
    collectedPoints: number
}

export function snapshotAccountBalance(state: AccountBalanceState): AccountBalanceSnapshot {
    if (!state.balanceKnown || !Number.isFinite(state.initialPoints) || !Number.isFinite(state.currentPoints)) {
        return {
            balanceKnown: false,
            initialPoints: 0,
            finalPoints: 0,
            collectedPoints: 0
        }
    }

    return {
        balanceKnown: true,
        initialPoints: state.initialPoints,
        finalPoints: state.currentPoints,
        collectedPoints: state.currentPoints - state.initialPoints
    }
}

export function totalKnownFinalBalance(
    stats: Array<Pick<AccountBalanceSnapshot, 'balanceKnown' | 'finalPoints'>>
): number | null {
    const knownStats = stats.filter(stat => stat.balanceKnown && Number.isFinite(stat.finalPoints))
    if (!knownStats.length) return null
    return knownStats.reduce((sum, stat) => sum + stat.finalPoints, 0)
}

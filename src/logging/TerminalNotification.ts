export class TerminalNotificationGate {
    private claimed = false

    claim(): boolean {
        if (this.claimed) return false
        this.claimed = true
        return true
    }
}

/**
 * Print / Save-as-PDF for a task report.
 *
 * Read-only by design: it prints the already-fetched detail snapshot via
 * `window.print()`, so there is no server endpoint, no new dependency, no
 * write token, and no adminOnly gate. Vendors may print what they may read;
 * a locked task never reaches this button because the caller renders it
 * only when `detail` is available and the agent is not locked.
 */
export function TaskPrintButton({ title }: { title?: string }) {
  const print = () => {
    if (typeof window !== 'undefined' && typeof window.print === 'function') window.print()
  }
  return <div className="task-print-bar no-print">
    <button
      type="button"
      className="refresh-button"
      onClick={print}
      aria-label={title ? `Cetak laporan ${title} / simpan sebagai PDF` : 'Cetak laporan / simpan sebagai PDF'}
    >
      Cetak / PDF
    </button>
    <span className="muted small-note">Buka dialog cetak browser, lalu pilih Save as PDF untuk mengunduh.</span>
  </div>
}

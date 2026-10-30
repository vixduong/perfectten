/** 8.5 -> "8,5" */
export function num(n: number | string, digits = 2): string {
  const v = typeof n === 'string' ? Number(n) : n
  return String(Math.round(v * 10 ** digits) / 10 ** digits).replace('.', ',')
}

const pad = (n: number) => String(n).padStart(2, '0')

/** ISO -> "07:30, 04/11/2026" theo giờ máy người xem. */
export function stamp(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}

/** ISO -> giá trị cho <input type="datetime-local"> (giờ địa phương). */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Giá trị datetime-local (giờ địa phương) -> ISO, chuỗi rỗng -> null. */
export function fromLocalInput(v: string): string | null {
  return v ? new Date(v).toISOString() : null
}

/** Số giây -> "mm:ss" */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`
}

/** Số giây -> "21 phút 40 giây" */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const m = Math.floor(s / 60)
  return m ? `${m} phút ${s % 60} giây` : `${s} giây`
}

export const LETTERS = 'ABCDEF'

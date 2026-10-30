import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanName, clock, duration, fromLocalInput, num, profileFigures, submittedOldestFirst, toLocalInput } from './format.ts'

test('num dùng dấu phẩy và làm tròn', () => {
  assert.equal(num(8.5), '8,5')
  assert.equal(num('3.333'), '3,33')
  assert.equal(num(10), '10')
})

test('datetime-local đi một vòng không lệch giờ', () => {
  assert.equal(toLocalInput(fromLocalInput('2026-11-04T07:30')), '2026-11-04T07:30')
  assert.equal(fromLocalInput(''), null)
  assert.equal(toLocalInput(null), '')
})

test('đồng hồ', () => {
  assert.equal(clock(1100), '18:20')
  assert.equal(clock(-5), '00:00')
  assert.equal(duration(1300), '21 phút 40 giây')
})

test('tên được gọn khoảng trắng', () => {
  assert.equal(cleanName('  Nguyễn   An '), 'Nguyễn An')
  assert.equal(cleanName('   '), '')
})

test('số liệu hồ sơ: rỗng, một bài, tiến bộ và thụt lùi', () => {
  const a = (t: string, score: number | null, done = true) => ({ submitted_at: done ? t : null, score })
  assert.deepEqual(profileFigures([]), { taken: '0', latest: '—', progress: '—' })
  assert.deepEqual(profileFigures([a('2026-01-01', 7)]), { taken: '1', latest: '7', progress: '—' })
  // thứ tự đầu vào không quan trọng, bài chưa nộp bị bỏ qua
  const rows = [a('2026-01-03', 8.5), a('2026-01-01', 7), a('2026-01-02', 9), a('2026-01-04', 0, false)]
  assert.deepEqual(profileFigures(rows), { taken: '3', latest: '8,5', progress: '−0,5' })
  assert.equal(profileFigures([a('2026-01-01', 6), a('2026-01-02', 7.5)]).progress, '+1,5')
  assert.equal(profileFigures([a('2026-01-01', 6), a('2026-01-02', 6)]).progress, '0')
  assert.deepEqual(submittedOldestFirst(rows).map((r) => r.score), [7, 9, 8.5])
})

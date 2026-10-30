import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clock, duration, fromLocalInput, num, toLocalInput } from './format.ts'

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

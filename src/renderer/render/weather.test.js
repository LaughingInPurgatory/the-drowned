import test from 'node:test'
import assert from 'node:assert/strict'
import { rainRenderSize } from './weather.js'

test('rain shades one quarter of the full-resolution pixel area', () => {
  const [width, height] = rainRenderSize(3200, 1800)
  assert.deepEqual([width, height], [1600, 900])
  assert.equal(width * height, (3200 * 1800) / 4)
})

test('rain render target never collapses below one pixel', () => {
  assert.deepEqual(rainRenderSize(1, 1), [1, 1])
})

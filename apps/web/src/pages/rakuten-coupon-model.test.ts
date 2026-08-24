import assert from 'node:assert/strict'
import test from 'node:test'
import { buildFiveZeroCouponPlan, buildRakutenCouponPayload, EMPTY_RAKUTEN_COUPON_FORM, fiveZeroOccurrences, updateModeForCoupon, validateRakutenCouponForm, type RakutenCouponPlan } from './rakuten-coupon-model.js'

const validForm = { ...EMPTY_RAKUTEN_COUPON_FORM, internalName: 'September coupon', couponName: '秋のお買い物10%OFF', couponCaption: '全品10%割引', couponStartDate: '2026-09-01T00:00', couponEndDate: '2026-09-30T23:59' }

test('builds exact Rakuten CouponToIssue field names', () => {
  const payload = buildRakutenCouponPayload(validForm)
  assert.equal(payload.issueCount, 100)
  assert.equal(payload.memberAvailMaxCount, 1)
  assert.equal(payload.couponStartDate, '2026-09-01T00:00:00+09:00')
  assert.equal('couponIssueCount' in payload, false)
  assert.equal('memberMaxCount' in payload, false)
})

test('maps otherConditions and item URLs', () => {
  const payload = buildRakutenCouponPayload({ ...validForm, itemType: 3, itemUrls: 'https://item.rakuten.co.jp/homebliss/a/\nhttps://item.rakuten.co.jp/homebliss/b/', minimumSpend: '3000', minimumQuantity: '2', deviceCondition: '1' })
  assert.equal(payload.items?.length, 2)
  assert.deepEqual(payload.otherConditions, [
    { conditionTypeCode: 'RS001', startValue: '1' },
    { conditionTypeCode: 'RS003', startValue: '3000' },
    { conditionTypeCode: 'RS004', startValue: '2' },
  ])
})

test('keeps free shipping itemType and discountType aligned', () => {
  assert.match(validateRakutenCouponForm({ ...validForm, itemType: 5, discountType: 2 }).join(' '), /must be used together/)
  const payload = buildRakutenCouponPayload({ ...validForm, itemType: 5, discountType: 4 })
  assert.equal(payload.discountFactor, 1)
})

test('switches to display-only patch at start minus 60 minutes', () => {
  const plan: RakutenCouponPlan = { id: 'one', status: 'published', internalName: validForm.internalName, shopCode: validForm.shopCode, coupon: buildRakutenCouponPayload(validForm), notes: '', createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z' }
  assert.equal(updateModeForCoupon(plan, new Date('2026-08-31T13:59:59Z')), 'coupon.update')
  assert.equal(updateModeForCoupon(plan, new Date('2026-08-31T14:00:00Z')), 'coupon.patch')
})

test('generates valid 5と0 occurrences without nonexistent calendar dates', () => {
  assert.deepEqual(fiveZeroOccurrences(2026, 8).map(occurrence => occurrence.date), [
    '2026-08-05', '2026-08-10', '2026-08-15', '2026-08-20', '2026-08-25', '2026-08-30',
  ])
  assert.deepEqual(fiveZeroOccurrences(2027, 2).map(occurrence => occurrence.date), [
    '2027-02-05', '2027-02-10', '2027-02-15', '2027-02-20', '2027-02-25',
  ])
})

test('builds an idempotent hidden review payload for the August 25 occurrence', () => {
  const generatedAt = '2026-08-24T00:00:00.000Z'
  const first = buildFiveZeroCouponPlan('2026-08-25', 'publish_review', generatedAt)
  const second = buildFiveZeroCouponPlan('2026-08-25', 'publish_review', generatedAt)
  assert.deepEqual(first, second)
  assert.equal(first.id, 'homebliss:rakuten_5_and_0_day:2026-08-25:five_zero_storewide_percent:v1')
  assert.equal(first.status, 'publish_review')
  assert.equal(first.coupon.discountFactor, 5)
  assert.equal(first.coupon.displayFlag, 0)
  assert.equal(first.calendarGeneration?.requiresOperatorApproval, true)
  assert.deepEqual(validateRakutenCouponForm({ ...validForm, ...{
    internalName: first.internalName,
    couponName: first.coupon.couponName,
    couponCaption: first.coupon.couponCaption,
    couponStartDate: '2026-08-25T00:00:00',
    couponEndDate: '2026-08-25T23:59:59',
    issueCount: String(first.coupon.issueCount),
    discountFactor: String(first.coupon.discountFactor),
    displayFlag: first.coupon.displayFlag,
  } }), [])
})

test('rejects a non-5と0 date', () => {
  assert.throws(() => buildFiveZeroCouponPlan('2026-08-24'), /valid 5と0/)
})

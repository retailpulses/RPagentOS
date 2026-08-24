import assert from 'node:assert/strict'
import test from 'node:test'
import { buildRakutenCouponPayload, EMPTY_RAKUTEN_COUPON_FORM, updateModeForCoupon, validateRakutenCouponForm, type RakutenCouponPlan } from './rakuten-coupon-model.js'

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

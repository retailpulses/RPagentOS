export type RakutenCouponWorkflowStatus =
  | 'draft'
  | 'publish_review'
  | 'published'
  | 'cancellation_review'
  | 'cancelled'

export type RakutenItemType = 1 | 3 | 4 | 5
export type RakutenDiscountType = 1 | 2 | 4
export type RakutenRankCode = 0 | 1 | 2 | 3 | 4 | 5

export const FIVE_ZERO_EVENT_KEY = 'rakuten_5_and_0_day' as const
export const FIVE_ZERO_TEMPLATE_ID = 'five_zero_storewide_percent' as const
export const FIVE_ZERO_TEMPLATE_VERSION = 1

export interface RakutenCalendarGeneration {
  eventKey: typeof FIVE_ZERO_EVENT_KEY
  occurrenceDate: string
  templateId: typeof FIVE_ZERO_TEMPLATE_ID
  templateVersion: number
  idempotencyKey: string
  generatedBy: 'system'
  requiresOperatorApproval: true
  sourceUrl: string
}

export interface RakutenCouponItem { itemUrl: string }

export interface RakutenOtherCondition {
  conditionTypeCode: 'RS001' | 'RS003' | 'RS004'
  startValue: string
}

export interface RakutenCouponToIssue {
  couponName: string
  couponCaption: string
  couponStartDate: string
  couponEndDate: string
  couponImage?: string
  issueCount: number
  itemType: RakutenItemType
  discountType: RakutenDiscountType
  discountFactor: number
  memberAvailMaxCount: number
  multiRankCond?: RakutenRankCode[]
  combineFlag: 0 | 1
  displayFlag: 0 | 1
  items?: RakutenCouponItem[]
  otherConditions?: RakutenOtherCondition[]
}

export interface RakutenCouponPlan {
  id: string
  status: RakutenCouponWorkflowStatus
  internalName: string
  shopCode: string
  coupon: RakutenCouponToIssue
  couponCode?: string
  pcGetUrl?: string
  calendarGeneration?: RakutenCalendarGeneration
  notes: string
  createdAt: string
  updatedAt: string
}

export interface RakutenCalendarOccurrence {
  date: string
  day: number
}

export interface RakutenCouponTemplateDefinition {
  id: typeof FIVE_ZERO_TEMPLATE_ID
  version: number
  name: string
  eventKey: typeof FIVE_ZERO_EVENT_KEY
  shopCode: string
  discountLabel: string
  guardrails: string[]
}

export const FIVE_ZERO_TEMPLATE: RakutenCouponTemplateDefinition = {
  id: FIVE_ZERO_TEMPLATE_ID,
  version: FIVE_ZERO_TEMPLATE_VERSION,
  name: '5と0の日 · 店舗限定5%OFF',
  eventKey: FIVE_ZERO_EVENT_KEY,
  shopCode: 'homebliss',
  discountLabel: 'Entire order · 5% off',
  guardrails: ['Operator approval required', 'Margin confirmation required', 'No coupon combination', 'Hidden until RMS review'],
}

const FIVE_ZERO_DAYS = [5, 10, 15, 20, 25, 30] as const
const FIVE_ZERO_SOURCE_URL = 'https://event.rakuten.co.jp/card/pointday/'

export function fiveZeroOccurrences(year: number, month: number): RakutenCalendarOccurrence[] {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return []
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return FIVE_ZERO_DAYS.filter(day => day <= daysInMonth).map(day => ({
    date: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    day,
  }))
}

export function buildFiveZeroCouponPlan(
  occurrenceDate: string,
  status: 'draft' | 'publish_review' = 'draft',
  generatedAt = new Date().toISOString(),
): RakutenCouponPlan {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(occurrenceDate)
  if (!match) throw new Error('occurrenceDate must use YYYY-MM-DD.')
  const year = Number(match[1])
  const month = Number(match[2])
  if (!fiveZeroOccurrences(year, month).some(occurrence => occurrence.date === occurrenceDate)) {
    throw new Error('occurrenceDate must be a valid 5と0のつく日 occurrence.')
  }
  const idempotencyKey = [FIVE_ZERO_TEMPLATE.shopCode, FIVE_ZERO_EVENT_KEY, occurrenceDate, FIVE_ZERO_TEMPLATE_ID, `v${FIVE_ZERO_TEMPLATE_VERSION}`].join(':')
  return {
    id: idempotencyKey,
    status,
    internalName: `${occurrenceDate} 5と0の日 店舗限定5%OFF`,
    shopCode: FIVE_ZERO_TEMPLATE.shopCode,
    coupon: {
      couponName: `${month}/${Number(match[3])} 店舗限定5%OFF`,
      couponCaption: 'Home Bliss店舗限定クーポン',
      couponStartDate: `${occurrenceDate}T00:00:00+09:00`,
      couponEndDate: `${occurrenceDate}T23:59:59+09:00`,
      issueCount: 100,
      itemType: 4,
      discountType: 2,
      discountFactor: 5,
      memberAvailMaxCount: 1,
      multiRankCond: [0],
      combineFlag: 0,
      displayFlag: 0,
    },
    calendarGeneration: {
      eventKey: FIVE_ZERO_EVENT_KEY,
      occurrenceDate,
      templateId: FIVE_ZERO_TEMPLATE_ID,
      templateVersion: FIVE_ZERO_TEMPLATE_VERSION,
      idempotencyKey,
      generatedBy: 'system',
      requiresOperatorApproval: true,
      sourceUrl: FIVE_ZERO_SOURCE_URL,
    },
    notes: 'System-generated review draft. Operator must confirm the Rakuten campaign date, margin, issue count, wording, and issue timing before any RMS creation.',
    createdAt: generatedAt,
    updatedAt: generatedAt,
  }
}

export interface RakutenCouponForm {
  internalName: string
  shopCode: string
  couponName: string
  couponCaption: string
  couponStartDate: string
  couponEndDate: string
  couponImage: string
  issueCount: string
  itemType: RakutenItemType
  discountType: RakutenDiscountType
  discountFactor: string
  memberAvailMaxCount: string
  multiRankCond: RakutenRankCode[]
  combineFlag: 0 | 1
  displayFlag: 0 | 1
  itemUrls: string
  minimumSpend: string
  minimumQuantity: string
  deviceCondition: '' | '0' | '1'
  notes: string
}

export const EMPTY_RAKUTEN_COUPON_FORM: RakutenCouponForm = {
  internalName: '', shopCode: 'homebliss', couponName: '', couponCaption: '',
  couponStartDate: '', couponEndDate: '', couponImage: '', issueCount: '100',
  itemType: 4, discountType: 2, discountFactor: '10', memberAvailMaxCount: '1',
  multiRankCond: [0], combineFlag: 0, displayFlag: 0, itemUrls: '',
  minimumSpend: '', minimumQuantity: '', deviceCondition: '', notes: '',
}

function characterCount(value: string): number { return Array.from(value).length }

export function splitItemUrls(value: string): string[] {
  return [...new Set(value.split(/[\n,]/).map(item => item.trim()).filter(Boolean))]
}

export function toJstApiDate(value: string): string {
  if (!value) return ''
  return `${value.length === 16 ? `${value}:00` : value}+09:00`
}

export function validateRakutenCouponForm(form: RakutenCouponForm): string[] {
  const errors: string[] = []
  const issueCount = Number(form.issueCount)
  const memberMax = Number(form.memberAvailMaxCount)
  const factor = Number(form.discountFactor)
  const itemUrls = splitItemUrls(form.itemUrls)

  if (!form.internalName.trim()) errors.push('Add an internal plan name.')
  if (!form.shopCode.trim()) errors.push('Add the Rakuten shop code.')
  if (!form.couponName.trim()) errors.push('couponName is required.')
  if (characterCount(form.couponName) > 50) errors.push('couponName must be 50 characters or fewer.')
  if (!form.couponCaption.trim()) errors.push('couponCaption is required.')
  if (characterCount(form.couponCaption) > 30) errors.push('couponCaption must be 30 characters or fewer.')
  if (!form.couponStartDate || !form.couponEndDate) errors.push('couponStartDate and couponEndDate are required.')
  if (form.couponStartDate && form.couponEndDate && form.couponStartDate >= form.couponEndDate) errors.push('couponEndDate must be after couponStartDate.')
  if (form.couponImage) {
    try {
      const imageUrl = new URL(form.couponImage)
      if (!['http:', 'https:'].includes(imageUrl.protocol)) throw new Error('invalid protocol')
    } catch { errors.push('couponImage must be a valid HTTP(S) URL.') }
  }
  if (!Number.isInteger(issueCount) || issueCount < 1) errors.push('issueCount must be an integer of at least 1.')
  if (!Number.isInteger(memberMax) || memberMax < 1) errors.push('memberAvailMaxCount must be an integer of at least 1.')
  if (form.discountType === 1 && (!Number.isInteger(factor) || factor < 1)) errors.push('Fixed discountFactor must be a positive whole-yen amount.')
  if (form.discountType === 2 && (!Number.isInteger(factor) || factor < 1 || factor > 99)) errors.push('Percentage discountFactor must be an integer from 1 to 99.')
  if ((form.itemType === 5) !== (form.discountType === 4)) errors.push('itemType 5 and discountType 4 must be used together for free shipping.')
  if (form.itemType === 1 && itemUrls.length !== 1) errors.push('itemType 1 requires exactly one Rakuten item URL.')
  if (form.itemType === 3 && itemUrls.length < 2) errors.push('itemType 3 requires at least two Rakuten item URLs.')
  if (itemUrls.length > 3000) errors.push('Rakuten accepts at most 3000 item URLs per coupon.')
  if (itemUrls.some(itemUrl => !/^https:\/\/item\.rakuten\.co\.jp\//.test(itemUrl))) errors.push('Every item must use a https://item.rakuten.co.jp/ URL.')
  if (form.minimumSpend && (!Number.isInteger(Number(form.minimumSpend)) || Number(form.minimumSpend) < 1 || Number(form.minimumSpend) > 999_999_999)) errors.push('RS003 minimum spend must be an integer from 1 to 999999999.')
  if (form.minimumQuantity && (!Number.isInteger(Number(form.minimumQuantity)) || Number(form.minimumQuantity) < 0 || Number(form.minimumQuantity) > 999_999_999)) errors.push('RS004 minimum quantity must be an integer from 0 to 999999999.')
  if (form.multiRankCond.includes(0) && form.multiRankCond.length > 1) errors.push('Rank code 0 (no restriction) cannot be combined with other ranks.')
  return errors
}

export function buildRakutenCouponPayload(form: RakutenCouponForm): RakutenCouponToIssue {
  const errors = validateRakutenCouponForm(form)
  if (errors.length) throw new Error(errors.join(' '))
  const itemUrls = splitItemUrls(form.itemUrls)
  const otherConditions: RakutenOtherCondition[] = []
  if (form.deviceCondition) otherConditions.push({ conditionTypeCode: 'RS001', startValue: form.deviceCondition })
  if (form.minimumSpend) otherConditions.push({ conditionTypeCode: 'RS003', startValue: form.minimumSpend })
  if (form.minimumQuantity) otherConditions.push({ conditionTypeCode: 'RS004', startValue: form.minimumQuantity })
  return {
    couponName: form.couponName.trim(), couponCaption: form.couponCaption.trim(),
    couponStartDate: toJstApiDate(form.couponStartDate), couponEndDate: toJstApiDate(form.couponEndDate),
    ...(form.couponImage.trim() ? { couponImage: form.couponImage.trim() } : {}),
    issueCount: Number(form.issueCount), itemType: form.itemType, discountType: form.discountType,
    discountFactor: form.discountType === 4 ? 1 : Number(form.discountFactor),
    memberAvailMaxCount: Number(form.memberAvailMaxCount), multiRankCond: [...form.multiRankCond],
    combineFlag: form.combineFlag, displayFlag: form.displayFlag,
    ...(itemUrls.length ? { items: itemUrls.map(itemUrl => ({ itemUrl })) } : {}),
    ...(otherConditions.length ? { otherConditions } : {}),
  }
}

export function formFromRakutenPlan(plan: RakutenCouponPlan): RakutenCouponForm {
  const condition = (code: RakutenOtherCondition['conditionTypeCode']) => plan.coupon.otherConditions?.find(value => value.conditionTypeCode === code)?.startValue ?? ''
  const withoutOffset = (value: string) => value.replace(/:00\+09:00$/, '').replace(/\+09:00$/, '')
  return {
    internalName: plan.internalName, shopCode: plan.shopCode,
    couponName: plan.coupon.couponName, couponCaption: plan.coupon.couponCaption,
    couponStartDate: withoutOffset(plan.coupon.couponStartDate), couponEndDate: withoutOffset(plan.coupon.couponEndDate),
    couponImage: plan.coupon.couponImage ?? '', issueCount: String(plan.coupon.issueCount),
    itemType: plan.coupon.itemType, discountType: plan.coupon.discountType,
    discountFactor: String(plan.coupon.discountFactor), memberAvailMaxCount: String(plan.coupon.memberAvailMaxCount),
    multiRankCond: [...(plan.coupon.multiRankCond ?? [0])], combineFlag: plan.coupon.combineFlag,
    displayFlag: plan.coupon.displayFlag, itemUrls: plan.coupon.items?.map(item => item.itemUrl).join('\n') ?? '',
    minimumSpend: condition('RS003'), minimumQuantity: condition('RS004'),
    deviceCondition: condition('RS001') as '' | '0' | '1', notes: plan.notes,
  }
}

export function updateModeForCoupon(plan: RakutenCouponPlan, now = new Date()): 'coupon.update' | 'coupon.patch' | 'none' {
  if (plan.status !== 'published') return 'none'
  const start = Date.parse(plan.coupon.couponStartDate)
  if (!Number.isFinite(start)) return 'none'
  return now.getTime() < start - 60 * 60 * 1000 ? 'coupon.update' : 'coupon.patch'
}

export function apiOperationForStatus(status: RakutenCouponWorkflowStatus): string {
  if (status === 'publish_review') return 'coupon.issue'
  if (status === 'published') return 'coupon.get / update / patch'
  if (status === 'cancellation_review') return 'coupon.delete'
  if (status === 'cancelled') return 'coupon.get verification'
  return 'No API call'
}

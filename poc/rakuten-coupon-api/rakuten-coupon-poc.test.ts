import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAuthorizationHeader,
  buildCouponIssueRequest,
  buildCouponIssueXml,
  COUPON_ISSUE_ENDPOINT,
  issueCouponLive,
  parseCouponIssueResponse,
  type CouponIssueInput,
} from "./rakuten-coupon-poc.js";

const validCoupon: CouponIssueInput = {
  couponName: "テスト & POC",
  couponCaption: "API検証用",
  couponStartDate: "2026-09-01T00:00:00+09:00",
  couponEndDate: "2026-09-02T23:59:59+09:00",
  issueCount: 1,
  itemType: 4,
  discountType: 2,
  discountFactor: 1,
  memberAvailMaxCount: 1,
  combineFlag: 0,
  displayFlag: 0,
};

test("builds the verified CouponAPI issue endpoint and XML field names", () => {
  const request = buildCouponIssueRequest(validCoupon);
  assert.equal(request.url, COUPON_ISSUE_ENDPOINT);
  assert.equal(request.method, "POST");
  assert.match(request.body, /<couponIssueRequest>/);
  assert.match(request.body, /<couponName>テスト &amp; POC<\/couponName>/);
  assert.match(request.body, /<issueCount>1<\/issueCount>/);
  assert.doesNotMatch(request.body, /couponIssueCount/);
  assert.match(request.body, /<displayFlag>0<\/displayFlag>/);
});

test("builds ESA Basic-style credentials exactly", () => {
  assert.equal(
    buildAuthorizationHeader("service", "license"),
    `ESA ${Buffer.from("service:license").toString("base64")}`,
  );
});

test("rejects item coupons without item URLs", () => {
  assert.throws(
    () => buildCouponIssueXml({ ...validCoupon, itemType: 1 }),
    /items are required/,
  );
});

test("requires JST timestamps", () => {
  assert.throws(
    () => buildCouponIssueXml({ ...validCoupon, couponStartDate: "2026-09-01T00:00:00Z" }),
    /\+09:00 JST offset/,
  );
});

test("parses a successful coupon issue response", () => {
  const result = parseCouponIssueResponse(`
    <result>
      <status><systemStatus>OK</systemStatus></status>
      <couponIssueResult>
        <couponCode>POC123</couponCode>
        <pcGetUrl>https://coupon.rakuten.co.jp/get/POC123</pcGetUrl>
      </couponIssueResult>
    </result>`);
  assert.deepEqual(result, {
    couponCode: "POC123",
    pcGetUrl: "https://coupon.rakuten.co.jp/get/POC123",
  });
});

test("blocks live calls without an exact confirmation", async () => {
  await assert.rejects(
    issueCouponLive(validCoupon, {
      serviceSecret: "service",
      licenseKey: "license",
      confirmation: "",
      fetchImpl: async () => {
        throw new Error("fetch must not run");
      },
    }),
    /Live issue blocked/,
  );
});

test("conducts the API-shaped POC through a mocked transport", async () => {
  let capturedUrl = "";
  let capturedBody = "";
  const result = await issueCouponLive(validCoupon, {
    serviceSecret: "service",
    licenseKey: "license",
    confirmation: "issue-coupon",
    fetchImpl: async (input, init) => {
      capturedUrl = String(input);
      capturedBody = String(init?.body);
      return new Response(
        "<result><status><systemStatus>OK</systemStatus></status><couponIssueResult><couponCode>MOCK-001</couponCode><pcGetUrl>https://example.test/MOCK-001</pcGetUrl></couponIssueResult></result>",
        { status: 200, headers: { "content-type": "application/xml" } },
      );
    },
  });
  assert.equal(capturedUrl, COUPON_ISSUE_ENDPOINT);
  assert.match(capturedBody, /<issueCount>1<\/issueCount>/);
  assert.equal(result.couponCode, "MOCK-001");
});

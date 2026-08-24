import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const COUPON_ISSUE_ENDPOINT =
  "https://api.rms.rakuten.co.jp/es/1.0/coupon/issue";

export interface CouponItem {
  itemUrl: string;
}

export interface OtherCondition {
  conditionTypeCode: "RS001" | "RS002" | "RS003" | "RS004";
  startValue: string;
}

export interface CouponIssueInput {
  couponName: string;
  couponCaption: string;
  couponStartDate: string;
  couponEndDate: string;
  issueCount: number;
  itemType: 1 | 3 | 4 | 5;
  discountType: 1 | 2 | 4;
  discountFactor: number;
  memberAvailMaxCount?: number;
  combineFlag: 0 | 1;
  displayFlag?: 0 | 1;
  couponImage?: string;
  items?: CouponItem[];
  otherConditions?: OtherCondition[];
}

export interface IssuedCoupon {
  couponCode: string;
  pcGetUrl: string;
}

export interface CouponRequestPreview {
  method: "POST";
  url: string;
  headers: {
    Accept: "application/xml";
    "Content-Type": "application/xml; charset=utf-8";
    Authorization: string;
  };
  body: string;
}

const JST_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/;

function characterCount(value: string): number {
  return Array.from(value).length;
}

export function validateCoupon(input: CouponIssueInput): string[] {
  const errors: string[] = [];

  if (!input.couponName.trim()) errors.push("couponName is required");
  if (characterCount(input.couponName) > 50) {
    errors.push("couponName must be 50 characters or fewer");
  }
  if (!input.couponCaption.trim()) errors.push("couponCaption is required");
  if (characterCount(input.couponCaption) > 30) {
    errors.push("couponCaption must be 30 characters or fewer");
  }
  if (!JST_DATE_TIME.test(input.couponStartDate)) {
    errors.push("couponStartDate must be ISO 8601 with the +09:00 JST offset");
  }
  if (!JST_DATE_TIME.test(input.couponEndDate)) {
    errors.push("couponEndDate must be ISO 8601 with the +09:00 JST offset");
  }

  const start = Date.parse(input.couponStartDate);
  const end = Date.parse(input.couponEndDate);
  if (Number.isFinite(start) && Number.isFinite(end) && start >= end) {
    errors.push("couponStartDate must be before couponEndDate");
  }
  if (!Number.isInteger(input.issueCount) || input.issueCount < 1) {
    errors.push("issueCount must be an integer greater than or equal to 1");
  }
  if (input.discountType === 1 && (!Number.isInteger(input.discountFactor) || input.discountFactor < 1)) {
    errors.push("fixed discountFactor must be a positive integer in yen");
  }
  if (input.discountType === 2 && (!Number.isInteger(input.discountFactor) || input.discountFactor < 1 || input.discountFactor > 99)) {
    errors.push("percentage discountFactor must be an integer from 1 to 99");
  }
  if (input.discountType === 4 && input.itemType !== 5) {
    errors.push("free-shipping discountType 4 requires itemType 5");
  }
  if ((input.itemType === 1 || input.itemType === 3) && !input.items?.length) {
    errors.push("items are required for itemType 1 or 3");
  }
  if (input.items && input.items.length > 3000) {
    errors.push("items cannot contain more than 3000 entries");
  }
  if (input.memberAvailMaxCount !== undefined &&
      (!Number.isInteger(input.memberAvailMaxCount) || input.memberAvailMaxCount < 1)) {
    errors.push("memberAvailMaxCount must be an integer greater than or equal to 1");
  }

  return errors;
}

export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function element(name: string, value: string | number, indent = "      "): string {
  return `${indent}<${name}>${escapeXml(String(value))}</${name}>`;
}

export function buildCouponIssueXml(input: CouponIssueInput): string {
  const errors = validateCoupon(input);
  if (errors.length) throw new Error(`Invalid coupon payload:\n- ${errors.join("\n- ")}`);

  const fields = [
    element("couponName", input.couponName),
    element("couponCaption", input.couponCaption),
    element("couponStartDate", input.couponStartDate),
    element("couponEndDate", input.couponEndDate),
  ];

  if (input.couponImage) fields.push(element("couponImage", input.couponImage));
  fields.push(element("issueCount", input.issueCount));
  fields.push(element("itemType", input.itemType));
  fields.push(element("discountType", input.discountType));
  fields.push(element("discountFactor", input.discountFactor));
  if (input.memberAvailMaxCount !== undefined) {
    fields.push(element("memberAvailMaxCount", input.memberAvailMaxCount));
  }
  fields.push(element("combineFlag", input.combineFlag));
  if (input.displayFlag !== undefined) fields.push(element("displayFlag", input.displayFlag));

  if (input.items?.length) {
    fields.push("      <items>");
    for (const item of input.items) {
      fields.push("        <item>");
      fields.push(element("itemUrl", item.itemUrl, "          "));
      fields.push("        </item>");
    }
    fields.push("      </items>");
  }

  if (input.otherConditions?.length) {
    fields.push("      <otherConditions>");
    for (const condition of input.otherConditions) {
      fields.push("        <otherCondition>");
      fields.push(element("conditionTypeCode", condition.conditionTypeCode, "          "));
      fields.push(element("startValue", condition.startValue, "          "));
      fields.push("        </otherCondition>");
    }
    fields.push("      </otherConditions>");
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<request>",
    "  <couponIssueRequest>",
    "    <coupon>",
    ...fields,
    "    </coupon>",
    "  </couponIssueRequest>",
    "</request>",
  ].join("\n");
}

export function buildAuthorizationHeader(serviceSecret: string, licenseKey: string): string {
  if (!serviceSecret || !licenseKey) throw new Error("Rakuten credentials are required");
  return `ESA ${Buffer.from(`${serviceSecret}:${licenseKey}`, "utf8").toString("base64")}`;
}

export function buildCouponIssueRequest(
  input: CouponIssueInput,
  credentials?: { serviceSecret: string; licenseKey: string },
): CouponRequestPreview {
  return {
    method: "POST",
    url: COUPON_ISSUE_ENDPOINT,
    headers: {
      Accept: "application/xml",
      "Content-Type": "application/xml; charset=utf-8",
      Authorization: credentials
        ? buildAuthorizationHeader(credentials.serviceSecret, credentials.licenseKey)
        : "ESA <redacted base64(serviceSecret:licenseKey)>",
    },
    body: buildCouponIssueXml(input),
  };
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function xmlText(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match ? decodeXml(match[1].trim()) : undefined;
}

export function parseCouponIssueResponse(xml: string): IssuedCoupon {
  const systemStatus = xmlText(xml, "systemStatus");
  const couponCode = xmlText(xml, "couponCode");
  if (systemStatus === "NG" || !couponCode) {
    const code = xmlText(xml, "code") ?? "UNKNOWN";
    const message = xmlText(xml, "message") ?? "CouponAPI returned no couponCode";
    throw new Error(`Rakuten CouponAPI error [${code}]: ${message}`);
  }
  return { couponCode, pcGetUrl: xmlText(xml, "pcGetUrl") ?? "" };
}

export async function issueCouponLive(
  input: CouponIssueInput,
  options: {
    serviceSecret: string;
    licenseKey: string;
    confirmation: string;
    fetchImpl?: typeof fetch;
  },
): Promise<IssuedCoupon> {
  if (options.confirmation !== "issue-coupon") {
    throw new Error("Live issue blocked: set RAKUTEN_POC_ALLOW_LIVE=issue-coupon explicitly");
  }
  const request = buildCouponIssueRequest(input, options);
  const response = await (options.fetchImpl ?? fetch)(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal: AbortSignal.timeout(15_000),
  });
  const responseBody = await response.text();
  if (!response.ok) {
    throw new Error(`Rakuten CouponAPI HTTP ${response.status}: ${responseBody.slice(0, 500)}`);
  }
  return parseCouponIssueResponse(responseBody);
}

const sampleCoupon: CouponIssueInput = {
  couponName: "API POC（非表示）",
  couponCaption: "API接続検証用",
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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const live = args.includes("--live");
  const payloadIndex = args.indexOf("--payload");
  if (payloadIndex >= 0 && !args[payloadIndex + 1]) {
    throw new Error("--payload requires a JSON file path");
  }
  const payload = payloadIndex >= 0
    ? JSON.parse(await readFile(args[payloadIndex + 1], "utf8")) as CouponIssueInput
    : sampleCoupon;

  if (!live) {
    console.log(JSON.stringify(buildCouponIssueRequest(payload), null, 2));
    return;
  }
  if (payloadIndex < 0) {
    throw new Error("Live issue requires an explicitly reviewed --payload JSON file");
  }

  const result = await issueCouponLive(payload, {
    serviceSecret: process.env.RAKUTEN_SERVICE_SECRET ?? "",
    licenseKey: process.env.RAKUTEN_LICENSE_KEY ?? "",
    confirmation: process.env.RAKUTEN_POC_ALLOW_LIVE ?? "",
  });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

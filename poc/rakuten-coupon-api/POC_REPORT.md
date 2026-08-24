# Rakuten CouponAPI 调研与 POC 报告

日期：2026-08-24  
状态：本地 POC 完成；未调用生产 API；未创建真实优惠券

## 结论

`coupon.issue` 可以通过 RMS WEB API 以 XML `POST` 创建优惠券。当前账户的
`coupon.issue/get/search/update/patch/delete` 以及 thanks coupon 接口均显示“利用中”。
本 POC 已完成从结构化 payload 到 XML request、ESA authentication、mock HTTP transport
和 response parsing 的完整调用链验证。

## 资料核对

1. Rakuten merchant portal 是官方权威来源，但未登录访问会重定向到 RMS login error；
   API 字段细节需在已登录 RMS 后复核。
2. GitHub [JakeJP/Rakuten.RMS.Api](https://github.com/JakeJP/Rakuten.RMS.Api)
   是 MIT licensed .NET client。其 `CouponAPI.cs` 明确使用：
   `POST https://api.rms.rakuten.co.jp/es/1.0/coupon/issue`。
3. 同仓库 `Models.cs` 的 `CouponToIssue` 明确 wire field 为 `issueCount`。
4. 本地 `rakuten-promotion` skill 的完整 TypeScript 实现与上述 endpoint、ESA auth 和
   XML envelope 一致，但 skill Quick Start/表格写成了 `couponIssueCount`；其实际 DTO、
   serializer 和测试使用 `issueCount`。POC 采用源码一致的 `issueCount`。

## POC 边界

- sample 使用 1% off、发行量 1、每会员 1 次、`displayFlag: 0`，仅用于请求预览。
- dry-run 不需要凭据，Authorization 永远以 redacted placeholder 输出。
- live path 需要显式 payload、两项环境变量和固定确认字符串，避免误触。
- 没有读取或写入 Supabase，没有修改数据库 schema。
- 没有执行 `coupon.issue`，因为 RPagentOS 当前 MVP 文档禁止真实 marketplace API
  mutation，且真实创建前仍需业务方确认最终券参数。

## 进入真实 canary 前

1. 在 RMS 登录后的官方 CouponAPI reference 逐字段复核必填规则和限制。
2. 将 license key 有效性用只读 `coupon.search?hits=1` 验证。
3. 审批一份最终 payload；建议先用 `displayFlag: 0`、`issueCount: 1`、
   `memberAvailMaxCount: 1`，并设置明确的未来 JST 时间窗。
4. 创建后立即用 `coupon.get` 验证返回对象；是否删除必须另行明确批准。

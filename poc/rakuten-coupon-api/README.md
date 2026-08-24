# Rakuten CouponAPI POC

Rakuten RMS `coupon.issue` 的隔离式 POC。它验证请求校验、XML wire format、ESA
认证头、HTTP 调用形状和成功响应解析；默认只输出 dry-run preview，不会访问 Rakuten。

## 已确认的接口契约

- Endpoint: `POST https://api.rms.rakuten.co.jp/es/1.0/coupon/issue`
- Auth: `Authorization: ESA base64(serviceSecret:licenseKey)`
- Content type: `application/xml; charset=utf-8`
- 根结构: `request > couponIssueRequest > coupon`
- 发行量字段是 `issueCount`，不是 `couponIssueCount`
- 时间使用包含 `+09:00` 的 ISO 8601 JST 格式

依据：Rakuten RMS merchant portal（需要 RMS 登录）、用户确认的 API 利用状态，以及
[JakeJP/Rakuten.RMS.Api](https://github.com/JakeJP/Rakuten.RMS.Api) 的 MIT 源码实现。

## 运行

```bash
# 只生成并检查请求，不联网
npm run poc:rakuten-coupon

# 运行 mock transport 测试，不联网
npm run test:rakuten-coupon-poc
```

真实创建刻意要求三个条件同时成立：

1. 必须通过 `--payload` 提供经过人工审阅的 JSON；内置 sample 不能 live 使用。
2. 凭据只从 `RAKUTEN_SERVICE_SECRET` 和 `RAKUTEN_LICENSE_KEY` 环境变量读取。
3. 必须显式设置 `RAKUTEN_POC_ALLOW_LIVE=issue-coupon` 并传入 `--live`。

```bash
RAKUTEN_POC_ALLOW_LIVE=issue-coupon \
npx tsx --env-file=.env.local \
  poc/rakuten-coupon-api/rakuten-coupon-poc.ts \
  --live --payload poc/rakuten-coupon-api/sample-coupon.json
```

注意：Rakuten CouponAPI 没有 sandbox。上面的命令会真实创建券；运行前必须重新检查
名称、折扣、适用商品、起止时间、发行量、每会员次数和 `displayFlag`。当前 RPagentOS
MVP 仍规定不执行真实 marketplace mutation，因此该命令仅用于未来经过明确审批的
受控验证，本次 POC 没有运行它。

import { existsSync, readFileSync } from 'node:fs';

import { buildWecomCopyReport } from '../packages/listing-copy/wecom-report.js';

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

async function main(): Promise<void> {
  const webhookUrl = process.env.WECOM_LISTING_COPY_WEBHOOK_URL ?? '';
  if (!webhookUrl.startsWith('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=')) {
    throw new Error('WECOM_LISTING_COPY_WEBHOOK_URL is missing or invalid');
  }
  const reportFile = argValue('report-file') ?? '';
  let report: Record<string, unknown> | null = null;
  if (reportFile && existsSync(reportFile)) {
    const parsed = JSON.parse(readFileSync(reportFile, 'utf8')) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) report = parsed as Record<string, unknown>;
  }
  const content = buildWecomCopyReport({
    report,
    jobStatus: process.env.LOOP_JOB_STATUS ?? 'unknown',
    runUrl: process.env.GITHUB_RUN_URL,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ msgtype: 'markdown', markdown: { content } }),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({})) as { errcode?: number; errmsg?: string };
    if (!response.ok || body.errcode !== 0) {
      throw new Error(`WeCom webhook rejected report: HTTP ${response.status}, code ${body.errcode ?? 'unknown'}, ${body.errmsg ?? 'unknown'}`);
    }
    console.log('WeCom listing copy report sent');
  } finally {
    clearTimeout(timeout);
  }
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

import {
  handleAccountMetricsRequest,
  type AccountMetricsEnv,
} from '../../src/api/account-metrics.js';

interface PagesFunctionContext {
  request: Request;
  env: AccountMetricsEnv;
}

export async function onRequestGet(context: PagesFunctionContext): Promise<Response> {
  return handleAccountMetricsRequest(context.request, context.env);
}


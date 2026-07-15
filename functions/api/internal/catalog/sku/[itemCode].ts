import { handleCatalogSkuRequest, type InternalCatalogEnv } from '../../../../../src/api/internal-catalog.js';

interface PagesFunctionContext {
  request: Request;
  env: InternalCatalogEnv;
  params: Record<string, string | string[]>;
}

export async function onRequestGet(context: PagesFunctionContext): Promise<Response> {
  const value = context.params.itemCode;
  const itemCode = Array.isArray(value) ? value[0] ?? '' : value ?? '';
  return handleCatalogSkuRequest(context.request, context.env, itemCode);
}

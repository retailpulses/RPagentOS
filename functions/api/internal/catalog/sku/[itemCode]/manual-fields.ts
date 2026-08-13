import { handleCatalogSkuManualFieldsUpdate, type InternalCatalogEnv } from '../../../../../../src/api/internal-catalog.js';

interface PagesFunctionContext {
  request: Request;
  env: InternalCatalogEnv;
  params: Record<string, string | string[]>;
}

export async function onRequestPatch(context: PagesFunctionContext): Promise<Response> {
  const value = context.params.itemCode;
  const itemCode = Array.isArray(value) ? value[0] ?? '' : value ?? '';
  return handleCatalogSkuManualFieldsUpdate(context.request, context.env, itemCode);
}

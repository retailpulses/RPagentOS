import { handleMainImageAssetDelivery, type InternalCatalogEnv } from '../../../src/api/internal-catalog.js';

interface PagesFunctionContext {
  request: Request;
  env: InternalCatalogEnv;
  params: { path?: string | string[] };
}

export async function onRequestGet(context: PagesFunctionContext): Promise<Response> {
  return handleMainImageAssetDelivery(context.request, context.env, context.params.path);
}

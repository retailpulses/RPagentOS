import { handleDraftMaterialization, type InternalCatalogEnv } from '../../../../../src/api/internal-catalog-lifecycle.js';

interface PagesFunctionContext {
  request: Request;
  env: InternalCatalogEnv;
}

export async function onRequestPost(context: PagesFunctionContext): Promise<Response> {
  return handleDraftMaterialization(context.request, context.env);
}

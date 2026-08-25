import { handleMainImageAssetSave, type InternalCatalogEnv } from '../../../../../../src/api/internal-catalog.js';

interface PagesFunctionContext {
  request: Request;
  env: InternalCatalogEnv;
  params: { id: string };
}

export async function onRequestPost(context: PagesFunctionContext): Promise<Response> {
  return handleMainImageAssetSave(context.request, context.env, context.params.id);
}

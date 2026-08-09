import { handleListingContentUpdate, type InternalCatalogEnv } from '../../../../../src/api/internal-catalog-lifecycle.js';

interface PagesFunctionContext {
  request: Request;
  env: InternalCatalogEnv;
  params: { id: string };
}

export async function onRequestPatch(context: PagesFunctionContext): Promise<Response> {
  return handleListingContentUpdate(context.request, context.env, context.params.id);
}

import { handleRestoreListing, type InternalCatalogEnv } from '../../../../../src/api/internal-catalog-lifecycle.js';

interface PagesFunctionContext {
  request: Request;
  env: InternalCatalogEnv;
  params: { id: string };
}

export async function onRequestPost(context: PagesFunctionContext): Promise<Response> {
  return handleRestoreListing(context.request, context.env, context.params.id);
}

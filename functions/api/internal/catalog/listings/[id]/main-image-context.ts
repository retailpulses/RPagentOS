import { handleMainImageContext, type InternalCatalogEnv } from '../../../../../../src/api/internal-catalog.js';

interface PagesFunctionContext {
  request: Request;
  env: InternalCatalogEnv;
  params: { id: string };
}

export async function onRequestGet(context: PagesFunctionContext): Promise<Response> {
  return handleMainImageContext(context.request, context.env, context.params.id);
}

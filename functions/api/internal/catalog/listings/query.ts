import { handleListingsStageQuery, type InternalCatalogEnv } from '../../../../../src/api/internal-catalog.js';

interface PagesFunctionContext {
  request: Request;
  env: InternalCatalogEnv;
}

export async function onRequestGet(context: PagesFunctionContext): Promise<Response> {
  return handleListingsStageQuery(context.request, context.env);
}

import {
  handleListingCandidatesQuery,
  type InternalCatalogEnv,
} from '../../../../../src/api/internal-catalog.js';

interface PagesFunctionContext {
  request: Request;
  env: InternalCatalogEnv;
}

export async function onRequestPost(context: PagesFunctionContext): Promise<Response> {
  return handleListingCandidatesQuery(context.request, context.env);
}

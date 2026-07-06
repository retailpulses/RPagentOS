import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { runQwenReviewForWorkItem } from '../packages/listing-intelligence/qwen-review.js';
import { supabase } from '../lib/supabase.js';

const port = Number(process.env['LISTING_QWEN_BRIDGE_PORT'] ?? 8788);
const pollMs = Number(process.env['LISTING_QWEN_BRIDGE_POLL_MS'] ?? 2500);
const allowedOrigins = new Set([
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://localhost:5173',
  'http://localhost:5174',
  'https://agent.homesbliss.net',
  'https://rpagentos.pages.dev',
]);

function sendJson(res: ServerResponse, status: number, body: unknown, origin?: string): void {
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(status);
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin;
  const originValue = typeof origin === 'string' ? origin : undefined;

  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {}, originValue);
    return;
  }

  try {
    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, { ok: true, service: 'rpagentos-listing-qwen-bridge' }, originValue);
      return;
    }

    if (req.method === 'POST' && req.url === '/reviews') {
      if (originValue && !allowedOrigins.has(originValue)) {
        sendJson(res, 403, { error: `Origin not allowed: ${originValue}` }, originValue);
        return;
      }

      const body = await readBody(req);
      const workItemId = typeof body['work_item_id'] === 'string' ? body['work_item_id'] : null;
      if (!workItemId) {
        sendJson(res, 400, { error: 'work_item_id is required' }, originValue);
        return;
      }

      const result = await runQwenReviewForWorkItem(workItemId, {
        force: body['force'] === true,
        model: typeof body['model'] === 'string' ? body['model'] : undefined,
      });
      sendJson(res, 200, { ok: true, result }, originValue);
      return;
    }

    sendJson(res, 404, { error: 'Not found' }, originValue);
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : 'Qwen bridge failed' }, originValue);
  }
});

interface QwenRequestRow {
  id: string;
  work_item_id: string;
  force: boolean;
  llm_model: string | null;
}

let polling = false;

async function processQueuedRequests(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    const { data, error } = await supabase
      .from('listing_qwen_review_requests')
      .select('id,work_item_id,force,llm_model')
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(1);

    if (error) throw new Error(`Poll Qwen requests: ${error.message}`);
    const request = data?.[0] as QwenRequestRow | undefined;
    if (!request) return;

    const now = new Date().toISOString();
    const { error: claimError } = await supabase
      .from('listing_qwen_review_requests')
      .update({ status: 'running', updated_at: now })
      .eq('id', request.id)
      .eq('status', 'queued');

    if (claimError) throw new Error(`Claim Qwen request: ${claimError.message}`);

    try {
      const result = await runQwenReviewForWorkItem(request.work_item_id, {
        force: request.force,
        model: request.llm_model ?? undefined,
      });
      await supabase
        .from('listing_qwen_review_requests')
        .update({
          status: 'completed',
          review_id: result.review_id,
          error_message: null,
          updated_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        })
        .eq('id', request.id);
      console.log(`Qwen request ${request.id} completed with review ${result.review_id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Qwen request failed';
      await supabase
        .from('listing_qwen_review_requests')
        .update({
          status: 'failed',
          error_message: message,
          updated_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        })
        .eq('id', request.id);
      console.error(`Qwen request ${request.id} failed: ${message}`);
    }
  } finally {
    polling = false;
  }
}

server.listen(port, '127.0.0.1', () => {
  console.log(`Listing Qwen bridge listening on http://127.0.0.1:${port}`);
  console.log(`Polling listing_qwen_review_requests every ${pollMs}ms`);
  setInterval(() => {
    void processQueuedRequests().catch((error) => {
      console.error(error instanceof Error ? error.message : error);
    });
  }, pollMs);
});

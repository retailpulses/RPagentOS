import assert from 'node:assert/strict';
import test from 'node:test';
import { requestMainImageCandidate, requestMainImageSchema } from './openai.js';

test('requests a strict OpenAI structured schema without exposing the API key in the body', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const result = await requestMainImageSchema({
    apiKey: 'secret-key',
    model: 'gpt-5.4',
    factPack: { source_hash: 'hash-1' },
    jsonSchema: { type: 'object', additionalProperties: false },
    fetchFn: async (input, init) => {
      calls.push({ url: String(input), init });
      return Response.json({ output: [{ content: [{ type: 'output_text', text: '{"ok":true}' }] }] });
    },
  });

  assert.deepEqual(result, { ok: true });
  const captured = calls[0];
  assert.ok(captured);
  assert.equal(captured.url, 'https://api.openai.com/v1/responses');
  assert.equal(new Headers(captured.init?.headers).get('authorization'), 'Bearer secret-key');
  const bodyText = String(captured.init?.body);
  assert.equal(bodyText.includes('secret-key'), false);
  const body = JSON.parse(bodyText) as Record<string, any>;
  assert.equal(body.model, 'gpt-5.4');
  assert.equal(body.text.format.type, 'json_schema');
  assert.equal(body.text.format.strict, true);
});

test('requests exactly one high-fidelity image edit and decodes base64 output', async () => {
  const forms: FormData[] = [];
  const bytes = await requestMainImageCandidate({
    apiKey: 'secret-key',
    model: 'gpt-image-2',
    schema: { schema_version: '1.0' },
    sourceImages: [{
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      contentType: 'image/jpeg',
      filename: 'source.jpg',
    }],
    fetchFn: async (_input, init) => {
      forms.push(init?.body as FormData);
      return Response.json({ data: [{ b64_json: btoa('\u0001\u0002\u0003') }] });
    },
  });

  assert.deepEqual([...bytes], [1, 2, 3]);
  const form = forms[0];
  assert.ok(form);
  assert.equal(form.get('model'), 'gpt-image-2');
  assert.equal(form.get('n'), '1');
  assert.equal(form.get('size'), '1024x1024');
  assert.equal(form.get('quality'), 'medium');
  assert.equal(form.get('input_fidelity'), 'high');
  assert.equal(form.getAll('image[]').length, 1);
});

test('does not call OpenAI without a verified source image', async () => {
  let called = false;
  await assert.rejects(
    requestMainImageCandidate({
      apiKey: 'key', model: 'gpt-image-2', schema: {}, sourceImages: [],
      fetchFn: async () => { called = true; return Response.json({}); },
    }),
    /source_image_required/,
  );
  assert.equal(called, false);
});

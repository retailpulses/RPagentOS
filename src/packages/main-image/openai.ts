export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface OpenAiSchemaRequest {
  apiKey: string;
  model: string;
  factPack: unknown;
  jsonSchema: Record<string, unknown>;
  fetchFn?: FetchLike;
}

export interface OpenAiSourceImage {
  bytes: Uint8Array;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  filename: string;
}

function outputText(body: Record<string, unknown>): string | null {
  if (typeof body.output_text === 'string') return body.output_text;
  if (!Array.isArray(body.output)) return null;
  for (const item of body.output) {
    if (!item || typeof item !== 'object') continue;
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const record = part as Record<string, unknown>;
      if (record.type === 'output_text' && typeof record.text === 'string') return record.text;
    }
  }
  return null;
}

export async function requestMainImageSchema(params: OpenAiSchemaRequest): Promise<unknown> {
  const response = await (params.fetchFn ?? fetch)('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${params.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: params.model,
      input: [
        {
          role: 'system',
          content: [{
            type: 'input_text',
            text: [
              'Create one conservative Japanese ecommerce main-image schema.',
              'Select only supplied evidence, variant, and asset IDs.',
              'Current listing title and description are context-only, not proof.',
              'Copy may use only exact supplied evidence values joined by punctuation; leave copy empty when that is not useful.',
              'Never add claims, rankings, discounts, certifications, logos, people, or product modifications.',
              'Return only the requested structured output.',
            ].join(' '),
          }],
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: JSON.stringify(params.factPack) }],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'main_image_schema',
          strict: true,
          schema: params.jsonSchema,
        },
      },
    }),
  });
  if (!response.ok) throw new Error(`openai_schema_failed_${response.status}`);
  const body = await response.json() as Record<string, unknown>;
  const text = outputText(body);
  if (!text) throw new Error('openai_schema_missing_output');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('openai_schema_invalid_json');
  }
}

export async function requestMainImageCandidate(params: {
  apiKey: string;
  model: string;
  schema: unknown;
  sourceImages: OpenAiSourceImage[];
  fetchFn?: FetchLike;
}): Promise<Uint8Array> {
  if (params.sourceImages.length === 0) throw new Error('source_image_required');
  const form = new FormData();
  form.set('model', params.model);
  form.set('n', '1');
  form.set('size', '1024x1024');
  form.set('quality', 'medium');
  form.set('output_format', 'jpeg');
  form.set('output_compression', '90');
  form.set('input_fidelity', 'high');
  form.set('prompt', [
    'Generate one marketplace main image from the supplied product references.',
    'Preserve exact product shape, materials, colors, proportions, and included components.',
    'Follow this approved schema exactly:',
    JSON.stringify(params.schema),
  ].join('\n'));
  for (const source of params.sourceImages) {
    const buffer = source.bytes.buffer.slice(
      source.bytes.byteOffset,
      source.bytes.byteOffset + source.bytes.byteLength,
    ) as ArrayBuffer;
    const blob = new Blob([buffer], { type: source.contentType });
    form.append('image[]', blob, source.filename);
  }

  const response = await (params.fetchFn ?? fetch)('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { authorization: `Bearer ${params.apiKey}` },
    body: form,
  });
  if (!response.ok) throw new Error(`openai_image_failed_${response.status}`);
  const body = await response.json() as { data?: Array<{ b64_json?: unknown }> };
  const encoded = body.data?.[0]?.b64_json;
  if (typeof encoded !== 'string' || !encoded) throw new Error('openai_image_missing_output');
  try {
    const binary = atob(encoded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new Error('openai_image_invalid_base64');
  }
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { stripPlatformIdentity } from '../lib/self-hosted.ts';

test('should remove forged platform identity headers and keep the rest', () => {
  const request = new Request('https://example.test/api/me', {
    method: 'POST',
    headers: {
      'oai-authenticated-user-id': 'forged',
      'OAI-Authenticated-User-Email': 'boss@example.test',
      'oai-authenticated-user-full-name': 'Boss',
      cookie: 'a=1',
      'content-type': 'application/json',
    },
    body: '{}',
  });
  const cleaned = stripPlatformIdentity(request);
  assert.equal([...cleaned.headers.keys()].some((name) => name.startsWith('oai-authenticated-user-')), false);
  assert.equal(cleaned.headers.get('cookie'), 'a=1');
  assert.equal(cleaned.headers.get('content-type'), 'application/json');
  assert.equal(cleaned.method, 'POST');
});

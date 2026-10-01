import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleGalleryApi } from './gallery-api.js';

const origin = 'https://infoqubly.github.io';
const base = 'https://qubly.studio/api/gallery';
const catalog = {
  version: 1,
  sections: {
    esterni: [{ id: 'one', titles: { it: 'Uno', en: 'One', sl: 'Ena' }, preview: 'one.webp' }, { id: 'two', titles: { it: 'Due', en: 'Two', sl: 'Dve' }, preview: 'two.webp' }],
    interni: [], paesaggi: []
  }
};
const env = {
  GALLERY_CLIENT_ID: 'test-client',
  GALLERY_CLIENT_SECRET: 'test-secret',
  GALLERY_SESSION_KEY: Buffer.alloc(32, 7).toString('base64url'),
  ASSETS: { fetch: async () => Response.json(catalog) }
};

test('catalog is limited to the Tools origin', async () => {
  const allowed = await handleGalleryApi(new Request(`${base}/catalog`, { headers: { Origin: origin } }), env);
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('Access-Control-Allow-Origin'), origin);
  assert.equal((await allowed.json()).sections.esterni.length, 2);
  const denied = await handleGalleryApi(new Request(`${base}/catalog`, { headers: { Origin: 'https://example.com' } }), env);
  assert.equal(denied.status, 403);
});

test('GitHub login creates an encrypted session and reorder writes the catalog', async () => {
  const originalFetch = globalThis.fetch;
  let published;
  let uploadTree;
  let updatedRef;
  globalThis.fetch = async (url, options = {}) => {
    const address = String(url);
    if (address === 'https://github.com/login/oauth/access_token') {
      const body = new URLSearchParams(options.body);
      assert.equal(body.get('client_secret'), 'test-secret');
      assert.ok(body.get('code_verifier'));
      return Response.json({ access_token: 'github-test-token', expires_in: 3600 });
    }
    assert.equal(options.headers.Authorization, 'Bearer github-test-token');
    if (address === 'https://api.github.com/user') return Response.json({ login: 'infoqubly' });
    if (address === 'https://api.github.com/repos/infoqubly/qubly') return Response.json({ full_name: 'infoqubly/qubly' });
    if (address.endsWith('/contents/gallery/catalog.json?ref=main')) return Response.json({ sha: 'old-sha', content: Buffer.from(JSON.stringify(catalog)).toString('base64') });
    if (address.endsWith('/contents/gallery/catalog.json') && options.method === 'PUT') {
      published = JSON.parse(Buffer.from(JSON.parse(options.body).content, 'base64').toString());
      return Response.json({ commit: { sha: 'new-sha' } });
    }
    if (address.endsWith('/git/ref/heads/main') && options.method !== 'PATCH') return Response.json({ object: { sha: 'head-sha' } });
    if (address.endsWith('/git/commits/head-sha')) return Response.json({ tree: { sha: 'tree-sha' } });
    if (address.endsWith('/git/blobs')) return Response.json({ sha: 'blob-sha' });
    if (address.endsWith('/git/trees')) {
      uploadTree = JSON.parse(options.body).tree;
      return Response.json({ sha: 'new-tree-sha' });
    }
    if (address.endsWith('/git/commits') && options.method === 'POST') return Response.json({ sha: 'upload-commit-sha' });
    if (address.endsWith('/git/refs/heads/main') && options.method === 'PATCH') {
      updatedRef = JSON.parse(options.body);
      return Response.json({ object: { sha: updatedRef.sha } });
    }
    throw new Error(`Unexpected call: ${address}`);
  };
  try {
    const start = await handleGalleryApi(new Request(`${base}/auth/start`), env);
    assert.equal(start.status, 302);
    const githubUrl = new URL(start.headers.get('Location'));
    assert.equal(githubUrl.hostname, 'github.com');
    assert.ok(githubUrl.searchParams.get('code_challenge'));
    const cookie = start.headers.get('Set-Cookie').split(';')[0];
    const callback = await handleGalleryApi(new Request(`${base}/auth/callback?code=test-code&state=${githubUrl.searchParams.get('state')}`, { headers: { Cookie: cookie } }), env);
    assert.equal(callback.status, 302);
    const session = new URL(callback.headers.get('Location')).hash.slice('#session='.length);
    assert.ok(session && !session.includes('github-test-token'));
    const order = await handleGalleryApi(new Request(`${base}/publish`, {
      method: 'POST',
      headers: { Origin: origin, Authorization: `Bearer ${session}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'reorder', category: 'esterni', order: ['two', 'one'] })
    }), env);
    assert.equal(order.status, 202);
    assert.deepEqual(published.sections.esterni.map(item => item.id), ['two', 'one']);
    const removal = await handleGalleryApi(new Request(`${base}/publish`, {
      method: 'POST',
      headers: { Origin: origin, Authorization: `Bearer ${session}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'remove', category: 'esterni', id: 'one' })
    }), env);
    assert.equal(removal.status, 202);
    assert.deepEqual(published.sections.esterni.map(item => item.id), ['two']);
    assert.deepEqual(published.removed, ['one']);
    const missing = await handleGalleryApi(new Request(`${base}/publish`, {
      method: 'POST',
      headers: { Origin: origin, Authorization: `Bearer ${session}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'remove', category: 'esterni', id: 'absent' })
    }), env);
    assert.equal(missing.status, 400);
    const upload = await handleGalleryApi(new Request(`${base}/publish`, {
      method: 'POST',
      headers: { Origin: origin, Authorization: `Bearer ${session}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'replace', category: 'esterni', id: 'one', extension: 'jpg', titles: { it: 'Nuovo', en: 'New', sl: 'Novo' }, image: Buffer.from('image').toString('base64') })
    }), env);
    assert.equal(upload.status, 202);
    assert.equal(uploadTree.length, 2);
    assert.ok(uploadTree.some(item => item.path.endsWith('.jpg')));
    assert.ok(uploadTree.some(item => item.path.endsWith('.json')));
    assert.deepEqual(updatedRef, { sha: 'upload-commit-sha', force: false });
  } finally { globalThis.fetch = originalFetch; }
});

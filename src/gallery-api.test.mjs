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
    if (address.includes('/contents/gallery/catalog.json?ref=')) return Response.json({ sha: 'old-sha', content: Buffer.from(JSON.stringify(catalog)).toString('base64') });
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

async function publish(body) {
  const key = await crypto.subtle.importKey('raw', Buffer.alloc(32, 7), 'AES-GCM', false, ['encrypt']);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify({ token: 'github-test-token', login: 'infoqubly', expires: Date.now() + 60_000 }));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plaintext);
  const session = `${Buffer.from(nonce).toString('base64url')}.${Buffer.from(ciphertext).toString('base64url')}`;
  return handleGalleryApi(new Request(`${base}/publish`, {
    method: 'POST',
    headers: { Origin: origin, Authorization: `Bearer ${session}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }), env);
}

async function withGitHub(handler, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    assert.equal(options.headers.Authorization, 'Bearer github-test-token');
    assert.equal(options.cache, 'no-store');
    const path = new URL(url).pathname.replace('/repos/infoqubly/qubly', '') + new URL(url).search;
    return handler(path, options.method || 'GET', options.body ? JSON.parse(options.body) : undefined);
  };
  try { await run(); } finally { globalThis.fetch = originalFetch; }
}

function catalogFile(value, sha = 'catalog-sha') {
  return Response.json({ sha, content: Buffer.from(JSON.stringify(value)).toString('base64') });
}

const imageRequest = { mode: 'add', category: 'esterni', extension: 'jpg', titles: { it: 'Nuovo', en: 'New', sl: 'Novo' }, image: Buffer.from('image').toString('base64') };

for (const mode of ['reorder', 'remove']) {
  test(`${mode} retries two catalog conflicts and preserves concurrent data`, async () => {
    let state = structuredClone(catalog);
    let reads = 0;
    let writes = 0;
    await withGitHub((path, method, body) => {
      if (path === '/contents/gallery/catalog.json?ref=main') return catalogFile(state, `sha-${++reads}`);
      assert.equal(path, '/contents/gallery/catalog.json');
      assert.equal(method, 'PUT');
      assert.equal(body.sha, `sha-${reads}`);
      assert.equal(body.branch, 'main');
      writes++;
      if (writes === 1) {
        state.sections.interni.push({ id: 'concurrent-photo' });
        state.sections.esterni[1].titles.it = 'Titolo aggiornato';
        return Response.json({ message: 'Conflict' }, { status: 409 });
      }
      if (writes === 2) {
        state.removed = ['previous-removal'];
        state.version = 2;
        return Response.json({ message: 'sha does not match the current file' }, { status: 422 });
      }
      state = JSON.parse(Buffer.from(body.content, 'base64').toString());
      return Response.json({ commit: { sha: 'saved' } });
    }, async () => {
      const result = await publish({ mode, category: 'esterni', order: ['two', 'one'], id: 'one' });
      assert.equal(result.status, 202, JSON.stringify(await result.json()));
    });
    assert.equal(reads, 3);
    assert.equal(writes, 3);
    assert.equal(state.version, 2);
    assert.equal(state.sections.esterni[0].titles.it, 'Titolo aggiornato');
    assert.deepEqual(state.sections.interni, [{ id: 'concurrent-photo' }]);
    assert.deepEqual(state.sections.esterni.map(photo => photo.id), mode === 'reorder' ? ['two', 'one'] : ['two']);
    assert.deepEqual(state.removed, mode === 'reorder' ? ['previous-removal'] : ['previous-removal', 'one']);
  });

  test(`${mode} accepts an operation already applied after a conflict`, async () => {
    const state = structuredClone(catalog);
    let writes = 0;
    await withGitHub((path, method) => {
      if (method === 'GET') return catalogFile(state);
      assert.equal(path, '/contents/gallery/catalog.json');
      writes++;
      if (mode === 'reorder') state.sections.esterni.reverse();
      else {
        state.sections.esterni = state.sections.esterni.filter(photo => photo.id !== 'one');
        state.removed = ['one'];
      }
      return Response.json({ message: 'Conflict' }, { status: 409 });
    }, async () => {
      const result = await publish({ mode, category: 'esterni', order: ['two', 'one'], id: 'one' });
      assert.equal(result.status, 202, JSON.stringify(await result.json()));
    });
    assert.equal(writes, 1);
  });
}

for (const change of ['add', 'remove']) {
  test(`reorder rejects concurrent ${change} without inventing a new order`, async () => {
    const state = structuredClone(catalog);
    let writes = 0;
    await withGitHub((path, method) => {
      if (method === 'GET') return catalogFile(state);
      writes++;
      if (change === 'add') state.sections.esterni.push({ id: 'three' });
      else state.sections.esterni.pop();
      return Response.json({ message: 'Conflict' }, { status: 409 });
    }, async () => {
      const result = await publish({ mode: 'reorder', category: 'esterni', order: ['two', 'one'] });
      assert.equal(result.status, 400);
      assert.match((await result.json()).error, /scegliere il nuovo ordine/);
    });
    assert.equal(writes, 1);
  });
}

function uploadGitHub({ conflicts = [], uncertain = null, removeTarget = false } = {}) {
  let current = 'head-0';
  const commits = new Map([[current, { tree: 'tree-0' }]]);
  const trees = new Map([['tree-0', new Map([['existing.html', 'original']])]]);
  const state = { blobs: [], trees: [], parents: [], patches: [], catalogRefs: [], files: null };
  function advanceHead() {
    const parentTree = trees.get(commits.get(current).tree);
    current = `head-${state.patches.length}`;
    const files = new Map(parentTree);
    files.set(`concurrent-${state.patches.length}.html`, 'keep this');
    const tree = `${current}-tree`;
    trees.set(tree, files);
    commits.set(current, { tree });
  }
  state.handler = (path, method, body) => {
    if (path === '/git/ref/heads/main') return Response.json({ object: { sha: current } });
    if (path.startsWith('/contents/gallery/catalog.json?ref=')) {
      state.catalogRefs.push(path.split('=')[1]);
      const value = structuredClone(catalog);
      if (removeTarget && state.patches.length) value.sections.esterni = [];
      return catalogFile(value);
    }
    if (path.startsWith('/git/commits/')) return Response.json({ tree: { sha: commits.get(path.split('/').pop()).tree } });
    if (path === '/git/blobs') {
      state.blobs.push(body);
      return Response.json({ sha: `blob-${state.blobs.length}` });
    }
    if (path === '/git/trees') {
      state.trees.push(body);
      const files = new Map(trees.get(body.base_tree));
      for (const entry of body.tree) files.set(entry.path, entry.sha);
      const sha = `upload-tree-${state.trees.length}`;
      trees.set(sha, files);
      return Response.json({ sha });
    }
    if (path === '/git/commits' && method === 'POST') {
      state.parents.push(body.parents);
      const sha = `upload-commit-${state.parents.length}`;
      commits.set(sha, { tree: body.tree });
      return Response.json({ sha });
    }
    if (path === '/git/refs/heads/main' && method === 'PATCH') {
      state.patches.push(body);
      assert.equal(body.force, false);
      const conflict = conflicts[state.patches.length - 1];
      if (conflict) {
        advanceHead();
        return Response.json({ message: conflict === 422 ? 'Update is not a fast forward' : 'Conflict' }, { status: conflict });
      }
      if (uncertain === 'rejected') throw new TypeError('Network unavailable');
      current = body.sha;
      state.files = trees.get(commits.get(current).tree);
      if (uncertain === 'accepted' || uncertain === 'processed') {
        if (uncertain === 'processed') {
          advanceHead();
          const processed = trees.get(commits.get(current).tree);
          for (const path of processed.keys()) if (path.startsWith('gallery/inbox/')) processed.delete(path);
          state.files = processed;
        }
        throw new TypeError('Response lost');
      }
      return Response.json({ object: { sha: current } });
    }
    if (path.startsWith('/compare/')) return Response.json({ status: uncertain === 'processed' ? 'ahead' : 'diverged' });
    throw new Error(`Unexpected ${method} ${path}`);
  };
  return state;
}

test('upload retries multiple ref conflicts with one upload ID, one pair of blobs and fresh main trees', async () => {
  const state = uploadGitHub({ conflicts: [409, 422] });
  let result;
  await withGitHub(state.handler, async () => {
    const response = await publish(imageRequest);
    result = await response.json();
    assert.equal(response.status, 202, JSON.stringify(result));
  });
  assert.equal(state.blobs.length, 2);
  assert.equal(state.patches.length, 3);
  assert.deepEqual(state.parents, [['head-0'], ['head-1'], ['head-2']]);
  assert.deepEqual(state.catalogRefs, ['head-0', 'head-1', 'head-2']);
  assert.deepEqual(state.trees.map(tree => tree.base_tree), ['tree-0', 'head-1-tree', 'head-2-tree']);
  assert.ok(state.trees.every(tree => JSON.stringify(tree.tree) === JSON.stringify(state.trees[0].tree)));
  const uploadId = result.id.slice('photo-'.length);
  assert.ok(state.files.has(`gallery/inbox/${uploadId}.json`));
  assert.ok(state.files.has(`gallery/inbox/${uploadId}.jpg`));
  assert.equal(state.files.get('existing.html'), 'original');
  assert.equal(state.files.get('concurrent-1.html'), 'keep this');
  assert.equal(state.files.get('concurrent-2.html'), 'keep this');
});

test('replacement stops if its target was removed during a ref conflict', async () => {
  const state = uploadGitHub({ conflicts: [409], removeTarget: true });
  await withGitHub(state.handler, async () => {
    const response = await publish({ ...imageRequest, mode: 'replace', id: 'one' });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /non è più presente/);
  });
  assert.equal(state.patches.length, 1);
  assert.equal(state.blobs.length, 2);
});

for (const uncertain of ['accepted', 'processed', 'rejected']) {
  test(`upload with a lost PATCH response checks history (${uncertain}) without duplicating inbox entries`, async () => {
    const state = uploadGitHub({ uncertain });
    await withGitHub(state.handler, async () => {
      const response = await publish(imageRequest);
      assert.equal(response.status, uncertain === 'rejected' ? 400 : 202, JSON.stringify(await response.json()));
    });
    assert.equal(state.patches.length, 1);
    assert.equal(state.trees.length, 1);
    assert.equal(state.blobs.length, 2);
    if (uncertain === 'processed') assert.ok([...state.files.keys()].every(path => !path.startsWith('gallery/inbox/')));
  });
}

for (const mode of ['add', 'reorder', 'remove']) {
  for (const status of [403, 422]) {
    test(`${mode} does not retry a ${status === 403 ? 'permission' : 'validation'} failure`, async () => {
      const state = uploadGitHub();
      let writes = 0;
      await withGitHub((path, method, body) => {
        if ((method === 'PUT' && path === '/contents/gallery/catalog.json') || method === 'PATCH') {
          writes++;
          return Response.json({ message: status === 403 ? 'Forbidden' : 'Validation Failed', errors: [{ field: 'author', code: 'missing' }] }, { status });
        }
        if (path === '/contents/gallery/catalog.json?ref=main') return catalogFile(catalog);
        return state.handler(path, method, body);
      }, async () => {
        const response = await publish(mode === 'add' ? imageRequest : { mode, category: 'esterni', id: 'one', order: ['two', 'one'] });
        assert.equal(response.status, 400);
      });
      assert.equal(writes, 1);
    });
  }

  test(`${mode} stops after five rejected writes`, async () => {
    const state = uploadGitHub({ conflicts: Array(5).fill(409) });
    let writes = 0;
    await withGitHub((path, method, body) => {
      if (path === '/contents/gallery/catalog.json?ref=main') return catalogFile(catalog);
      if (method === 'PUT') {
        writes++;
        return Response.json({ message: 'Conflict' }, { status: 409 });
      }
      return state.handler(path, method, body);
    }, async () => {
      const response = await publish(mode === 'add' ? imageRequest : { mode, category: 'esterni', id: 'one', order: ['two', 'one'] });
      assert.equal(response.status, 400);
    });
    assert.equal(mode === 'add' ? state.patches.length : writes, 5);
    if (mode === 'add') assert.equal(state.blobs.length, 2);
  });
}

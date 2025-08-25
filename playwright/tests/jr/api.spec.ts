import { test, expect } from '@playwright/test';

/**
 * API/HTTP checks dasar buat endpoint public (status & content-type),
 * tanpa melakukan aksi perubahan data.
 */
const endpoints = [
  { path: '/', expectCT: /text\/html|charset/i, ok: [200] },
  { path: '/#apaituwbs', expectCT: /text\/html|charset/i, ok: [200] },
  { path: '/page/ruang-lingkup', expectCT: /text\/html|charset/i, ok: [200] },
  { path: '/page/perlindungan-pelapor', expectCT: /text\/html|charset/i, ok: [200] },
  { path: '/page/manual', expectCT: /application\/pdf|octet-stream/i, ok: [200, 206] },
  { path: '/laporan/tambah', expectCT: /text\/html|charset/i, ok: [200, 302] },
  { path: '/register', expectCT: /text\/html|charset/i, ok: [200, 302] },
  { path: '/login', expectCT: /text\/html|charset/i, ok: [200, 302] }
];

test.describe('[JR][@api] Endpoint health check', () => {
  for (const ep of endpoints) {
    test(`GET ${ep.path} → ${ep.ok.join('/')}`, async ({ request, baseURL }) => {
      const url = `${baseURL}${ep.path.startsWith('/') ? ep.path : `/${ep.path}`}`;
      const res = await request.get(url, { failOnStatusCode: false });
      expect(ep.ok).toContain(res.status());
      const ct = res.headers()['content-type'] ?? '';
      expect(ct).toMatch(ep.expectCT);
    });
  }
});

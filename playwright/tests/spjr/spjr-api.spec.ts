import { test, expect } from '@playwright/test';

test.describe('SP Jasa Raharja - API Endpoint Checks', () => {
  const base = 'https://sp-jasaraharja.id';

  async function checkEndpoint(endpoint: string, expectedStatus: number = 200) {
    const res = await fetch(base + endpoint);
    expect(res.status).toBe(expectedStatus);
    return res;
  }

  test('Endpoint /all-news', async () => {
    const res = await checkEndpoint('/all-news');
    expect(await res.text()).toContain('Berita'); // cek minimal ada kata kunci
  });

  test('Endpoint /sejarah', async () => {
    const res = await checkEndpoint('/sejarah');
    expect(await res.text()).toMatch(/Sejarah/i);
  });

  test('Endpoint /visi-misi', async () => {
    const res = await checkEndpoint('/visi-misi');
    expect(await res.text()).toMatch(/Visi/i);
  });

  test('Endpoint /struktur', async () => {
    const res = await checkEndpoint('/struktur');
    expect(await res.text()).toMatch(/Struktur/i);
  });

  test('Endpoint /tugas-fungsi', async () => {
    const res = await checkEndpoint('/tugas-fungsi');
    expect(await res.text()).toMatch(/Tugas/i);
  });

  test('Endpoint /laporan', async () => {
    const res = await checkEndpoint('/laporan');
    expect(await res.text()).toMatch(/Laporan/i);
  });

  test('Endpoint /panduan', async () => {
    const res = await checkEndpoint('/panduan');
    expect(await res.text()).toMatch(/Panduan/i);
  });
});

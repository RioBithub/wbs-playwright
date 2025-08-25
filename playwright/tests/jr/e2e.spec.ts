import { test, expect } from '@playwright/test';

test.describe('[JR][@e2e] Alur publik non-destruktif', () => {
  test('Route proteksi: /laporan/detail → redirect login / Laporan Saya / 404', async ({ page }) => {
    await page.goto('/laporan/detail', { waitUntil: 'domcontentloaded' });
    const url = page.url();

    // 1) Redirect ke login
    if (/\/login/i.test(url)) {
      await expect(page.locator('body')).toContainText(/login|jr-?sso|masuk/i);
      return;
    }

    // 2) Halaman "Laporan Saya"
    const title = await page.title();
    if (/laporan/i.test(title)) {
      await expect(page.locator('h1, h2, h3, .page-title, .title, .breadcrumb')).toContainText(/laporan/i);
      return;
    }

    // 3) 404 / Page Not Found juga dianggap proteksi valid
    await expect(page.locator('body')).toContainText(/not found|halaman tidak ditemukan|page not found/i);
  });

  test('Register halaman terbuka', async ({ page }) => {
    await page.goto('/register');
    await expect(page.locator('body')).toContainText(/register|daftar|buat akun/i);
  });

  test('Login halaman terbuka', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('body')).toContainText(/login|masuk/i);
  });

  test('Reset password: form bisa dikirim (cek feedback)', async ({ page }) => {
    await page.goto('/password/reset');

    const emailInput = page.locator('input[type="email"], input[placeholder*="email" i]').first();
    await expect(emailInput).toBeVisible();
    await emailInput.fill('user@invalid-example.test');

    const submitBtn = page.getByRole('button', { name: /kirim|submit|send|reset/i }).first();
    await submitBtn.scrollIntoViewIfNeeded();
    await submitBtn.click();

    // Cari feedback yang LEBIH spesifik & visible (hindari strict mode)
    const feedback = page.locator(`
      [role="alert"],
      .alert,
      .invalid-feedback,
      .help-block,
      .text-danger,
      .text-success
    `).filter({ hasText: /email|terkirim|periksa|invalid|gagal|reset/i });

    // Toleran: tunggu muncul salah satu indikator teks feedback
    await expect(feedback.first()).toBeVisible({ timeout: 10000 });
  });

  test('Tambah Laporan (Step 1): isi minimal → munculkan validasi reCAPTCHA', async ({ page }) => {
    await page.goto('/laporan/tambah', { waitUntil: 'domcontentloaded' });

    // Tanggal (opsional jika ada)
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const yyyy = String(today.getFullYear());
    const dateStr = `${dd}/${mm}/${yyyy}`;

    const tryFill = async (selector: string, value: string) => {
      const el = page.locator(selector).first();
      if (await el.count()) {
        await el.scrollIntoViewIfNeeded();
        await el.fill(value, { force: true });
      }
    };

    await tryFill('input[name="tanggal"], input[placeholder*="tanggal" i], input[placeholder*="dd/mm/yyyy" i]', dateStr);
    await tryFill('input[name="tempat"], input[placeholder*="tempat" i], input[placeholder*="lokasi" i]', 'Bekasi');
    await tryFill('input[name="judul"], input[placeholder*="judul" i]', 'Uji E2E - Playwright');

    // Deskripsi (textarea / contenteditable)
    const ta = page
      .locator('textarea[name="deskripsi"], textarea[placeholder*="uraian" i], textarea[placeholder*="deskripsi" i]')
      .first();
    const ce = page.locator('[contenteditable="true"], .ql-editor').first();
    if (await ta.count()) {
      await ta.scrollIntoViewIfNeeded();
      await ta.fill('Deskripsi uji otomatis (production-safe).', { force: true });
    } else if (await ce.count()) {
      await ce.scrollIntoViewIfNeeded();
      await ce.click();
      await ce.type('Deskripsi uji otomatis (production-safe).');
    }

    // Cari tombol Next/Lanjut (variasi label)
    const nextCandidates = page.locator(
      [
        'button:has-text("Ke Step 2/2")',
        'button:has-text("Ke Step 2")',
        'button:has-text("Lanjut")',
        'button:has-text("Berikut")',
        'button:has-text("Next")',
        '[role="button"]:has-text("Next")',
      ].join(', ')
    );

    // Jika tombol memang ada di DOM tapi bukan visible, coba expand section dulu
    if (!(await nextCandidates.first().isVisible())) {
      // fallback: tekan Enter untuk submit step 1 (banyak form listen Enter)
      await page.keyboard.press('Enter');
    } else {
      const nextBtn = nextCandidates.first();
      await nextBtn.scrollIntoViewIfNeeded();
      await nextBtn.click({ trial: false });
    }

    // Harus ada indikasi validasi (wajib diisi / captcha / recaptcha)
    await expect(page.locator('body')).toContainText(/wajib|harus diisi|required|captcha|recaptcha|verifikasi/i, {
      timeout: 10000,
    });

    // iframe recaptcha (jika ada)
    const recaptchaFrames = page.locator('iframe[src*="recaptcha"], iframe[title*="recaptcha" i]');
    expect(await recaptchaFrames.count()).toBeGreaterThan(0);
  });

  test('Manual – PDF tersedia', async ({ request }) => {
    const res = await request.get('/page/manual');
    expect([200, 206]).toContain(res.status());
    const ct = res.headers()['content-type'] ?? '';
    expect(ct).toMatch(/application\/pdf|octet-stream/i);
    const buf = await res.body();
    expect(buf.byteLength).toBeGreaterThan(10_000);
  });
});

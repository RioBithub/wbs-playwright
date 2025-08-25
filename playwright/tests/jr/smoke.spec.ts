import { test, expect } from '@playwright/test';

test.describe('[JR][@smoke] Halaman publik dasar', () => {
  test('Home 2xx & memuat kata kunci WBS', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/WBS|Whistle/i);
    await expect(page.locator('body')).toContainText(/WBS|Whistleblowing/i);
  });

  test('Ruang Lingkup dapat diakses & menampilkan judul', async ({ page }) => {
    await page.goto('/page/ruang-lingkup');
    await expect(page.locator('h1, h2, h3, .page-title, .title')).toContainText(/ruang|lingkup/i);
  });

  test('Perlindungan Pelapor dapat diakses & menampilkan judul', async ({ page }) => {
    await page.goto('/page/perlindungan-pelapor');
    await expect(page.locator('h1, h2, h3, .page-title, .title')).toContainText(/perlindungan|pelapor/i);
  });

  test('Anchor "Apa itu WBS?" berfungsi', async ({ page }) => {
    await page.goto('/#apaituwbs');
    await expect(page).toHaveURL(/#apaituwbs$/);
    await expect(page.locator('#apaituwbs, a[name="apaituwbs"]')).toHaveCount(1);
    await expect(page.locator('body')).toContainText(/whistleblowing system/i);
  });

  test('[JR][@smoke] Responsif: navbar dapat diakses di lebar mobile', async ({ page }) => {
  // 1) Paksa viewport mobile (sesuaikan kalau situs pakai breakpoint lain)
  await page.setViewportSize({ width: 375, height: 812 });

  // 2) Buka halaman
  await page.goto('/');

  // 3) Definisikan selector umum untuk container & tombol toggler (BS3/4/5)
  const navCollapse = page.locator(
    '.navbar-collapse, #bs-example-navbar-collapse-1, .collapse.navbar-collapse'
  ).first();

  const toggler = page.locator([
    'button.navbar-toggle',               // BS3
    'button.navbar-toggler',              // BS4/5
    '[data-toggle="collapse"][data-target*="navbar"]',     // BS3 attr
    '[data-bs-toggle="collapse"][data-bs-target*="navbar"]'// BS5 attr
  ].join(', ')).first();

  // 4) Pastikan tombol toggler terlihat di mobile
  await expect(toggler, 'Tombol toggler harus terlihat di lebar mobile').toBeVisible();

  // 5) Klik toggler untuk membuka menu
  await toggler.click();

  // 6) Tunggu transisi: BS4/5 pakai class .show, BS3 pakai .in.
  const opened = navCollapse.filter({ has: page.locator('.navbar-nav, ul, a') });
  await Promise.race([
    page.waitForSelector('.navbar-collapse.show, .navbar-collapse.in', { state: 'attached', timeout: 1500 }).catch(() => {}),
    page.waitForTimeout(400) // fallback untuk tema tanpa class transisi
  ]);

  // 7) Validasi: container terlihat ATAU minimal 1 link nav terlihat
  // (beberapa tema pakai offcanvas/positioning unik, jadi kita cek link juga)
  const anyLink = opened.locator('a[href]:visible');
  const visibleCount = await anyLink.count();

  if (visibleCount === 0) {
    // Kalau link belum terdeteksi visible, cek computed style dari container
    const isActuallyVisible = await navCollapse.evaluate((el) => {
      const s = window.getComputedStyle(el as HTMLElement);
      const rect = (el as HTMLElement).getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && rect.height > 0 && rect.width > 0;
    });

    expect(
      isActuallyVisible,
      'Navbar collapse tidak tampak visible dan tidak ada link yang terlihat setelah klik toggler.'
    ).toBeTruthy();
  } else {
    // Minimal ada 1 link nav yang kelihatan
    expect(visibleCount).toBeGreaterThan(0);
  }
});
});

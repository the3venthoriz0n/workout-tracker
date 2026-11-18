// Sets the colour scheme on <html> before first paint, so there is no light flash in dark mode.
// Plain script (the CSP allows same-origin scripts only). Keep the logic in step with src/lib/theme-pref.ts.
;(function () {
  var scheme = 'light'
  try {
    var pref = localStorage.getItem('wt.theme')
    scheme = pref === 'dark' || pref === 'color' ? pref : pref !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } catch (e) {}
  document.documentElement.setAttribute('data-theme', scheme)
  var meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', ({ light: '#eceff3', dark: '#090f15', color: '#eaf1fe' })[scheme])
})()

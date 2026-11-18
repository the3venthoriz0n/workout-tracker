// Sets the colour scheme on <html> before first paint, so there is no light flash in dark mode.
// Plain script (the CSP allows same-origin scripts only). Keep the logic in step with src/lib/theme-pref.ts.
;(function () {
  var dark = false
  try {
    var pref = localStorage.getItem('wt.theme')
    dark = pref === 'dark' || (pref !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches)
  } catch (e) {}
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
  var meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', dark ? '#090f15' : '#fdfcfc')
})()

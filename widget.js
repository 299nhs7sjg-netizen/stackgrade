/* StackGrade embeddable widget. Usage:
   <script src="https://299nhs7sjg-netizen.github.io/stackgrade/widget.js" data-agency="Your Agency" data-color="0f172a" async></script>
   Compact by default (grade + top 5 problems); add data-mode="full" for the full report.
   Agency Kit (white-label): data-license="<Gumroad license key>" data-config="<token from the agency-widget builder>".
   These go in the iframe URL hash (#), which browsers never send to the web server. The widget checks the key
   with Gumroad's public API once per page load and only then applies the logo/CTA/no "Powered by". There is no
   backend, so this is client-side enforcement only: it can be bypassed by someone editing the page. */
(function () {
  var ORIGIN = 'https://299nhs7sjg-netizen.github.io';
  var BASE = ORIGIN + '/stackgrade/widget/';
  var s = document.currentScript || (function () { var a = document.querySelectorAll('script[src*="stackgrade/widget.js"]'); return a[a.length - 1]; })();
  if (!s || s.getAttribute('data-sg-done')) return;
  s.setAttribute('data-sg-done', '1');
  var q = [];
  var agency = (s.getAttribute('data-agency') || '').slice(0, 60);
  var color = s.getAttribute('data-color') || '';
  var domain = s.getAttribute('data-domain') || '';
  if (agency) q.push('agency=' + encodeURIComponent(agency));
  if (/^[0-9a-fA-F]{6}$/.test(color)) q.push('color=' + color);
  if (domain) q.push('d=' + encodeURIComponent(domain));
  if ((s.getAttribute('data-mode') || '').toLowerCase() === 'full') q.push('mode=full');
  var lic = (s.getAttribute('data-license') || '').trim();
  var cfg = (s.getAttribute('data-config') || '').trim();
  var hash = lic && cfg ? '#lic=' + encodeURIComponent(lic) + '&cfg=' + encodeURIComponent(cfg) : '';
  var f = document.createElement('iframe');
  f.src = BASE + (q.length ? '?' + q.join('&') : '') + hash;
  f.title = hash ? 'Website & email health check' : 'Website & email health check (StackGrade)';
  f.loading = 'lazy';
  f.style.cssText = 'width:100%;max-width:760px;height:420px;border:0;display:block;margin:0 auto;color-scheme:light';
  s.parentNode.insertBefore(f, s.nextSibling);
  window.addEventListener('message', function (e) {
    if (e.origin !== ORIGIN || e.source !== f.contentWindow || !e.data || e.data.type !== 'stackgrade:height') return;
    var h = Math.max(300, Math.min(20000, Number(e.data.height) || 0));
    f.style.height = h + 'px';
  });
})();

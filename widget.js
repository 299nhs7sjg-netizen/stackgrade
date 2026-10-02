/* StackGrade embeddable widget v0. Usage:
   <script src="https://299nhs7sjg-netizen.github.io/stackgrade/widget.js" data-agency="Your Agency" data-color="0f172a" async></script>
   Compact by default (grade + top 5 problems); add data-mode="full" for the full report. */
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
  var f = document.createElement('iframe');
  f.src = BASE + (q.length ? '?' + q.join('&') : '');
  f.title = 'Website & email health check (StackGrade)';
  f.loading = 'lazy';
  f.style.cssText = 'width:100%;max-width:760px;height:420px;border:0;display:block;margin:0 auto;color-scheme:light';
  s.parentNode.insertBefore(f, s.nextSibling);
  window.addEventListener('message', function (e) {
    if (e.origin !== ORIGIN || e.source !== f.contentWindow || !e.data || e.data.type !== 'stackgrade:height') return;
    var h = Math.max(300, Math.min(20000, Number(e.data.height) || 0));
    f.style.height = h + 'px';
  });
})();

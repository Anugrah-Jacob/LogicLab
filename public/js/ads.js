/**
 * Ad readiness stub. It does nothing while LOGICLAB_CONFIG.ads.enabled is false (the default).
 * Ads are only ever placed on the static learn pages, never inside the editor.
 * Each slot is an element like <aside class="ad-slot" data-ad-slot="learn-top" hidden></aside> with a reserved
 * height in CSS so that adding ads later cannot shift the page layout.
 */
(function () {
  'use strict';
  var cfg = (window.LOGICLAB_CONFIG || {}).ads;
  var slots = document.querySelectorAll('[data-ad-slot]');
  if (!cfg || !cfg.enabled || !cfg.client || !slots.length || !cfg.consent()) return;
  var s = document.createElement('script');
  s.async = true;
  s.crossOrigin = 'anonymous';
  s.src =
    'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(cfg.client);
  document.head.appendChild(s);
  slots.forEach(function (el) {
    var id = cfg.slots[el.getAttribute('data-ad-slot')];
    if (!id) return;
    el.hidden = false;
    el.innerHTML =
      '<ins class="adsbygoogle" style="display:block" data-ad-client="' +
      cfg.client +
      '" data-ad-slot="' +
      id +
      '" data-ad-format="auto" data-full-width-responsive="true"></ins>';
    (window.adsbygoogle = window.adsbygoogle || []).push({});
  });
})();

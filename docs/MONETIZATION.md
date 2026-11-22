# Advertising readiness (off by default)

LogicLab ships with no ads and no tracking. The groundwork is in place so you can add ads later without hurting
the app or search rankings.

- Ads are only meant for the static pages in `public/learn/`, never the editor.
- Each learn page has two reserved slots (`data-ad-slot="learn-top"` and `"learn-bottom"`). They are hidden and have no
  height until ads are enabled, and a fixed minimum height afterwards, so the layout never jumps.
- `public/js/ads.js` does nothing unless `LOGICLAB_CONFIG.ads.enabled` is true, a client id is set, and `ads.consent()` returns true.

To turn ads on

1. Join an ad network and get your client id and slot ids.
2. Put them in `public/js/config.js` and set `enabled: true`.
3. Add a cookie-consent banner that sets what `consent()` returns (required in many regions).
4. Allow the ad network in the Content-Security-Policy in `public/_headers` (script, frame and image sources).
5. Put your publisher line in `public/ads.txt`.
6. Run `npm run build`, `npm test`, and check PageSpeed Insights.

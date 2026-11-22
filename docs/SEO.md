# Search, answer engines and performance

What is already in place

- A fast first load: scripts are `defer`red, files are cached for a year and versioned, and thumbnails load lazily with width and height set.
- `index.html`: one `h1`, title and description, canonical URL, Open Graph and Twitter cards, `WebApplication` and `FAQPage` structured data
  (the FAQ markup matches the questions shown on the page).
- `public/learn/`: one static page per topic with an answer-first opening paragraph, boolean expressions, a truth table,
  breadcrumbs, `Article` and `BreadcrumbList` structured data, and links back to the simulator and to related guides.
- `sitemap.xml`, `robots.txt` (the API is excluded), `llms.txt` (a plain summary for AI crawlers), a manifest and icons.

Checklist when you publish

1. Run `SITE_URL=https://your-domain.com npm run build` (or set `SITE_URL` in your Pages build settings). Until you do, the canonical URLs use the placeholder `https://logiclab.example`.
2. Add the site to Google Search Console and Bing Webmaster Tools and submit `/sitemap.xml`.
3. Test a few pages in the Rich Results Test and PageSpeed Insights.
4. Add real content over time: every example that has a `learn` block becomes a guide page. Write for the question a student would type, and answer it in the first sentence.

Keep it healthy

- Never put ads or popups inside the editor, and keep ad slots at a fixed height (see `docs/MONETIZATION.md`).
- Do not change URLs of published guides; add redirects in `public/_redirects` if you must.
- `npm test` fails if a page loses its canonical URL, structured data or sitemap entry.

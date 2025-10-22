import { PlaywrightCrawler, RequestQueue, Dataset } from 'crawlee';
import fs from 'fs';

const startUrls = ['https://www.visitlondon.com/things-to-do'];

const run = async () => {
  const requestQueue = await RequestQueue.open();

  // Add initial URLs with depth info
  for (const url of startUrls) {
    await requestQueue.addRequest({ url, userData: { depth: 0 } });
  }

  const crawler = new PlaywrightCrawler({
    requestQueue,
    requestHandlerTimeoutSecs: 60,
    navigationTimeoutSecs: 30,
    maxConcurrency: 3,

    launchContext: {
      launchOptions: {
        headless: true,
        ignoreHTTPSErrors: true,
      },
    },

    async requestHandler({ page, request, enqueueLinks, log }) {
      const depth = request.userData.depth ?? 0;
      log.info(`🌐 Crawling: ${request.url} (depth: ${depth})`);

      try {
        await page.waitForLoadState('networkidle', { timeout: 15000 });
      } catch {
        log.warning(`⚠️ Timeout while loading ${request.url}`);
      }

      // Remove unnecessary UI elements
      await page.addStyleTag({
        content: `
          nav, footer, script, style, noscript, svg,
          img[src^='data:'], [role="alert"], [role="banner"],
          [role="dialog"], [role="alertdialog"],
          [aria-modal="true"] { display: none !important; }
        `,
      });

      // Extract clean data
      const data = await page.evaluate(() => {
        const title =
          document.querySelector('h1,h2,h3')?.innerText ||
          document.title ||
          '';
        const description =
          document.querySelector('meta[name="description"]')?.content || '';
        const text = Array.from(document.querySelectorAll('p'))
          .map(p => p.innerText.trim())
          .filter(Boolean)
          .slice(0, 20)
          .join('\n\n');
        return { title, description, text };
      });

      await Dataset.pushData({
        url: request.url,
        ...data,
      });

      // Crawl deeper pages up to depth 3
      if (depth < 3) {
        await enqueueLinks({
          globs: ['https://www.visitlondon.com/things-to-do/**'],
          requestQueue,
          transformRequestFunction: req => {
            req.userData = { depth: depth + 1 };
            return req;
          },
        });
      }
    },
  });

  await crawler.run();

  // Combine all dataset entries into a single JSON file
  const dataset = await Dataset.open('default');
  const { items } = await dataset.getData();

  // Keep only the desired fields
  const cleaned = items.map(({ url, title, description, text }) => ({
    url,
    title,
    description,
    text,
  }));

  fs.writeFileSync('./results.json', JSON.stringify(cleaned, null, 2));
  console.log(`✅ Crawl complete. Saved ${cleaned.length} entries to results.json`);
};

await run();

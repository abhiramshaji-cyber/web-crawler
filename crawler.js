import { PlaywrightCrawler, Dataset, RequestQueue } from 'crawlee';

const startUrls = ['https://www.visitlondon.com/things-to-do'];

const run = async () => {
  // ✅ Explicitly create a request queue
  const requestQueue = await RequestQueue.open();

  // Add the seed URL manually
  for (const url of startUrls) {
    await requestQueue.addRequest({ url, userData: { depth: 0 } });
  }

  const crawler = new PlaywrightCrawler({
    requestQueue, // ✅ attach the queue
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

      await page.waitForLoadState('networkidle');

      // Clean up unnecessary UI
      await page.addStyleTag({
        content: `
          nav, footer, script, style, noscript, svg,
          img[src^='data:'], [role="alert"], [role="banner"],
          [role="dialog"], [role="alertdialog"],
          [aria-modal="true"] { display: none !important; }
        `,
      });

      // Extract info
      const data = await page.evaluate(() => {
        const title = document.querySelector('h1,h2,h3')?.innerText || document.title || '';
        const description = document.querySelector('meta[name="description"]')?.content || '';
        const links = Array.from(document.querySelectorAll('a[href^="https://www.visitlondon.com/things-to-do"]'))
          .map(a => a.href)
          .filter((v, i, arr) => arr.indexOf(v) === i);
        const text = document.body.innerText.slice(0, 2000);
        return { title, description, links, text };
      });

      await Dataset.pushData({
        url: request.url,
        depth,
        ...data,
      });

      // ✅ Recursively enqueue subpages
      if (depth < 3) {
        await enqueueLinks({
          globs: ['https://www.visitlondon.com/things-to-do/**'],
          strategy: 'same-domain',
          requestQueue,
          transformRequestFunction: (req) => {
            req.userData = { depth: depth + 1 };
            return req;
          },
        });
      }
    },
  });

  await crawler.run();
  console.log('✅ Crawl complete. Check ./storage/datasets/default for results.');
};

await run();

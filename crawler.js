import { PlaywrightCrawler, RequestQueue, Dataset } from 'crawlee';
import fs from 'fs';
import os from 'os';

const startUrls = ['https://www.madison.co.uk/'];

const run = async () => {
  const requestQueue = await RequestQueue.open();

  // Add initial URLs with depth info
  for (const url of startUrls) {
    await requestQueue.addRequest({ url, userData: { depth: 0 } });
  }

  // Automatically set concurrency based on CPU cores
  const cpuCores = os.cpus().length;
  const isAppleSilicon = os.cpus()[0].model.includes('Apple');

  // Apple Silicon optimization: Higher multiplier due to efficient P+E core architecture
  const multiplier = isAppleSilicon ? 5 : 3;
  const maxConcurrency = cpuCores * multiplier;
  const minConcurrency = Math.max(1, Math.floor(cpuCores / 2));

  console.log(`🚀 Starting crawler with ${cpuCores} CPU cores (${isAppleSilicon ? 'Apple Silicon' : 'Standard'})`);
  console.log(`📊 Max concurrency: ${maxConcurrency}, Min concurrency: ${minConcurrency}`);

  const crawler = new PlaywrightCrawler({
    requestQueue,
    requestHandlerTimeoutSecs: 60,
    navigationTimeoutSecs: 30,
    maxConcurrency,
    minConcurrency,

    launchContext: {
      launchOptions: {
        headless: true,
        ignoreHTTPSErrors: true,
        args: [
          '--disable-dev-shm-usage',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-images',  // Skip loading images for speed
        ],
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
      if (depth < 4) {
        await enqueueLinks({
          globs: ['https://www.madison.co.uk/**'],
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

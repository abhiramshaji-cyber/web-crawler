import { PlaywrightCrawler, ProxyConfiguration, Dataset } from 'crawlee';

const startUrls = ['https://www.visitlondon.com/things-to-do'];

const crawler = new PlaywrightCrawler({
    // Basic options (matching your JSON)
    requestHandlerTimeoutSecs: 60,
    navigationTimeoutSecs: 30,
    ignoreHttpsErrors: true,
    maxRequestsPerCrawl: 200,
    maxDepth: 3,
    maxConcurrency: 3,
    headless: true,
    proxyConfiguration: new ProxyConfiguration({ useApifyProxy: false }),

    async requestHandler({ page, request, enqueueLinks, log }) {
        log.info(`🌐 Crawling: ${request.url}`);

        // Remove unnecessary elements like navs, footers, etc.
        await page.addStyleTag({
            content: `
                nav, footer, script, style, noscript, svg, 
                img[src^='data:'], [role="alert"], [role="banner"],
                [role="dialog"], [role="alertdialog"], 
                [aria-modal="true"] { display: none !important; }
            `
        });

        // Wait for content
        await page.waitForLoadState('networkidle');

        // Save readable text and links
        const text = await page.evaluate(() => document.body.innerText);
        await Dataset.pushData({
            url: request.url,
            text: text.slice(0, 2000), // truncate to avoid massive files
        });

        // Enqueue all sublinks under /things-to-do
        await enqueueLinks({
            globs: ['https://www.visitlondon.com/things-to-do**'],
            label: 'subpage',
        });
    },
});

await crawler.run(startUrls);

console.log('✅ Crawl complete. Check ./storage/datasets/default for results.');

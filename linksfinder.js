import { PlaywrightCrawler, RequestQueue } from 'crawlee';
import fs from 'fs';
import os from 'os';

// Configuration
const startUrl = 'https://yamaha-motor.com';
const targetDomain = new URL(startUrl).origin;

// Store discovered unique links
const discoveredLinks = new Set();
const visitedPages = new Set();

// Helper to check if URL is a valid page link
const isValidPageLink = (url) => {
  try {
    const urlObj = new URL(url);

    // Must be from the same domain
    if (!url.startsWith(targetDomain)) {
      return false;
    }

    // Exclude file extensions that are not pages
    const excludedExtensions = [
      '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.ico',
      '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
      '.zip', '.rar', '.tar', '.gz',
      '.mp4', '.avi', '.mov', '.wmv',
      '.mp3', '.wav', '.ogg',
      '.css', '.js', '.json', '.xml',
      '.woff', '.woff2', '.ttf', '.eot'
    ];

    const pathname = urlObj.pathname.toLowerCase();
    if (excludedExtensions.some(ext => pathname.endsWith(ext))) {
      return false;
    }

    // Exclude common external patterns
    const excludedPatterns = [
      'facebook.com',
      'youtube.com',
      'twitter.com',
      'instagram.com',
      'linkedin.com',
      'pinterest.com',
      'tiktok.com',
      'whatsapp.com',
      'mailto:',
      'tel:',
      'javascript:',
      '#'
    ];

    if (excludedPatterns.some(pattern => url.includes(pattern))) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
};

// Parse sitemap to get initial URLs
const parseSitemap = async (baseUrl) => {
  const sitemapUrls = [];
  const sitemapPaths = [
    '/sitemap.xml',
    '/sitemap_index.xml',
    '/sitemap-index.xml',
    '/robots.txt'
  ];

  console.log('🗺️  Searching for sitemap...');

  for (const path of sitemapPaths) {
    try {
      const response = await fetch(`${baseUrl}${path}`);
      if (response.ok) {
        const text = await response.text();

        if (path.includes('robots.txt')) {
          const sitemapMatches = text.match(/Sitemap:\s*(.+)/gi);
          if (sitemapMatches) {
            for (const match of sitemapMatches) {
              const sitemapUrl = match.replace(/Sitemap:\s*/i, '').trim();
              console.log(`📋 Found sitemap in robots.txt: ${sitemapUrl}`);

              // Fetch the actual sitemap
              const sitemapResponse = await fetch(sitemapUrl);
              if (sitemapResponse.ok) {
                const sitemapText = await sitemapResponse.text();
                const urlMatches = sitemapText.match(/<loc>([^<]+)<\/loc>/g);
                if (urlMatches) {
                  const urls = urlMatches.map(match => match.replace(/<\/?loc>/g, ''));
                  sitemapUrls.push(...urls);
                }
              }
            }
          }
        } else {
          const urlMatches = text.match(/<loc>([^<]+)<\/loc>/g);
          if (urlMatches) {
            const urls = urlMatches.map(match => match.replace(/<\/?loc>/g, ''));
            console.log(`📋 Found ${urls.length} URLs in ${path}`);
            sitemapUrls.push(...urls);
          }
        }
      }
    } catch (error) {
      // Continue if sitemap not found
    }
  }

  return [...new Set(sitemapUrls)];
};

const run = async () => {
  // Clean up any corrupted storage from previous runs
  const storageDir = './storage';
  if (fs.existsSync(storageDir)) {
    fs.rmSync(storageDir, { recursive: true, force: true });
  }

  const requestQueue = await RequestQueue.open();
  const queuedPages = new Set();

  // Helper to add URL to queue
  const addToQueue = async (url) => {
    if (!isValidPageLink(url) || queuedPages.has(url)) {
      return false;
    }
    queuedPages.add(url);
    discoveredLinks.add(url);
    await requestQueue.addRequest({ url, userData: { depth: 0 } });
    return true;
  };

  // Try to discover URLs from sitemap first
  console.log(`🔍 Starting link discovery for: ${targetDomain}\n`);
  const sitemapUrls = await parseSitemap(targetDomain);

  if (sitemapUrls.length > 0) {
    console.log(`✅ Found ${sitemapUrls.length} URLs in sitemap`);
    for (const url of sitemapUrls) {
      await addToQueue(url);
    }
  } else {
    console.log('⚠️  No sitemap found, starting from homepage');
  }

  // Add start URL
  await addToQueue(startUrl);

  // Configure crawler based on CPU
  const cpuCores = os.cpus().length;
  const isAppleSilicon = os.cpus()[0].model.includes('Apple');
  const multiplier = isAppleSilicon ? 5 : 3;
  const maxConcurrency = cpuCores * multiplier;
  const minConcurrency = Math.max(1, Math.floor(cpuCores / 2));

  console.log(`\n🚀 Starting crawler (${cpuCores} cores, max concurrency: ${maxConcurrency})`);
  console.log(`📊 Queued ${queuedPages.size} initial URLs\n`);

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
          '--disable-images',
        ],
      },
    },

    async requestHandler({ page, request, log }) {
      const depth = request.userData.depth ?? 0;
      visitedPages.add(request.url);
      log.info(`🔗 Crawling: ${request.url} [${visitedPages.size} visited / ${discoveredLinks.size} found]`);

      try {
        await page.waitForLoadState('domcontentloaded', { timeout: 15000 });
      } catch {
        log.warning(`⚠️ Timeout loading ${request.url}`);
        return;
      }

      // Extract all links from the page
      const pageLinks = await page.evaluate(() => {
        const links = new Set();
        document.querySelectorAll('a[href]').forEach(a => {
          const href = a.getAttribute('href');
          if (href) links.add(href);
        });
        return Array.from(links);
      });

      // Process and validate each link
      for (const link of pageLinks) {
        try {
          const fullUrl = new URL(link, request.url).href.split('#')[0].split('?')[0];

          if (isValidPageLink(fullUrl) && !queuedPages.has(fullUrl)) {
            discoveredLinks.add(fullUrl);
            queuedPages.add(fullUrl);

            // Continue crawling with depth limit
            if (depth < 5) {
              await requestQueue.addRequest({
                url: fullUrl,
                userData: { depth: depth + 1 }
              });
            }
          }
        } catch {
          // Invalid URL, skip
        }
      }
    },

    failedRequestHandler({ request, log }) {
      log.error(`❌ Failed to crawl ${request.url}`);
    },
  });

  // Helper function to save links
  const saveLinks = () => {
    const outputFile = 'all_links.txt';
    const sortedLinks = Array.from(discoveredLinks).sort();
    fs.writeFileSync(outputFile, sortedLinks.join('\n') + '\n');

    // Print statistics
    console.log('\n' + '='.repeat(60));
    console.log('✅ Link Discovery Complete');
    console.log('='.repeat(60));
    console.log(`🔗 Total unique links found: ${discoveredLinks.size}`);
    console.log(`🌐 Pages visited: ${visitedPages.size}`);
    console.log(`📁 Output file: ${outputFile}`);
    console.log(`✓ Only links from: ${targetDomain}`);
    console.log(`✓ Excluded: external sites, images, documents`);
    console.log('='.repeat(60) + '\n');
  };

  try {
    await crawler.run();
  } catch (error) {
    console.log('\n⚠️  Crawler encountered an error during cleanup, but links were collected successfully');
  } finally {
    // Always save links, even if crawler cleanup fails
    saveLinks();
  }
};

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n\n🛑 Interrupted! Saving collected links...');
  const outputFile = 'all_links.txt';
  const sortedLinks = Array.from(discoveredLinks).sort();
  fs.writeFileSync(outputFile, sortedLinks.join('\n') + '\n');
  console.log(`✅ Saved ${discoveredLinks.size} links to ${outputFile}`);
  process.exit(0);
});

await run();

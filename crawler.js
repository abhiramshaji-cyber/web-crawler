import { PlaywrightCrawler, RequestQueue, Dataset } from 'crawlee';
import fs from 'fs';
import os from 'os';

const startUrls = ['https://yamaha-motor.com.mx/'];

// Track discovered pages
const discoveredPages = new Set();
const visitedPages = new Set();
const queuedPages = new Set(); // Track URLs added to request queue to prevent duplicates

// Extract base domain for filtering
const getBaseDomain = (url) => {
  try {
    const urlObj = new URL(url);
    return `${urlObj.protocol}//${urlObj.hostname}`;
  } catch {
    return null;
  }
};

// Try to parse sitemap.xml for initial URL discovery
const parseSitemap = async (baseUrl) => {
  const sitemapUrls = [];
  const sitemapPaths = [
    '/sitemap.xml',
    '/sitemap_index.xml',
    '/sitemap-index.xml',
    '/robots.txt'
  ];

  console.log('🗺️  Attempting to discover sitemap...');

  for (const path of sitemapPaths) {
    try {
      const response = await fetch(`${baseUrl}${path}`);
      if (response.ok) {
        const text = await response.text();

        if (path.includes('robots.txt')) {
          // Extract sitemap URLs from robots.txt
          const sitemapMatches = text.match(/Sitemap:\s*(.+)/gi);
          if (sitemapMatches) {
            for (const match of sitemapMatches) {
              const sitemapUrl = match.replace(/Sitemap:\s*/i, '').trim();
              console.log(`📋 Found sitemap in robots.txt: ${sitemapUrl}`);
              sitemapUrls.push(sitemapUrl);
            }
          }
        } else {
          // Parse XML sitemap
          const urlMatches = text.match(/<loc>([^<]+)<\/loc>/g);
          if (urlMatches) {
            const urls = urlMatches.map(match => match.replace(/<\/?loc>/g, ''));
            console.log(`📋 Found ${urls.length} URLs in ${path}`);
            sitemapUrls.push(...urls);
          }
        }
      }
    } catch (error) {
      // Silently continue if sitemap not found
    }
  }

  return [...new Set(sitemapUrls)];
};

const run = async () => {
  const requestQueue = await RequestQueue.open();

  const targetDomain = 'https://yamaha-motor.com.mx/';
  const excludedPaths = ['/ar'];

  // Helper function to check if URL is allowed (not in excluded paths)
  const isAllowedUrl = (url) => {
    // Must start with target domain
    if (!url.startsWith(targetDomain)) {
      return false;
    }
    // Must not contain any excluded paths
    return !excludedPaths.some(path => url.includes(path));
  };

  // Helper function to validate and add URL to queue (prevents duplicates)
  const addToQueue = async (url, userData) => {
    // Ensure URL matches allowed patterns
    if (!isAllowedUrl(url)) {
      return false;
    }

    // Check if already queued
    if (queuedPages.has(url)) {
      return false;
    }

    queuedPages.add(url);
    discoveredPages.add(url);
    await requestQueue.addRequest({ url, userData });
    return true;
  };

  // Try to discover URLs from sitemap first
  const baseDomain = getBaseDomain(startUrls[0]);
  if (baseDomain) {
    const sitemapUrls = await parseSitemap(baseDomain);
    for (const url of sitemapUrls) {
      await addToQueue(url, { depth: 0, source: 'sitemap' });
    }
  }

  // Add initial URLs with depth info
  for (const url of startUrls) {
    await addToQueue(url, { depth: 0, source: 'start' });
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
  console.log(`✅ Crawling: https://yamaha-motor.com.mx/ (all pages)`);
  console.log(`❌ Excluding: /ar`);
  console.log(`📋 Queued ${queuedPages.size} unique pages from sitemap\n`);

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
      visitedPages.add(request.url);
      log.info(`🌐 Crawling: ${request.url} (depth: ${depth}) [${visitedPages.size} visited / ${queuedPages.size} queued / ${discoveredPages.size} discovered]`);

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

      // Extract all links from the page for comprehensive discovery
      const foundLinks = await page.evaluate(() => {
        const links = new Set();
        // Get all anchor tags
        document.querySelectorAll('a[href]').forEach(a => {
          const href = a.getAttribute('href');
          if (href) links.add(href);
        });
        // Get links from buttons with onclick handlers that might contain URLs
        document.querySelectorAll('button[onclick], [data-href], [data-url]').forEach(el => {
          const dataHref = el.getAttribute('data-href') || el.getAttribute('data-url');
          if (dataHref) links.add(dataHref);
        });
        return Array.from(links);
      });

      // Track all discovered links
      foundLinks.forEach(link => {
        try {
          const fullUrl = new URL(link, request.url).href;
          discoveredPages.add(fullUrl);
        } catch {
          // Invalid URL, skip
        }
      });

      // Extract comprehensive data including all text and images
      const data = await page.evaluate(() => {
        const title =
          document.querySelector('h1,h2,h3')?.innerText ||
          document.title ||
          '';
        const description =
          document.querySelector('meta[name="description"]')?.content || '';

        // Remove navigation, footer, and sidebar elements completely
        const excludeSelectors = [
          'nav', 'footer', 'header',
          '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
          '.nav', '.navigation', '.menu', '.footer', '.header', '.sidebar',
          '#nav', '#navigation', '#menu', '#footer', '#header', '#sidebar',
          '.widget', '.related', '.comments', '.social', '.share'
        ];

        excludeSelectors.forEach(selector => {
          document.querySelectorAll(selector).forEach(el => el.remove());
        });

        // Try to find main content area
        let mainContent = document.querySelector('main, article, [role="main"], .content, .main, #content, #main');
        if (!mainContent) {
          mainContent = document.body;
        }

        // Extract only h1 and h2 from main content
        const headings = Array.from(mainContent.querySelectorAll('h1, h2'))
          .map(h => ({ type: h.tagName.toLowerCase(), text: h.innerText.trim() }))
          .filter(h => h.text && h.text.length > 5 && h.text.length < 200);

        // Extract paragraphs from main content only
        const paragraphs = Array.from(mainContent.querySelectorAll('p'))
          .map(p => p.innerText.trim())
          .filter(text => text && text.length > 20) // Filter short paragraphs
          .filter((text, index, arr) => arr.indexOf(text) === index); // Remove duplicates

        // Extract all image URLs from main content
        const images = [];

        mainContent.querySelectorAll('img').forEach(img => {
          const src = img.src || img.getAttribute('src');
          const alt = img.alt || '';
          const dataSrc = img.getAttribute('data-src');

          if (src && src.startsWith('http')) {
            images.push({ src, alt, type: 'img' });
          }
          if (dataSrc && dataSrc.startsWith('http')) {
            images.push({ src: dataSrc, alt, type: 'img-lazy' });
          }

          // Get srcset images
          const srcset = img.getAttribute('srcset');
          if (srcset) {
            srcset.split(',').forEach(entry => {
              const url = entry.trim().split(' ')[0];
              if (url && url.startsWith('http')) {
                images.push({ src: url, alt, type: 'img-srcset' });
              }
            });
          }
        });

        // Get background images from main content
        mainContent.querySelectorAll('*').forEach(el => {
          const style = window.getComputedStyle(el);
          const bgImage = style.backgroundImage;
          if (bgImage && bgImage !== 'none') {
            const urlMatch = bgImage.match(/url\(['"]?([^'"]+)['"]?\)/);
            if (urlMatch && urlMatch[1] && urlMatch[1].startsWith('http')) {
              images.push({ src: urlMatch[1], alt: '', type: 'background' });
            }
          }
        });

        // Remove duplicate images
        const uniqueImages = Array.from(
          new Map(images.map(img => [img.src, img])).values()
        );

        return {
          title,
          description,
          headings,
          paragraphs,
          images: uniqueImages
        };
      });

      await Dataset.pushData({
        url: request.url,
        depth,
        ...data,
      });

      // Continue crawling - increased depth limit to ensure we find all pages
      if (depth < 10) {
        await enqueueLinks({
          globs: ['https://yamaha-motor.com.mx/**'],
          exclude: [],
          requestQueue,
          transformRequestFunction: req => {
            // Skip if already queued or doesn't match allowed patterns
            if (queuedPages.has(req.url) || !isAllowedUrl(req.url)) {
              return false;
            }
            queuedPages.add(req.url);
            req.userData = { depth: depth + 1, source: 'crawl' };
            return req;
          },
        });
      }
    },
  });

  await crawler.run();

  // Create output directory for text files
  const outputDir = './pages';
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Get all dataset entries
  const dataset = await Dataset.open('default');
  const { items } = await dataset.getData();

  // Sanitize filename
  const sanitizeFilename = (name) => {
    return name
      .replace(/[^a-z0-9]/gi, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .substring(0, 100);
  };

  // Save each page as a separate text file
  let fileCount = 0;
  items.forEach((item, index) => {
    const { url, title, headings, paragraphs, images } = item;

    // Skip pages with no meaningful content
    if ((!paragraphs || paragraphs.length === 0) && (!headings || headings.length === 0)) {
      return;
    }

    // Get h1 heading or use title as filename
    let filename = 'untitled';
    if (headings && headings.length > 0) {
      const h1 = headings.find(h => h.type === 'h1');
      if (h1) {
        filename = sanitizeFilename(h1.text);
      }
    }
    if (filename === 'untitled' && title) {
      filename = sanitizeFilename(title);
    }

    // Add index to prevent duplicate filenames
    const finalFilename = `${filename}_${index + 1}.txt`;

    // Build content
    let content = '';

    // Add title/headings
    if (headings && headings.length > 0) {
      headings.forEach(h => {
        if (h.type === 'h1') {
          content += `${h.text}\n`;
          content += `${'='.repeat(h.text.length)}\n\n`;
        } else if (h.type === 'h2') {
          content += `${h.text}\n`;
          content += `${'-'.repeat(h.text.length)}\n\n`;
        }
      });
    }

    // Add paragraphs
    if (paragraphs && paragraphs.length > 0) {
      content += paragraphs.join('\n\n');
      content += '\n\n';
    }

    // Add images
    if (images && images.length > 0) {
      content += `\n${'='.repeat(50)}\n`;
      content += `IMAGES (${images.length}):\n`;
      content += `${'='.repeat(50)}\n`;
      images.forEach(img => {
        content += `${img.src}\n`;
        if (img.alt) {
          content += `Alt: ${img.alt}\n`;
        }
        content += '\n';
      });
    }

    // Add URL at the bottom
    content += `\n${'='.repeat(50)}\n`;
    content += `Source: ${url}\n`;

    // Write file
    fs.writeFileSync(`${outputDir}/${finalFilename}`, content);
    fileCount++;
  });

  // Print comprehensive statistics
  console.log('\n' + '='.repeat(60));
  console.log('✅ Crawl Complete - Summary:');
  console.log('='.repeat(60));
  console.log(`📊 Total pages visited: ${visitedPages.size}`);
  console.log(`🔗 Total pages queued: ${queuedPages.size}`);
  console.log(`🔍 Total pages discovered: ${discoveredPages.size}`);
  console.log(`✓ All URLs are from: https://yamaha-motor.com.mx/`);
  console.log(`✓ Excluded: /ar`);
  console.log(`\n📁 Output:`);
  console.log(`   • Created ${fileCount} text files in ./pages/`);
  console.log(`   • Each file contains: headings, paragraphs, lists, and image URLs`);
  console.log('='.repeat(60) + '\n');
};

await run();

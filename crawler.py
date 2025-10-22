from playwright.sync_api import sync_playwright
from urllib.parse import urljoin
import time, json

base_url = "https://www.visitlondon.com"
start_path = "/things-to-do"
visited = set()
to_visit = {urljoin(base_url, start_path)}
all_links = []
max_depth = 3

def crawl(url, depth, page):
    if depth > max_depth or url in visited:
        return
    visited.add(url)
    print(f"Crawling ({depth}): {url}")
    page.goto(url, wait_until="networkidle", timeout=60000)
    time.sleep(1)
    # Extract links
    anchors = page.query_selector_all("a")
    for a in anchors:
        href = a.get_attribute("href")
        if href:
            full_url = urljoin(base_url, href)
            if full_url.startswith(base_url + start_path):
                all_links.append({"from": url, "to": full_url})
                crawl(full_url, depth + 1, page)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    crawl(urljoin(base_url, start_path), 1, page)
    browser.close()

# Save to file
with open("visitlondon_links.json", "w", encoding="utf-8") as f:
    json.dump(all_links, f, indent=2)

print(f"✅ Done. Found {len(all_links)} links.")

import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse
import pandas as pd
from tqdm import tqdm

def get_links_and_descriptions(base_url, max_pages=50):
    visited = set()
    data = []
    to_visit = [base_url]

    while to_visit and len(visited) < max_pages:
        url = to_visit.pop()
        if url in visited:
            continue
        visited.add(url)

        try:
            res = requests.get(url, timeout=10)
            if 'text/html' not in res.headers.get('Content-Type', ''):
                continue

            soup = BeautifulSoup(res.text, 'html.parser')
            # Get meta description
            desc_tag = soup.find('meta', attrs={'name': 'description'})
            description = desc_tag['content'].strip() if desc_tag else None

            title = soup.title.string.strip() if soup.title else ''
            data.append({'URL': url, 'Title': title, 'Description': description})

            # Find internal links
            for link in soup.find_all('a', href=True):
                href = urljoin(base_url, link['href'])
                if urlparse(href).netloc == urlparse(base_url).netloc:
                    to_visit.append(href)

        except Exception as e:
            print(f"Failed to crawl {url}: {e}")

    return pd.DataFrame(data)

# 🧩 Example usage:
if __name__ == "__main__":
    base_url = "https://www.visitlondon.com/"
    df = get_links_and_descriptions(base_url, max_pages=30)
    df.to_csv("client_links.csv", index=False)
    print("✅ Done! Saved to client_links.csv")

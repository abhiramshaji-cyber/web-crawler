import json
import pandas as pd

# Load JSON file
with open('results.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

# Convert to DataFrame
df = pd.DataFrame(data)

# Export to CSV
df.to_csv('output.csv', index=False, encoding='utf-8')

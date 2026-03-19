
import pandas as pd
import json
import sys

csv_path = '../../brands_with_unique_propositions.csv'
try:
    df = pd.read_csv(csv_path, encoding='latin1')
    # Print columns to verify
    print(f"Columns: {df.columns.tolist()}")
    
    # Check for Plum Insurance
    plum = df[df['ID'] == '@plumhq']
    if plum.empty:
        plum = df[df['ID'] == 'plumhq']
    
    if not plum.empty:
        record = plum.iloc[0]
        print(f"Target: {record['Company']} | Domain: {record['Domain']}")
        
        # Find competitors in same domain
        domain = record['Domain']
        comps = df[df['Domain'] == domain]
        print(f"Total in domain '{domain}': {len(comps)}")
        for _, row in comps.iterrows():
            print(f"- {row['Company']} ({row['ID']})")
    else:
        print("Plum Insurance not found by ID")

    # Check for Yoga Bar etc.
    for brand in ['Yoga Bar', 'SuperYou', 'Open Secret', 'RiteBite']:
        match = df[df['Company'].str.contains(brand, na=False, case=False)]
        if not match.empty:
            r = match.iloc[0]
            print(f"Found {brand}: Domain={r['Domain']}, ID={r['ID']}")
        else:
            print(f"{brand} NOT found")

except Exception as e:
    print(f"Error: {e}")

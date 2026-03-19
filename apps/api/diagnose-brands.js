
const fs = require('fs');
const path = require('path');

function normalizeCompanyName(value) {
    if (!value) return '';
    return value.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim();
}

function loadBrands() {
    const csvPath = path.join(__dirname, '..', '..', 'brands_with_unique_propositions.csv');
    const content = fs.readFileSync(csvPath, 'utf8');
    const lines = content.split('\n');
    const header = lines[0].split(',');
    const brandIdx = header.indexOf('Company');
    const idIdx = header.indexOf('ID');
    const domainIdx = header.indexOf('Domain');
    
    const records = [];
    for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',');
        if (parts.length < 3) continue;
        const brand = parts[brandIdx]?.trim();
        const domain = parts[domainIdx]?.trim();
        if (!brand || !domain) continue;
        records.push({
            brand,
            canonicalBrand: normalizeCompanyName(brand),
            instagramHandle: parts[idIdx]?.trim().replace('@', ''),
            domain
        });
    }
    return records;
}

function findBrand(companyName, handle) {
    const brands = loadBrands();
    const canonicalName = normalizeCompanyName(companyName);
    const normalizedHandle = handle.replace('@', '').trim().toLowerCase();
    
    console.log(`Searching for name: "${canonicalName}", handle: "${normalizedHandle}"`);
    
    const matches = brands.filter(b => 
        b.canonicalBrand === canonicalName || 
        (b.instagramHandle && b.instagramHandle.toLowerCase() === normalizedHandle)
    );
    
    console.log(`Found ${matches.length} matches:`);
    matches.forEach((m, i) => {
        console.log(`${i+1}: Brand="${m.brand}", Domain="${m.domain}", Handle="${m.instagramHandle}"`);
    });
    
    return matches[0] || null;
}

const match = findBrand('Plum Insurance', 'plumhq');
if (match) {
    const brands = loadBrands();
    const comps = brands.filter(b => b.domain === match.domain && b.canonicalBrand !== match.canonicalBrand);
    console.log(`\nCompetitors in same domain (${match.domain}): ${comps.length}`);
    comps.slice(0, 5).forEach(c => console.log(`- ${c.brand} (${c.instagramHandle})`));
}

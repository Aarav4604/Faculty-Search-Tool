import * as cheerio from 'cheerio';

// Simple cache to avoid repeated requests
const publicationCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

export default async function handler(req, res) {
  console.log('→ handler start', req.method, req.query);
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    console.log('← preflight responded');
    return res.status(200).end();
  }
  if (req.method !== 'GET') {
    console.log('← wrong method, bailing');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const scholarId = req.query.scholarId;
    const bypassCache = req.query.bypassCache === 'true';
    console.log('→ scholarId is', scholarId);
    
    if (!scholarId) return res.status(400).json({ error: 'Missing scholarId' });
    
    // Check cache first (unless bypassing)
    const cacheKey = scholarId;
    if (!bypassCache && publicationCache.has(cacheKey)) {
      const cachedData = publicationCache.get(cacheKey);
      if (Date.now() - cachedData.timestamp < CACHE_TTL) {
        console.log('← returning cached publications:', cachedData.data.length);
        return res.status(200).json({ 
          publications: cachedData.data,
          total: cachedData.data.length,
          cached: true
        });
      }
    }
    
    // Use Semantic Scholar API instead of Google Scholar
    // This is more reliable and doesn't have strict blocking measures
    console.log('→ fetching from Semantic Scholar API');
    
    // First search for the author to get their Semantic Scholar ID
    const authorSearchUrl = `https://api.semanticscholar.org/graph/v1/author/search?query=${encodeURIComponent(scholarId)}&fields=authorId,name,affiliations,paperCount,citationCount,hIndex&limit=1`;
    
    const authorResp = await fetch(authorSearchUrl);
    
    if (!authorResp.ok) {
      console.log('← Semantic Scholar author search failed:', authorResp.status);
      return res.status(authorResp.status).json({ 
        error: `Semantic Scholar API request failed with status: ${authorResp.status}`,
        message: 'Try again later'
      });
    }
    
    const authorData = await authorResp.json();
    console.log('← author search results:', JSON.stringify(authorData));
    
    if (!authorData.data || authorData.data.length === 0) {
      return res.status(404).json({ error: 'Author not found on Semantic Scholar' });
    }
    
    const authorId = authorData.data[0].authorId;
    
    // Now get the author's papers
    const papersUrl = `https://api.semanticscholar.org/graph/v1/author/${authorId}/papers?fields=title,abstract,url,venue,year,authors,citationCount,openAccessPdf&limit=100`;
    const papersResp = await fetch(papersUrl);
    
    if (!papersResp.ok) {
      console.log('← Semantic Scholar papers request failed:', papersResp.status);
      return res.status(papersResp.status).json({ 
        error: `Semantic Scholar API request failed with status: ${papersResp.status}`,
        message: 'Try again later'
      });
    }
    
    const papersData = await papersResp.json();
    console.log(`← received ${papersData.data ? papersData.data.length : 0} papers`);
    
    let publications = [];
    
    if (papersData.data && papersData.data.length > 0) {
      publications = papersData.data
        .filter(paper => paper.year >= 2019) // Only include publications from 2019 or later
        .map(paper => ({
          title: paper.title || '',
          link: paper.url || '',
          authors: paper.authors ? paper.authors.map(a => a.name) : [],
          venue: paper.venue || '',
          year: paper.year ? paper.year.toString() : '',
          citedBy: paper.citationCount || 0,
          abstract: paper.abstract || '',
          pdfLink: paper.openAccessPdf ? paper.openAccessPdf.url : null
        }));
    }
    
    console.log('← publications from Semantic Scholar:', publications.length);
    
    // Store in cache
    publicationCache.set(cacheKey, {
      timestamp: Date.now(),
      data: publications
    });
    
    return res.status(200).json({ 
      publications,
      total: publications.length,
      source: 'semantic_scholar'
    });
  } catch (err) {
    console.error('← handler error:', err);
    return res.status(500).json({ error: err.message });
  }
}
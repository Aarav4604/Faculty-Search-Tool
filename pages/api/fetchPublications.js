import * as cheerio from 'cheerio';

// Simple cache - will be reset on serverless function restarts
const publicationCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

export default async function handler(req, res) {
  console.log('→ handler start', req.method, req.query);
  
  // Handle CORS
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  try {
    const scholarId = req.query.scholarId;
    const bypassCache = req.query.bypassCache === 'true';
    console.log('→ scholarId is', scholarId);
    
    if (!scholarId) {
      return res.status(400).json({ error: 'Missing scholarId' });
    }
    
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
    
    // Skip direct Google Scholar altogether and use Serper.dev immediately
    console.log('→ Fetching from Serper.dev directly');
    const publications = await fetchFromSerper(scholarId);
    console.log(`← Retrieved ${publications.length} publications from Serper`);
    
    // Store in cache
    publicationCache.set(cacheKey, {
      timestamp: Date.now(),
      data: publications
    });
    
    return res.status(200).json({ 
      publications,
      total: publications.length,
      source: 'serper'
    });
  } catch (err) {
    console.error('← handler error:', err);
    return res.status(500).json({ error: err.message });
  }
}

async function fetchFromSerper(scholarId) {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    throw new Error('Missing SERPER_API_KEY environment variable');
  }
  
  // Try different query formats to get better results
  // This helps ensure we get the most relevant results
  const queries = [
    `author:${scholarId}`,
    `"user=${scholarId}" site:scholar.google.com`
  ];
  
  let allPublications = [];
  
  // Try each query and combine results
  for (const query of queries) {
    try {
      console.log(`→ Sending Serper query: ${query}`);
      
      const resp = await fetch('https://google.serper.dev/scholar', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': apiKey
        },
        body: JSON.stringify({ 
          q: query,
          num: 100 // Request maximum results
        })
      });
      
      if (!resp.ok) {
        console.log(`Serper query "${query}" failed with status: ${resp.status}`);
        continue; // Try the next query
      }
      
      const json = await resp.json();
      
      if (!json || typeof json !== 'object' || !Array.isArray(json.organic)) {
        console.log(`Invalid or empty response for query "${query}"`);
        continue;
      }
      
      const publications = json.organic
        .map(item => {
          const year = item.year || '';
          const yearNum = parseInt(year, 10);
          
          // Only include publications from 2019 or later
          if (isNaN(yearNum) || yearNum < 2019) return null;
          
          return {
            title: item.title || '',
            link: item.link || '',
            snippet: item.snippet || '',
            authors: item.authors || [],
            venue: item.publicationInfo || '',
            year,
            citedBy: item.citedBy ? parseInt(item.citedBy, 10) : 0
          };
        })
        .filter(item => item !== null);
      
      console.log(`← Query "${query}" returned ${publications.length} publications`);
      allPublications = [...allPublications, ...publications];
      
    } catch (error) {
      console.log(`Error with query "${query}": ${error.message}`);
      // Continue with next query regardless of errors
    }
  }
  
  // Remove duplicates based on title
  const uniquePublications = Array.from(
    new Map(allPublications.map(item => [item.title, item])).values()
  );
  
  console.log(`Found ${uniquePublications.length} unique publications from Serper`);
  
  if (uniquePublications.length === 0) {
    // Return empty array instead of throwing error
    console.log('No publications found via Serper API');
    return [];
  }
  
  return uniquePublications;
}
import * as cheerio from 'cheerio';

// Simple cache to avoid repeated requests
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
    
    // Try direct Google Scholar with an extremely simple approach
    try {
      console.log('→ Attempting simple fetch from Google Scholar');
      const publications = await fetchFromGoogleScholarSimple(scholarId);
      console.log(`← Retrieved ${publications.length} publications`);
      
      // Store in cache
      publicationCache.set(cacheKey, {
        timestamp: Date.now(),
        data: publications
      });
      
      return res.status(200).json({ 
        publications,
        total: publications.length,
        source: 'direct'
      });
    } catch (error) {
      console.error(`← Error fetching from Google Scholar: ${error.message}`);
      
      // Return what we have from Serper if available
      try {
        console.log('→ Falling back to Serper API');
        if (!process.env.SERPER_API_KEY) {
          throw new Error('Missing SERPER_API_KEY');
        }
        
        const publications = await useSerperFallback(scholarId);
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
      } catch (serperError) {
        console.error(`← Serper fallback also failed: ${serperError.message}`);
        
        // If nothing worked, return an empty array but don't throw an error
        return res.status(200).json({ 
          publications: [],
          total: 0,
          error: 'Both direct and fallback methods failed',
          directError: error.message,
          serperError: serperError.message
        });
      }
    }
  } catch (err) {
    console.error('← handler error:', err);
    return res.status(500).json({ error: err.message });
  }
}

async function fetchFromGoogleScholarSimple(scholarId) {
  // This is the most basic approach possible
  const url = `https://scholar.google.com/citations?hl=en&user=${scholarId}&view_op=list_works&sortby=pubdate&pagesize=100`;
  
  // Extremely simple headers - just like a normal browser request
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5'
    }
  });
  
  if (!response.ok) {
    throw new Error(`Google Scholar request failed with status: ${response.status}`);
  }
  
  const html = await response.text();
  
  // Check if we got a captcha page
  if (html.includes('Our systems have detected unusual traffic') || 
      html.includes('recaptcha') ||
      html.includes('robot')) {
    throw new Error('Google Scholar showing captcha or detected automation');
  }
  
  const $ = cheerio.load(html);
  let publications = [];
  
  $('tr.gsc_a_tr').each((_, el) => {
    const title = $('.gsc_a_at', el).text().trim();
    const partialLink = $('.gsc_a_at', el).attr('data-href') || $('.gsc_a_at', el).attr('href');
    const link = partialLink ? 'https://scholar.google.com' + partialLink : '';
    const authors = $('.gs_gray', el).first().text().trim();
    const venueYear = $('.gs_gray', el).last().text().trim() || '';
    const citedBy = $('.gsc_a_ac', el).text().trim();
    
    // Extract year and filter for publications from 2019 or later
    const yearMatch = venueYear.match(/\d{4}/);
    const year = yearMatch ? yearMatch[0] : '';
    const yearNum = parseInt(year, 10);
    
    // Only include publications from 2019 or later
    if (title && yearNum >= 2019) {
      publications.push({
        title,
        link,
        authors: authors.split(',').map(a => a.trim()),
        venue: venueYear.split(',').slice(0, -1).join(',').trim(),
        year,
        citedBy: citedBy && !isNaN(parseInt(citedBy)) ? parseInt(citedBy) : 0
      });
    }
  });
  
  return publications;
}

async function useSerperFallback(scholarId) {
  const apiKey = process.env.SERPER_API_KEY;
  
  if (!apiKey) {
    throw new Error('Missing SERPER_API_KEY');
  }
  
  // Simple query
  const searchQuery = `author:${scholarId}`;
  
  const resp = await fetch('https://google.serper.dev/scholar', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': apiKey
    },
    body: JSON.stringify({ q: searchQuery })
  });
  
  if (!resp.ok) {
    throw new Error(`Serper API request failed with status: ${resp.status}`);
  }
  
  const json = await resp.json();
  
  if (!json || typeof json !== 'object') {
    throw new Error('Invalid response from Serper API');
  }
  
  let publications = [];
  
  if (Array.isArray(json.organic) && json.organic.length) {
    publications = json.organic
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
  }
  
  return publications;
}
import * as cheerio from 'cheerio';

// Use persistent cache with Redis or similar for Vercel serverless environment
// For this example, we'll still use memory cache but with better error handling
const publicationCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

export default async function handler(req, res) {
  console.log('→ handler start', req.method, req.query);
  
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    console.log('← preflight responded');
    return res.status(200).end();
  }
  
  // Method check
  if (req.method !== 'GET') {
    console.log('← wrong method, bailing');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  try {
    const scholarId = req.query.scholarId;
    console.log('→ scholarId is', scholarId);
    
    if (!scholarId) {
      return res.status(400).json({ error: 'Missing scholarId' });
    }
    
    // Check cache first
    const cacheKey = scholarId;
    if (publicationCache.has(cacheKey)) {
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
    
    let publications = [];
    let source = 'direct';
    
    try {
      publications = await fetchFromGoogleScholar(scholarId);
    } catch (error) {
      console.log(`← Error fetching from Google Scholar: ${error.message}`);
      
      // Try the fallback immediately if direct Scholar fails
      try {
        publications = await useSerperFallback(scholarId);
        source = 'serper';
      } catch (serperError) {
        console.error(`← Serper fallback also failed: ${serperError.message}`);
        return res.status(500).json({ 
          error: 'Both direct and fallback methods failed',
          directError: error.message,
          serperError: serperError.message
        });
      }
    }
    
    console.log(`← publications retrieved from ${source}:`, publications.length);
    
    // Store in cache
    publicationCache.set(cacheKey, {
      timestamp: Date.now(),
      data: publications
    });
    
    return res.status(200).json({ 
      publications,
      total: publications.length,
      source
    });
    
  } catch (err) {
    console.error('← handler error:', err);
    return res.status(500).json({ error: err.message });
  }
}

async function fetchFromGoogleScholar(scholarId) {
  // More robust Google Scholar direct fetch with retry mechanism
  const directUrl = `https://scholar.google.com/citations?hl=en&user=${scholarId}&view_op=list_works&sortby=pubdate&pagesize=100`;
  console.log(`→ fetching from Scholar: ${directUrl}`);
  
  const headers = {
    // More realistic user agent
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'sec-ch-ua': '"Google Chrome";v="115", "Chromium";v="115"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
    'Referer': 'https://scholar.google.com/',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin'
  };
  
  const response = await fetch(directUrl, { headers });
  
  if (!response.ok) {
    throw new Error(`Google Scholar request failed with status: ${response.status}`);
  }
  
  const html = await response.text();
  
  // Check if we got a captcha or error page
  if (html.includes('Our systems have detected unusual traffic') || 
      html.includes('recaptcha') ||
      html.includes('robot')) {
    throw new Error('Google Scholar showing captcha or detected automation');
  }
  
  const $ = cheerio.load(html);
  let publications = [];
  
  // Check if we actually got results
  if ($('tr.gsc_a_tr').length === 0) {
    console.log('No publication elements found, might be an error page or format change');
  }
  
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
  console.log('→ SERPER_API_KEY present?', Boolean(apiKey));
  
  if (!apiKey) {
    throw new Error('Missing SERPER_API_KEY');
  }
  
  // Build a better query with author: prefix
  const searchQuery = `author:${scholarId}`;
  console.log('→ falling back to serper.dev with query:', searchQuery);
  
  const resp = await fetch('https://google.serper.dev/scholar', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': apiKey
    },
    body: JSON.stringify({ q: searchQuery, num: 100 }) // Get max results
  });
  
  if (!resp.ok) {
    throw new Error(`Serper API request failed with status: ${resp.status}`);
  }
  
  console.log('← serper.dev status', resp.status);
  const json = await resp.json();
  
  if (!json || typeof json !== 'object') {
    throw new Error('Invalid response from Serper API');
  }
  
  console.log('← got JSON keys:', Object.keys(json));
  
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
    
    console.log('← publications from serper.dev (2019+ only):', publications.length);
  } else {
    console.log('← no results from serper.dev fallback');
  }
  
  return publications;
}
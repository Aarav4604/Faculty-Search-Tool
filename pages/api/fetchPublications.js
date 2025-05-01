import * as cheerio from 'cheerio';

// In-memory cache (would be better with Redis/persistent storage)
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
    console.log('→ scholarId is', scholarId);
    
    if (!scholarId) {
      return res.status(400).json({ error: 'Missing scholarId' });
    }
    
    // Debug parameters
    const method = req.query.method || 'auto';
    const bypassCache = req.query.bypassCache === 'true';
    
    // Check cache first (unless bypassing)
    const cacheKey = scholarId;
    if (!bypassCache && publicationCache.has(cacheKey)) {
      const cachedData = publicationCache.get(cacheKey);
      if (Date.now() - cachedData.timestamp < CACHE_TTL) {
        console.log('← returning cached publications:', cachedData.data.length);
        return res.status(200).json({ 
          publications: cachedData.data,
          total: cachedData.data.length,
          cached: true,
          source: cachedData.source
        });
      }
    }
    
    let publications = [];
    let source = '';
    let errors = [];
    
    // Try different methods based on request or fallback automatically
    if (method === 'direct' || method === 'auto') {
      try {
        console.log('→ Attempting direct Google Scholar fetch');
        publications = await fetchFromGoogleScholarDirect(scholarId);
        source = 'direct';
        console.log(`← Direct method succeeded with ${publications.length} publications`);
      } catch (error) {
        console.log(`← Direct method failed: ${error.message}`);
        errors.push(`Direct: ${error.message}`);
        if (method === 'direct') {
          return res.status(500).json({ error: `Direct method failed: ${error.message}` });
        }
        // Auto mode will continue to other methods
      }
    }
    
    // Try Serper if direct failed or was skipped
    if ((method === 'auto' && publications.length === 0) || method === 'serper') {
      try {
        console.log('→ Attempting Serper API fetch');
        publications = await fetchFromSerper(scholarId);
        source = 'serper';
        console.log(`← Serper method succeeded with ${publications.length} publications`);
      } catch (error) {
        console.log(`← Serper method failed: ${error.message}`);
        errors.push(`Serper: ${error.message}`);
        if (method === 'serper') {
          return res.status(500).json({ error: `Serper method failed: ${error.message}` });
        }
      }
    }
    
    // Try proxy service if available and other methods failed
    if ((method === 'auto' && publications.length === 0) || method === 'proxy') {
      try {
        console.log('→ Attempting proxy service fetch');
        publications = await fetchUsingProxy(scholarId);
        source = 'proxy';
        console.log(`← Proxy method succeeded with ${publications.length} publications`);
      } catch (error) {
        console.log(`← Proxy method failed: ${error.message}`);
        errors.push(`Proxy: ${error.message}`);
        if (method === 'proxy') {
          return res.status(500).json({ error: `Proxy method failed: ${error.message}` });
        }
      }
    }
    
    // If all methods failed or returned no results
    if (publications.length === 0) {
      return res.status(404).json({ 
        error: 'No publications found or all methods failed', 
        methods_tried: method === 'auto' ? ['direct', 'serper', 'proxy'] : [method],
        errors
      });
    }
    
    // Store successful result in cache
    publicationCache.set(cacheKey, {
      timestamp: Date.now(),
      data: publications,
      source
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

async function fetchFromGoogleScholarDirect(scholarId) {
  const directUrl = `https://scholar.google.com/citations?hl=en&user=${scholarId}&view_op=list_works&sortby=pubdate&pagesize=100`;
  
  // These headers are critical for avoiding detection
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'max-age=0',
    'Connection': 'keep-alive',
    'Sec-Ch-Ua': '"Google Chrome";v="113", "Chromium";v="113"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"macOS"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    // The Referer can help make the request look more legitimate
    'Referer': 'https://scholar.google.com/citations?hl=en',
  };

  // The critical part - random delay to avoid detection patterns
  // Sleeping isn't typically available in serverless, but this helps simulate human behavior
  const randomDelay = Math.floor(Math.random() * 1000) + 500; // 500-1500ms delay
  await new Promise(resolve => setTimeout(resolve, randomDelay));
  
  const response = await fetch(directUrl, { 
    headers,
    // Increase timeout to handle potential delays
    signal: AbortSignal.timeout(10000)  
  });
  
  if (!response.ok) {
    throw new Error(`Google Scholar request failed with status: ${response.status}`);
  }
  
  const html = await response.text();
  
  // Log the first part of the response to debug
  console.log('First 200 chars of response:', html.substring(0, 200));
  
  // Check if we got a captcha or error page
  if (html.includes('Our systems have detected unusual traffic') || 
      html.includes('recaptcha') ||
      html.includes('robot') ||
      html.length < 5000) { // If the response is too short, it's probably not the full page
    throw new Error('Google Scholar showing captcha or detected automation');
  }
  
  const $ = cheerio.load(html);
  let publications = [];
  
  // Log what we found to help with debugging
  console.log(`Found ${$('tr.gsc_a_tr').length} publication rows`);
  
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

async function fetchFromSerper(scholarId) {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    throw new Error('Missing SERPER_API_KEY environment variable');
  }
  
  // Try different query formats to get better results
  // This is more robust than a single query format
  const queries = [
    `author:${scholarId}`,
    `"user=${scholarId}" site:scholar.google.com`,
    `inauthor:"${scholarId}" after:2019`
  ];
  
  let allPublications = [];
  
  // Try each query and combine results
  for (const query of queries) {
    try {
      const resp = await fetch('https://google.serper.dev/scholar', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': apiKey
        },
        body: JSON.stringify({ 
          q: query,
          num: 50 // Get as many results as we can
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
    throw new Error('No publications found via Serper API');
  }
  
  return uniquePublications;
}

async function fetchUsingProxy(scholarId) {
  // This uses a different proxy service (ScraperAPI) as a last resort
  const scraperApiKey = process.env.SCRAPER_API_KEY;
  if (!scraperApiKey) {
    throw new Error('Missing SCRAPER_API_KEY environment variable');
  }
  
  const targetUrl = encodeURIComponent(`https://scholar.google.com/citations?hl=en&user=${scholarId}&view_op=list_works&sortby=pubdate&pagesize=100`);
  
  // Customize the proxy options for better results
  const proxyUrl = `http://api.scraperapi.com?api_key=${scraperApiKey}&url=${targetUrl}&render=true&country_code=us&device_type=desktop&premium=true`;
  
  const response = await fetch(proxyUrl, {
    // Increase timeout for proxy service
    signal: AbortSignal.timeout(15000)
  });
  
  if (!response.ok) {
    throw new Error(`Proxy request failed with status: ${response.status}`);
  }
  
  const html = await response.text();
  
  // Check if proxy returned an error page
  if (html.length < 5000 || html.includes('Our systems have detected unusual traffic')) {
    throw new Error('Proxy request returned an error page or insufficient data');
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
  
  if (publications.length === 0) {
    throw new Error('No publications found via proxy service');
  }
  
  return publications;
}
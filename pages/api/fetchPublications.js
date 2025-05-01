import * as cheerio from 'cheerio';

// Memory cache as fallback
const memoryCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Import KV if available, with proper error handling
let kvClient = null;
try {
  // Dynamic import to avoid errors when the module isn't available
  const { kv } = require('@vercel/kv');
  
  // Verify if the KV client actually has the necessary methods
  if (kv && typeof kv.get === 'function' && typeof kv.set === 'function') {
    kvClient = kv;
    console.log('→ Vercel KV initialized successfully');
  } else {
    console.log('→ Vercel KV imported but methods not available, using memory cache');
  }
} catch (error) {
  console.log('→ Vercel KV not available, using memory cache', error.message);
}

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
    const method = req.query.method || 'auto'; // 'direct', 'serper', or 'auto'
    
    console.log('→ scholarId is', scholarId);
    
    if (!scholarId) {
      return res.status(400).json({ error: 'Missing scholarId' });
    }
    
    // Cache handling functionality
    const cacheKey = `scholar:${scholarId}`;
    const getCachedData = async () => {
      if (bypassCache) return null;
      
      try {
        if (kvClient) {
          // Use Vercel KV
          const data = await kvClient.get(cacheKey);
          if (data) {
            console.log('← Retrieved from Vercel KV cache');
            return data;
          }
        } else {
          // Use memory cache
          if (memoryCache.has(cacheKey)) {
            const data = memoryCache.get(cacheKey);
            if (Date.now() - data.timestamp < CACHE_TTL) {
              console.log('← Retrieved from memory cache');
              return data;
            } else {
              // Expired
              memoryCache.delete(cacheKey);
            }
          }
        }
      } catch (error) {
        console.error('← Cache retrieval error:', error.message);
      }
      
      return null;
    };
    
    const setCachedData = async (data) => {
      try {
        if (kvClient) {
          // Use Vercel KV
          const ONE_DAY_IN_SECONDS = 24 * 60 * 60;
          await kvClient.set(cacheKey, data, { ex: ONE_DAY_IN_SECONDS });
          console.log('← Stored in Vercel KV cache');
        } else {
          // Use memory cache
          memoryCache.set(cacheKey, data);
          console.log('← Stored in memory cache');
        }
      } catch (error) {
        console.error('← Cache storage error:', error.message);
      }
    };
    
    // Try to get from cache first
    const cachedData = await getCachedData();
    if (cachedData) {
      console.log('← returning cached publications:', cachedData.publications.length);
      return res.status(200).json({ 
        publications: cachedData.publications,
        total: cachedData.publications.length,
        cached: true,
        cachedAt: cachedData.timestamp,
        cacheType: kvClient ? 'vercel-kv' : 'memory'
      });
    }
    
    // If not in cache, fetch fresh data
    let publications = [];
    let source = '';
    
    // Try methods based on the requested method or auto fallback
    if (method === 'direct' || method === 'auto') {
      try {
        console.log('→ Attempting direct Google Scholar fetch');
        publications = await fetchFromGoogleScholar(scholarId);
        source = 'direct';
        console.log(`← Direct method succeeded with ${publications.length} publications`);
      } catch (error) {
        console.log(`← Direct method failed: ${error.message}`);
        if (method === 'direct') {
          return res.status(500).json({ error: `Direct method failed: ${error.message}` });
        }
        // Auto mode will continue to serper
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
        if (method === 'serper') {
          return res.status(500).json({ error: `Serper method failed: ${error.message}` });
        }
      }
    }
    
    // If both methods failed
    if (publications.length === 0) {
      return res.status(404).json({ 
        error: 'No publications found or all methods failed'
      });
    }
    
    // Store successful result in cache
    const dataToCache = {
      timestamp: Date.now(),
      publications
    };
    
    await setCachedData(dataToCache);
    
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
  // Use a randomized delay to avoid detection patterns (1-3 seconds)
  const randomDelay = Math.floor(Math.random() * 2000) + 1000;
  await new Promise(resolve => setTimeout(resolve, randomDelay));
  
  const directUrl = `https://scholar.google.com/citations?hl=en&user=${scholarId}&view_op=list_works&sortby=pubdate&pagesize=100`;
  console.log(`→ fetching from Scholar: ${directUrl}`);
  
  // Use very simple browser-like headers that don't trigger anti-bot detection
  const directResp = await fetch(directUrl, {
    headers: {
      // Use a common browser user-agent
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml',
      'Accept-Language': 'en-US,en;q=0.9',
      // Referer can help make the request look more legitimate
      'Referer': 'https://scholar.google.com/'
    }
  });
  
  if (!directResp.ok) {
    throw new Error(`Google Scholar request failed with status: ${directResp.status}`);
  }
  
  const html = await directResp.text();
  
  // Check if we got a captcha or error page
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
    const venueYear = $('.gs_gray', el).last().text().trim();
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
  const queries = [
    `author:${scholarId}`,
    `"user=${scholarId}" site:scholar.google.com`
  ];
  
  let allPublications = [];
  
  // Try each query and combine results
  for (const query of queries) {
    try {
      // Add a small delay between queries to avoid rate limiting
      if (queries.indexOf(query) > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
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
  
  return uniquePublications;
}
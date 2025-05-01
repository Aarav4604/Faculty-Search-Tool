import * as cheerio from 'cheerio';

// Simple cache to avoid repeated requests for the same scholar ID
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
    
    // Always go directly to Google Scholar with improved headers
    const directUrl = `https://scholar.google.com/citations?hl=en&user=${scholarId}&view_op=list_works&sortby=pubdate&pagesize=100`;
    console.log(`→ fetching from Scholar: ${directUrl}`);
    
    const directResp = await fetch(directUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'max-age=0'
      },
      redirect: 'follow',
      referrerPolicy: 'strict-origin-when-cross-origin'
    });
    
    if (!directResp.ok) {
      console.log('← direct Scholar request failed:', directResp.status);
      return res.status(directResp.status).json({ 
        error: `Google Scholar request failed with status: ${directResp.status}`,
        message: 'Try again later or use the bypassCache=true parameter to force a fresh request.'
      });
    }
    
    const html = await directResp.text();
    console.log(`← received HTML response of length: ${html.length}`);
    
    // Check for captcha or other detection
    if (html.includes('Our systems have detected unusual traffic') || 
        html.includes('recaptcha') ||
        html.includes('robot') ||
        html.length < 5000) {
      console.log('← Google Scholar is showing a captcha or detected automation');
      return res.status(403).json({ 
        error: 'Google Scholar showing captcha or detected automation',
        message: 'Try again later'
      });
    }
    
    const $ = cheerio.load(html);
    let publications = [];
    
    // Debug: How many rows were found?
    const rowCount = $('tr.gsc_a_tr').length;
    console.log(`← found ${rowCount} publication rows`);
    
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
    
    console.log('← publications scraped from Scholar:', publications.length);
    
    // Store in cache
    publicationCache.set(cacheKey, {
      timestamp: Date.now(),
      data: publications
    });
    
    return res.status(200).json({ 
      publications,
      total: publications.length
    });
  } catch (err) {
    console.error('← handler error:', err);
    return res.status(500).json({ error: err.message });
  }
}
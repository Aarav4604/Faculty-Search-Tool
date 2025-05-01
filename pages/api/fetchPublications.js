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
     console.log('→ scholarId is', scholarId);
     
     if (!scholarId) return res.status(400).json({ error: 'Missing scholarId' });
     
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
     
     // Always go directly to Google Scholar - more reliable than Serper
     const directUrl = `https://scholar.google.com/citations?hl=en&user=${scholarId}&view_op=list_works&sortby=pubdate&pagesize=100`;
     console.log(`→ fetching from Scholar: ${directUrl}`);
     
     const directResp = await fetch(directUrl, {
       headers: {
         'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36',
         'Accept': 'text/html,application/xhtml+xml,application/xml',
         'Accept-Language': 'en-US,en;q=0.9'
       }
     });
     
     if (!directResp.ok) {
       console.log('← direct Scholar request failed:', directResp.status);
       // Fallback to serper.dev only if direct request fails
       return await useSerperFallback(req, res, scholarId);
     }
     
     const html = await directResp.text();
     const $ = cheerio.load(html);
     let publications = [];
     
     $('tr.gsc_a_tr').each((_, el) => {
       const title = $('.gsc_a_at', el).text().trim();
       const partialLink = $('.gsc_a_at', el).attr('data-href') || $('.gsc_a_at', el).attr('href');
       const link = partialLink ? 'https://scholar.google.com' + partialLink : '';
       const authors = $('.gs_gray', el).first().text().trim();
       const venueYear = $('.gs_gray', el).last().text().trim();
       const citedBy = $('.gsc_a_ac', el).text().trim();
       
       if (title) {
         publications.push({
           title,
           link,
           authors: authors.split(',').map(a => a.trim()),
           venue: venueYear.split(',').slice(0, -1).join(',').trim(),
           year: venueYear.match(/\d{4}/) ? venueYear.match(/\d{4}/)[0] : '',
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
 
 async function useSerperFallback(req, res, scholarId) {
   const apiKey = process.env.SERPER_API_KEY;
   console.log('→ SERPER_API_KEY present?', Boolean(apiKey));
   if (!apiKey) throw new Error('Missing SERPER_API_KEY');
   
   // Build a better query with author: prefix
   const searchQuery = `author:${scholarId}`;
   console.log('→ falling back to serper.dev with query:', searchQuery);
   
   const resp = await fetch('https://google.serper.dev/scholar', {
     method: 'POST',
     headers: {
       'Content-Type': 'application/json',
       'X-API-KEY': apiKey
     },
     body: JSON.stringify({ q: searchQuery })
   });
   
   console.log('← serper.dev status', resp.status);
   const json = await resp.json();
   console.log('← got JSON keys:', Object.keys(json));
   
   let publications = [];
   
   if (Array.isArray(json.organic) && json.organic.length) {
     publications = json.organic.map(item => ({
       title: item.title,
       link: item.link,
       snippet: item.snippet || '',
       authors: item.authors || [],
       venue: item.publicationInfo || '',
       year: item.year || '',
       citedBy: item.citedBy ? parseInt(item.citedBy, 10) : 0
     }));
     console.log('← publications from serper.dev:', publications.length);
   } else {
     console.log('← no results from serper.dev fallback');
   }
   
   return res.status(200).json({ 
     publications,
     total: publications.length
   });
 }
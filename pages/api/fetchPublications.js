export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*'); 
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        const scholarId = req.query.scholarId;
        const apiKey = process.env.SCRAPERAPI_KEY; 

        const targetUrl = `https://scholar.google.com/citations?user=${scholarId}&hl=en`;

        // ScraperAPI request
        const response = await fetch(`https://api.scraperapi.com/?api_key=${apiKey}&url=${encodeURIComponent(targetUrl)}`);
        const html = await response.text();

        // You will need to parse the HTML to extract publication data
        const publications = extractPublications(html);

        res.status(200).json({ scholarId, publications });
    } catch (error) {
        console.error("Error fetching publications:", error);
        res.status(500).json({ error: "Error fetching publications" });
    }
}
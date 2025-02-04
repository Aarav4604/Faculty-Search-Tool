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

        if (!apiKey) {
            throw new Error("Missing ScraperAPI Key");
        }

        const targetUrl = `https://scholar.google.com/citations?user=${scholarId}&hl=en`;

        // Fetch with ScraperAPI
        const response = await fetch(`https://api.scraperapi.com/?api_key=${apiKey}&render=true&url=${encodeURIComponent(targetUrl)}`);

        if (!response.ok) {
            throw new Error(`ScraperAPI Error: ${response.status} - ${await response.text()}`);
        }

        const html = await response.text();

        // Extract publications from HTML
        const publications = extractPublications(html);

        res.status(200).json({ scholarId, publications });
    } catch (error) {
        console.error("Error fetching publications:", error.message);
        res.status(500).json({ error: error.message });
    }
}

// Extract publication titles from Google Scholar HTML
function extractPublications(html) {
    const publications = [];
    const regex = /<a href="\/citations\?view_op=view_citation&amp;.*?">(.*?)<\/a>/g;
    let match;

    while ((match = regex.exec(html)) !== null) {
        publications.push({ title: match[1] });
    }

    return publications.length ? publications : [{ title: "No publications found" }];
}



export default async function handler(req, res) {
    // Set CORS headers to allow requests from your frontend origin
    res.setHeader('Access-Control-Allow-Origin', '*'); // Use * to allow all origins or specify your frontend URL for more security
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Handle preflight OPTIONS request
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        const scholarId = req.query.scholarId;
        const apiKey = process.env.SERPAPI_KEY; // Make sure the environment variable is correctly set in Vercel

        const response = await fetch(`https://serpapi.com/search.json?engine=google_scholar_author&author_id=${scholarId}&api_key=${apiKey}&hl=en`);
        const data = await response.json();

        res.status(200).json(data);
    } catch (error) {
        console.error("Error fetching publications:", error);
        res.status(500).json({ error: "Error fetching publications" });
    }
}

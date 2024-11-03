// Import the fetch library (use the native fetch if using Node 18+)
import fetch from 'node-fetch';

export default async function handler(req, res) {
    // Allow requests from any origin
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    // Handle CORS preflight request
    if (req.method === "OPTIONS") {
        return res.status(200).end();
    }

    const { scholarId } = req.query;
    const apiKey = process.env.SERPAPI_KEY;

    try {
        // Fetch publications from the SerpAPI
        const response = await fetch(`https://serpapi.com/search.json?engine=google_scholar_author&author_id=${scholarId}&api_key=${apiKey}`);
        const data = await response.json();

        // Map data to a simplified format
        const publications = data.articles?.map(pub => ({
            title: pub.title,
            abstract: pub.snippet || "No abstract available.",
            link: pub.link
        })) || [];

        // Send publications data in response
        res.status(200).json({ publications });
    } catch (error) {
        console.error("Error fetching publications:", error);
        res.status(500).json({ error: "Error fetching publications" });
    }
}

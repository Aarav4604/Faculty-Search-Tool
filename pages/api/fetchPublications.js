export default async function handler(req, res) {
    const { scholarId } = req.query;
    const apiKey = process.env.SERPAPI_KEY; // Access the environment variable
    
    if (!scholarId) {
        return res.status(400).json({ error: "Scholar ID is required" });
    }

    const url = `https://serpapi.com/search.json?engine=google_scholar_author&author_id=${scholarId}&api_key=${apiKey}&hl=en&no_cache=true`;

    try {
        const response = await fetch(url);
        const data = await response.json();
        res.status(200).json(data);  // Send the API response back to the client
    } catch (error) {
        console.error("Error fetching publications:", error);
        res.status(500).json({ error: "Failed to fetch publications" });
    }
}

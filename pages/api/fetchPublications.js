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
        if (!scholarId) {
            throw new Error("Scholar ID is missing from the request");
        }

        // Use the environment variable for the API key
        const apiKey = process.env.SERPAPI_KEY;

        if (!apiKey) {
            throw new Error("API key is missing. Ensure SERPAPI_KEY is set in the environment variables.");
        }

        console.log("Scholar ID:", scholarId);
        console.log("API Key:", apiKey);

        // Make the API call
        const response = await fetch(
            `https://serpapi.com/search.json?engine=google_scholar_author&author_id=${scholarId}&api_key=${apiKey}&hl=en`
        );

        const data = await response.json();

        if (data.error) {
            throw new Error(data.error);
        }

        res.status(200).json(data);
    } catch (error) {
        console.error("Error fetching publications:", error.message);
        res.status(500).json({ error: error.message });
    }
}

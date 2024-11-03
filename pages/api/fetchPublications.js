export default async function handler(req, res) {
    // Get scholarId from the query parameters
    const { scholarId } = req.query;

    // Check if scholarId is provided
    if (!scholarId) {
        return res.status(400).json({ error: 'Scholar ID is required' });
    }

    try {
        // Fetch data from SerpAPI
        const response = await fetch(`https://serpapi.com/search.json?engine=google_scholar_author&author_id=${scholarId}&api_key=${process.env.API_KEY}`);
        
        // Check if the response is OK (status 200)
        if (!response.ok) {
            throw new Error(`Failed to fetch data from SerpAPI: ${response.statusText}`);
        }

        // Parse the JSON data from the response
        const data = await response.json();
        
        // Send the fetched data back as JSON
        res.status(200).json(data);
    } catch (error) {
        // Handle any errors by sending a 500 response
        console.error("Error in fetchPublications API:", error);
        res.status(500).json({ error: 'Failed to fetch data from SerpAPI' });
    }
}
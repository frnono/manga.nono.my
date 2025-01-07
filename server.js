const express = require('express');
const path = require('path');
const fetch = require('node-fetch'); // Ensure node-fetch v2.x for CommonJS

const app = express();
const PORT = 3000;
const API_BASE = 'https://api.mangadex.org';

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));

// Proxy route for API requests
app.get('/api/*', async (req, res) => {
  const apiUrl = `${API_BASE}${req.path.replace('/api', '')}`;
  console.log(`Proxying request to: ${apiUrl}`);
  
  try {
    const response = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'manga.nono.my/0.1.5'
      }
    });
    
    if (!response.ok) {
      console.log(`Error response from MangaDex: ${response.status} ${response.statusText}`);
      return res.status(response.status).json({ error: `MangaDex error: ${response.statusText}` });
    }

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).send('Proxy error');
  }
});

// Proxy route for image requests
app.get('/image', async (req, res) => {
  const imageUrl = req.query.url;

  if (!imageUrl) {
    return res.status(400).send('Image URL is required');
  }

  try {
    // Attempt to fetch the image from the provided URL
    const imageResponse = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'manga.nono.my/1.0' // Adjust this as necessary for compliance
      }
    });

    if (!imageResponse.ok) {
      console.log(`Error fetching image: ${imageResponse.status} ${imageResponse.statusText}`);
      return res.status(imageResponse.status).send(`Error fetching image: ${imageResponse.statusText}`);
    }

    // Stream the image response to the client
    res.setHeader('Content-Type', imageResponse.headers.get('Content-Type'));
    imageResponse.body.pipe(res);
  } catch (error) {
    console.error('Image proxy error:', error);
    res.status(500).send('Image proxy error');
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
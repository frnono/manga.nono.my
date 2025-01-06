const express = require('express');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const PORT = 3000;
const API_BASE = 'https://api.mangadex.org';

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));

// Proxy route to MangaDex API
app.get('/api/*', async (req, res) => {
  const apiUrl = `${API_BASE}${req.path.replace('/api', '')}${req.url.replace(req.path, '')}`;
  
  try {
    const response = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'YourCustomUserAgent/1.0'
        // Add any other necessary headers here
      }
    });
    
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    res.status(500).send('Proxy error');
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
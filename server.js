const express = require('express');
const path = require('path');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = 3000;
const MANGADEX_API = 'https://api.mangadex.org';

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Proxy endpoint for manga info
app.get('/api/manga/:mangaId', async (req, res) => {
  try {
    const response = await fetch(`${MANGADEX_API}/manga/${req.params.mangaId}`);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Proxy endpoint for chapter info
app.get('/api/chapter/:chapterId', async (req, res) => {
  try {
    const response = await fetch(`${MANGADEX_API}/chapter/${req.params.chapterId}`);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Proxy endpoint for chapter pages
app.get('/api/chapter-pages/:chapterId', async (req, res) => {
  try {
    const response = await fetch(`${MANGADEX_API}/at-home/server/${req.params.chapterId}`);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Proxy endpoint for manga feed (chapter list)
app.get('/api/manga/:mangaId/feed', async (req, res) => {
  try {
    const url = new URL(`${MANGADEX_API}/manga/${req.params.mangaId}/feed`);
    url.search = new URLSearchParams(req.query).toString();
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Proxy endpoint for image download
app.get('/api/image', async (req, res) => {
  try {
    const imageUrl = req.query.url;
    const response = await fetch(imageUrl);
    const buffer = await response.buffer();
    res.type('image/jpeg').send(buffer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
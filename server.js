const express = require('express');
const path = require('path');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = 3000;
const MANGADEX_API = 'https://api.mangadex.org';

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Helper function to proxy requests
async function proxyRequest(targetUrl, req, res) {
    try {
        const response = await fetch(targetUrl);
        if (!response.ok) {
            throw new Error(`MangaDex API responded with ${response.status}`);
        }
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Proxy error:', error);
        res.status(500).json({ error: error.message });
    }
}

// Manga info endpoint
app.get('/api/manga/:mangaId', (req, res) => {
    const url = `${MANGADEX_API}/manga/${req.params.mangaId}`;
    proxyRequest(url, req, res);
});

// Chapter info endpoint
app.get('/api/chapter/:chapterId', (req, res) => {
    const url = `${MANGADEX_API}/chapter/${req.params.chapterId}`;
    proxyRequest(url, req, res);
});

// Chapter pages endpoint
app.get('/api/chapter-pages/:chapterId', (req, res) => {
    const url = `${MANGADEX_API}/at-home/server/${req.params.chapterId}`;
    proxyRequest(url, req, res);
});

// Manga feed endpoint
app.get('/api/manga/:mangaId/feed', (req, res) => {
    const url = new URL(`${MANGADEX_API}/manga/${req.params.mangaId}/feed`);
    // Copy all query parameters
    url.search = new URLSearchParams(req.query).toString();
    proxyRequest(url.toString(), req, res);
});

// Image proxy endpoint
app.get('/api/image', async (req, res) => {
    try {
        const imageUrl = req.query.url;
        if (!imageUrl) {
            return res.status(400).json({ error: 'No image URL provided' });
        }

        const response = await fetch(imageUrl);
        if (!response.ok) {
            throw new Error(`Image server responded with ${response.status}`);
        }

        // Forward the content type
        res.set('Content-Type', response.headers.get('content-type'));
        
        // Pipe the image data directly to response
        response.body.pipe(res);
    } catch (error) {
        console.error('Image proxy error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
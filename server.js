const express = require('express');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = 3000;
const API_BASE_URL = 'https://api.mangadex.org';

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));

// Proxy endpoint to fix CORS issues
app.use('/api', createProxyMiddleware({
  target: API_BASE_URL,
  changeOrigin: true,
  pathRewrite: {
    '^/api': '', // remove /api from path
  },
}));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
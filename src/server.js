require('dotenv').config();
const http = require('http');
const path = require('path');
const express = require('express');
const cors = require('cors');

const db = require('./db');
const { initWebSocketServer } = require('./services/websocket');
const { startReaper } = require('./services/sessionManager');

const authRouter = require('./routes/auth');
const sessionRouter = require('./routes/session');
const worldRouter = require('./routes/world');
const playersRouter = require('./routes/players');
const backupsRouter = require('./routes/backups');

const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Health check for Render & status monitoring
app.get('/healthz', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    database: db.getConnectionType(),
    time: new Date().toISOString() 
  });
});

// API Routes
app.use('/api/auth', authRouter);
app.use('/api/session', sessionRouter);
app.use('/api/world', worldRouter);
app.use('/api/players', playersRouter);
app.use('/api/backups', backupsRouter);

// Fallback to SPA
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[ServerError]', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error'
  });
});

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    await db.init();
    initWebSocketServer(server);
    startReaper();

    server.listen(PORT, '0.0.0.0', () => {
      console.log(`=============================================`);
      console.log(`  E4ALL Host Coordinator Online (MongoDB)`);
      console.log(`  Port: ${PORT}`);
      console.log(`  Mode: ${process.env.NODE_ENV || 'development'}`);
      console.log(`  Local URL: http://localhost:${PORT}`);
      console.log(`=============================================`);
    });
  } catch (err) {
    console.error('Failed to start E4ALL server:', err);
    process.exit(1);
  }
}

startServer();

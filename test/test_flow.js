const assert = require('assert');
const http = require('http');
const express = require('express');
const cors = require('cors');

const db = require('../src/db');
const sessionManager = require('../src/services/sessionManager');
const sessionRouter = require('../src/routes/session');
const worldRouter = require('../src/routes/world');
const playersRouter = require('../src/routes/players');

async function makeRequest(server, path, method = 'GET', body = null) {
  const port = server.address().port;
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {})
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, data: json });
        } catch (e) {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runFullIntegrationTests() {
  console.log('🧪 [Test Suite] Running Full Integration & HTTP API Suite...\n');

  // Setup test Express server
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.get('/healthz', (req, res) => res.json({ status: 'ok' }));
  app.use('/api/session', sessionRouter);
  app.use('/api/world', worldRouter);
  app.use('/api/players', playersRouter);

  await db.init();
  await db.query("UPDATE sessions SET status = 'OFFLINE'");
  const server = http.createServer(app);
  await new Promise(res => server.listen(0, '127.0.0.1', res));

  try {
    // 1. Healthcheck
    console.log('▶ Test 1: GET /healthz');
    const health = await makeRequest(server, '/healthz');
    assert.strictEqual(health.status, 200);
    assert.strictEqual(health.data.status, 'ok');
    console.log('  ✅ Healthcheck OK');

    // 2. GET /api/players
    console.log('▶ Test 2: GET /api/players');
    const playersRes = await makeRequest(server, '/api/players');
    assert.strictEqual(playersRes.status, 200);
    assert.strictEqual(playersRes.data.players.length, 4);
    assert.strictEqual(playersRes.data.players[3].canHost, false);
    console.log('  ✅ Player roster and capabilities OK');

    // 3. GET /api/session/status
    console.log('▶ Test 3: GET /api/session/status');
    const statusRes = await makeRequest(server, '/api/session/status');
    assert.strictEqual(statusRes.status, 200);
    assert.strictEqual(statusRes.data.status, 'OFFLINE');
    console.log('  ✅ Initial session status is OFFLINE');

    // 4. POST /api/session/claim (Player 3 claims)
    console.log('▶ Test 4: POST /api/session/claim');
    const claimRes = await makeRequest(server, '/api/session/claim', 'POST', { playerId: 3 });
    assert.strictEqual(claimRes.status, 200);
    assert.ok(claimRes.data.hostToken);
    const token = claimRes.data.hostToken;
    console.log('  ✅ Player 3 claimed host successfully');

    // 5. POST /api/session/ready
    console.log('▶ Test 5: POST /api/session/ready');
    const readyRes = await makeRequest(server, '/api/session/ready', 'POST', { hostToken: token });
    assert.strictEqual(readyRes.status, 200);
    assert.strictEqual(readyRes.data.status, 'STARTING');
    console.log('  ✅ Status advanced to STARTING');

    // 6. POST /api/session/online
    console.log('▶ Test 6: POST /api/session/online');
    const onlineRes = await makeRequest(server, '/api/session/online', 'POST', {
      hostToken: token,
      e4mcAddress: 'e4all-group-world.e4mc.link'
    });
    assert.strictEqual(onlineRes.status, 200);
    assert.strictEqual(onlineRes.data.status, 'ONLINE');
    assert.strictEqual(onlineRes.data.activeSession.e4mcAddress, 'e4all-group-world.e4mc.link');
    console.log('  ✅ Session ONLINE with e4mc tunnel link');

    // 7. POST /api/session/heartbeat
    console.log('▶ Test 7: POST /api/session/heartbeat');
    const hbRes = await makeRequest(server, '/api/session/heartbeat', 'POST', { hostToken: token });
    assert.strictEqual(hbRes.status, 200);
    assert.strictEqual(hbRes.data.success, true);
    console.log('  ✅ Host heartbeat recorded');

    // 8. POST /api/session/end
    console.log('▶ Test 8: POST /api/session/end');
    const endRes = await makeRequest(server, '/api/session/end', 'POST', { hostToken: token });
    assert.strictEqual(endRes.status, 200);
    assert.strictEqual(endRes.data.status, 'SAVING');
    console.log('  ✅ Status transitioned to SAVING');

    // 9. POST /api/session/finalize
    console.log('▶ Test 9: POST /api/session/finalize');
    const finRes = await makeRequest(server, '/api/session/finalize', 'POST', {
      hostToken: token,
      notes: 'Built underground minecart track'
    });
    assert.strictEqual(finRes.status, 200);
    assert.strictEqual(finRes.data.success, true);
    assert.strictEqual(finRes.data.status.status, 'OFFLINE');
    console.log('  ✅ Version bumped & status returned to OFFLINE');

    // 10. GET /api/world/history
    console.log('▶ Test 10: GET /api/world/history');
    const histRes = await makeRequest(server, '/api/world/history');
    assert.strictEqual(histRes.status, 200);
    assert.ok(histRes.data.history.length >= 2);
    console.log('  ✅ History records retrieved accurately');

    console.log('\n🎉 ALL 10 INTEGRATION TESTS PASSED PERFECTLY!\n');
  } finally {
    server.close();
  }
}

runFullIntegrationTests().catch(err => {
  console.error('❌ Integration Test Failed:', err);
  process.exit(1);
});

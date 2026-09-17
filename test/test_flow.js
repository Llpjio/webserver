const assert = require('assert');
const http = require('http');
const express = require('express');
const cors = require('cors');

const db = require('../src/db');
const { User, Session, WorldVersion } = require('../src/db/models');
const authRouter = require('../src/routes/auth');
const sessionRouter = require('../src/routes/session');
const worldRouter = require('../src/routes/world');
const playersRouter = require('../src/routes/players');

async function makeRequest(server, path, method = 'GET', body = null, token = null) {
  const port = server.address().port;
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : null;
    const headers = {
      'Content-Type': 'application/json',
      ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {}),
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };

    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers
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

async function runMongoDBTests() {
  console.log('🧪 [Test Suite] Running MongoDB Authentication & Host Coordinator Tests...\n');

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.get('/healthz', (req, res) => res.json({ status: 'ok' }));
  app.use('/api/auth', authRouter);
  app.use('/api/session', sessionRouter);
  app.use('/api/world', worldRouter);
  app.use('/api/players', playersRouter);

  await db.init();
  await Session.deleteMany({}); // Clean sessions

  const server = http.createServer(app);
  await new Promise(res => server.listen(0, '127.0.0.1', res));

  try {
    // 1. Healthcheck
    console.log('▶ Test 1: GET /healthz');
    const health = await makeRequest(server, '/healthz');
    assert.strictEqual(health.status, 200);
    assert.strictEqual(health.data.status, 'ok');
    console.log('  ✅ Healthcheck OK');

    // 2. User Login (seeded player2)
    console.log('▶ Test 2: POST /api/auth/login (player2)');
    const loginRes = await makeRequest(server, '/api/auth/login', 'POST', {
      username: 'player2',
      password: 'password123'
    });
    assert.strictEqual(loginRes.status, 200);
    assert.ok(loginRes.data.token);
    assert.strictEqual(loginRes.data.user.username, 'player2');
    const p2Token = loginRes.data.token;
    console.log('  ✅ Player 2 login & JWT generation OK');

    // 3. Register New Player (e.g. steve)
    console.log('▶ Test 3: POST /api/auth/register (steve)');
    const regRes = await makeRequest(server, '/api/auth/register', 'POST', {
      username: 'steve',
      displayName: 'Steve Craft',
      password: 'mypassword123',
      canHost: true,
      hasVoxy: true
    });
    assert.strictEqual(regRes.status, 201);
    assert.ok(regRes.data.token);
    const steveToken = regRes.data.token;
    console.log('  ✅ Steve registered and authenticated');

    // 4. GET /api/players
    console.log('▶ Test 4: GET /api/players');
    const playersRes = await makeRequest(server, '/api/players');
    assert.strictEqual(playersRes.status, 200);
    assert.ok(playersRes.data.players.length >= 5);
    console.log('  ✅ Player roster retrieved from MongoDB');

    // 5. Host Claim by Player 2
    console.log('▶ Test 5: POST /api/session/claim (Player 2 claims)');
    const claimRes = await makeRequest(server, '/api/session/claim', 'POST', {}, p2Token);
    assert.strictEqual(claimRes.status, 200);
    assert.strictEqual(claimRes.data.status.status, 'CLAIMED');
    assert.strictEqual(claimRes.data.status.activeSession.hostUsername, 'player2');
    console.log('  ✅ Host session acquired by Player 2');

    // 6. Simultaneous claim conflict by Steve
    console.log('▶ Test 6: Concurrent claim conflict by Steve');
    const conflictRes = await makeRequest(server, '/api/session/claim', 'POST', {}, steveToken);
    assert.strictEqual(conflictRes.status, 409);
    console.log('  ✅ Conflicting claim rejected with 409 Conflict');

    // 7. Ready -> Online with e4mc link
    console.log('▶ Test 7: Ready -> Online transitions');
    await makeRequest(server, '/api/session/ready', 'POST', {}, p2Token);
    const onlineRes = await makeRequest(server, '/api/session/online', 'POST', {
      e4mcAddress: 'e4all-party.e4mc.link'
    }, p2Token);
    assert.strictEqual(onlineRes.status, 200);
    assert.strictEqual(onlineRes.data.status, 'ONLINE');
    assert.strictEqual(onlineRes.data.activeSession.e4mcAddress, 'e4all-party.e4mc.link');
    console.log('  ✅ World is ONLINE with e4mc tunnel link');

    // 8. End & Finalize session
    console.log('▶ Test 8: End -> Finalize & World Version Bump');
    await makeRequest(server, '/api/session/end', 'POST', {}, p2Token);
    const finRes = await makeRequest(server, '/api/session/finalize', 'POST', {
      notes: 'Built automatic wheat farm'
    }, p2Token);
    assert.strictEqual(finRes.status, 200);
    assert.strictEqual(finRes.data.newWorldVersion, 101);
    assert.strictEqual(finRes.data.status.status, 'OFFLINE');
    console.log('  ✅ World version incremented to v101 and returned to OFFLINE');

    // 9. Host claiming v101 and publishing v102 with Google Drive link
    console.log('▶ Test 9: Host session with Google Drive link publishing');
    await makeRequest(server, '/api/session/claim', 'POST', {}, p2Token);
    await makeRequest(server, '/api/session/ready', 'POST', {}, p2Token);
    await makeRequest(server, '/api/session/online', 'POST', { e4mcAddress: 'gdrive-test.e4mc.link' }, p2Token);
    await makeRequest(server, '/api/session/end', 'POST', {}, p2Token);

    const gdriveUploadRes = await makeRequest(server, '/api/world/upload', 'POST', {
      notes: 'Transferred 500MB world save to Google Drive',
      gdriveUrl: 'https://drive.google.com/file/d/1A2B3C4D5E6F7G8H9I0J/view?usp=sharing'
    }, p2Token);
    assert.strictEqual(gdriveUploadRes.status, 200);
    assert.strictEqual(gdriveUploadRes.data.newWorldVersion, 102);

    const latestVerRes = await makeRequest(server, '/api/world/latest', 'GET');
    assert.strictEqual(latestVerRes.data.worldVersion.version, 102);
    assert.strictEqual(latestVerRes.data.worldVersion.storageType, 'gdrive');
    console.log('  ✅ Google Drive link extracted and linked to v102 download');

    console.log('\n🎉 ALL MONGODB, GDRIVE & AUTH INTEGRATION TESTS PASSED!\n');
    process.exit(0);
  } finally {
    server.close();
  }
}

runMongoDBTests().catch(err => {
  console.error('❌ Test Failed:', err);
  process.exit(1);
});

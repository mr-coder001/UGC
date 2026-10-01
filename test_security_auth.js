/**
 * Security & Authentication Verification Test Suite
 * Smart UGC Moderation & Asset Studio
 */

const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = 3001;
process.env.PORT = PORT;
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-security-secret-key-12345';
// Note: Leave GOOGLE_CLIENT_ID and CLOUDINARY_API_SECRET unset/default for test harness

const db = require('./db/database');

function makeRequest(options, postData = null, cookie = null) {
  return new Promise((resolve, reject) => {
    const reqOptions = {
      hostname: '127.0.0.1',
      port: PORT,
      path: options.path,
      method: options.method || 'GET',
      headers: {
        ...(options.headers || {})
      }
    };

    if (cookie) {
      reqOptions.headers['Cookie'] = cookie;
    }

    if (postData && !reqOptions.headers['Content-Type']) {
      reqOptions.headers['Content-Type'] = 'application/json';
    }

    const req = http.request(reqOptions, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(body);
        } catch (e) {
          json = body;
        }

        const setCookie = res.headers['set-cookie'];
        let cookieString = null;
        if (setCookie) {
          cookieString = Array.isArray(setCookie) ? setCookie.map(c => c.split(';')[0]).join('; ') : setCookie.split(';')[0];
        }

        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: json,
          rawBody: body,
          cookie: cookieString
        });
      });
    });

    req.on('error', reject);

    if (postData) {
      if (typeof postData === 'object' && !(postData instanceof Buffer)) {
        req.write(JSON.stringify(postData));
      } else {
        req.write(postData);
      }
    }
    req.end();
  });
}

async function runTests() {
  console.log('====================================================');
  console.log('STARTING SECURITY & AUTHENTICATION TESTS');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${message}`);
      failed++;
    }
  }

  // 1. Start Server for Testing
  await db.initDatabase();
  const app = require('./server');
  const httpServer = http.createServer(app);
  await new Promise((resolve) => httpServer.listen(PORT, '127.0.0.1', resolve));

  try {
    // TEST 1: Health Check
    console.log('\n--- TEST 1: Health Check Endpoint ---');
    const health = await makeRequest({ path: '/api/health' });
    assert(health.statusCode === 200, 'GET /api/health returned 200');
    assert(health.body.success === true, 'Health check reports success');
    assert(health.body.database === 'sqlite' || health.body.database === 'postgres', 'Database type is reported');

    // TEST 2: Unauthenticated Access to Protected Endpoints
    console.log('\n--- TEST 2: Unauthenticated Access Rejection (401) ---');
    const unauthAssets = await makeRequest({ path: '/api/assets' });
    assert(unauthAssets.statusCode === 401, 'GET /api/assets rejects unauthenticated with 401');

    const unauthUpload = await makeRequest({ path: '/api/upload', method: 'POST' });
    assert(unauthUpload.statusCode === 401, 'POST /api/upload rejects unauthenticated with 401');

    const unauthDelete = await makeRequest({ path: '/api/assets/ast_12345', method: 'DELETE' });
    assert(unauthDelete.statusCode === 401, 'DELETE /api/assets/:id rejects unauthenticated with 401');

    const unauthStats = await makeRequest({ path: '/api/asset-stats' });
    assert(unauthStats.statusCode === 401, 'GET /api/asset-stats rejects unauthenticated with 401');

    // TEST 3: Auth Status for Unauthenticated Client
    console.log('\n--- TEST 3: Auth Me Status (Unauthenticated) ---');
    const authStatus = await makeRequest({ path: '/auth/me' });
    assert(authStatus.statusCode === 200, 'GET /auth/me returns 200');
    assert(authStatus.body.authenticated === false, 'Auth status reports authenticated: false');
    assert(authStatus.body.user === null, 'User object is null');

    // TEST 4: Create Test Users in Database (User A and User B)
    console.log('\n--- TEST 4: Database User Creation & Isolation ---');
    const userA = await db.createUser({
      googleId: 'google_user_a_123',
      email: 'usera@example.com',
      name: 'User A',
      profileImage: 'https://lh3.googleusercontent.com/a/user_a'
    });
    assert(userA && userA.id.startsWith('usr_'), 'User A created in DB with ID: ' + userA.id);

    const userB = await db.createUser({
      googleId: 'google_user_b_456',
      email: 'userb@example.com',
      name: 'User B',
      profileImage: 'https://lh3.googleusercontent.com/a/user_b'
    });
    assert(userB && userB.id.startsWith('usr_'), 'User B created in DB with ID: ' + userB.id);

    // TEST 5: Create User A Asset in Database
    console.log('\n--- TEST 5: User-Specific Asset Ownership Creation ---');
    const assetA1 = await db.createAsset({
      userId: userA.id,
      cloudinaryPublicId: 'smart-ugc-studio/ugc_test_user_a_1',
      originalName: 'user_a_photo.jpg',
      assetType: 'image',
      format: 'jpg',
      bytes: 1048576,
      width: 1200,
      height: 800,
      moderationStatus: 'approved',
      tags: ['fashion', 'portrait'],
      detectedObjects: ['person']
    });
    assert(assetA1 && assetA1.id.startsWith('ast_'), 'Asset A1 created for User A with ID: ' + assetA1.id);
    assert(assetA1.userId === userA.id, 'Asset A1 user_id matches User A ID');

    const assetB1 = await db.createAsset({
      userId: userB.id,
      cloudinaryPublicId: 'smart-ugc-studio/ugc_test_user_b_1',
      originalName: 'user_b_sneakers.jpg',
      assetType: 'image',
      format: 'png',
      bytes: 2097152,
      width: 1600,
      height: 1200,
      moderationStatus: 'approved',
      tags: ['sneakers', 'footwear'],
      detectedObjects: ['shoe']
    });
    assert(assetB1 && assetB1.id.startsWith('ast_'), 'Asset B1 created for User B with ID: ' + assetB1.id);

    // TEST 6: User A Queries Library (Should Only Contain Asset A1, NOT Asset B1)
    console.log('\n--- TEST 6: User Asset Library Isolation (No Cross-Account Leakage) ---');
    const userAAssets = await db.getAssetsByUserId(userA.id);
    assert(userAAssets.length === 1, 'User A has exactly 1 asset');
    assert(userAAssets[0].id === assetA1.id, 'User A sees only their asset A1');
    assert(userAAssets.every(a => a.userId === userA.id), 'No foreign assets leaked into User A library');

    const userBAssets = await db.getAssetsByUserId(userB.id);
    assert(userBAssets.length === 1, 'User B has exactly 1 asset');
    assert(userBAssets[0].id === assetB1.id, 'User B sees only their asset B1');

    // TEST 7: IDOR Protection (User B cannot access User A asset by ID)
    console.log('\n--- TEST 7: IDOR Protection on Asset Fetch ---');
    const foreignAccess = await db.getAssetByIdAndUserId(assetA1.id, userB.id);
    assert(foreignAccess === null, 'User B querying Asset A1 returns null (Access Denied / IDOR Protected)');

    const legitimateAccess = await db.getAssetByIdAndUserId(assetA1.id, userA.id);
    assert(legitimateAccess !== null && legitimateAccess.id === assetA1.id, 'User A querying Asset A1 succeeds');

    // TEST 8: IDOR Protection on Deletion (User B cannot delete User A asset)
    console.log('\n--- TEST 8: IDOR Protection on Asset Deletion ---');
    const unauthorizedDelete = await db.deleteAssetByIdAndUserId(assetA1.id, userB.id);
    assert(unauthorizedDelete === null, 'User B attempting to delete Asset A1 is rejected');

    const assetA1StillExists = await db.getAssetByIdAndUserId(assetA1.id, userA.id);
    assert(assetA1StillExists !== null, 'Asset A1 still safely exists after unauthorized delete attempt');

    // TEST 9: Secure Deletion by True Owner
    console.log('\n--- TEST 9: Secure Deletion by True Owner ---');
    const authorizedDelete = await db.deleteAssetByIdAndUserId(assetA1.id, userA.id);
    assert(authorizedDelete !== null, 'User A successfully deletes Asset A1');

    const assetA1Deleted = await db.getAssetByIdAndUserId(assetA1.id, userA.id);
    assert(assetA1Deleted === null, 'Asset A1 no longer exists in database');

    const userAAssetsAfterDelete = await db.getAssetsByUserId(userA.id);
    assert(userAAssetsAfterDelete.length === 0, 'User A library is now empty');

    // TEST 10: User Stats Isolation
    console.log('\n--- TEST 10: Isolated User Statistics ---');
    const userBStats = await db.getUserStats(userB.id);
    assert(userBStats.totalAssets === 1, 'User B totalAssets is 1');
    assert(userBStats.totalBytesStored === 2097152, 'User B bytes match only User B assets');
    assert(userBStats.totalTagsIndexed === 2, 'User B tags count matches only User B tags');

    const userAStats = await db.getUserStats(userA.id);
    assert(userAStats.totalAssets === 0, 'User A totalAssets is 0');
    assert(userAStats.totalBytesStored === 0, 'User A totalBytes is 0');

    // TEST 11: Secret Exposure Check in Public Frontend Files
    console.log('\n--- TEST 11: Frontend Secret Leakage Scan ---');
    const publicJs = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
    const indexHtml = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
    const stylesCss = fs.readFileSync(path.join(__dirname, 'public', 'styles.css'), 'utf8');

    assert(!publicJs.includes('CLOUDINARY_API_SECRET'), 'public/app.js does not contain CLOUDINARY_API_SECRET');
    assert(!publicJs.includes('GOOGLE_CLIENT_SECRET'), 'public/app.js does not contain GOOGLE_CLIENT_SECRET');
    assert(!indexHtml.includes('CLOUDINARY_API_SECRET'), 'public/index.html does not contain CLOUDINARY_API_SECRET');
    assert(!indexHtml.includes('GOOGLE_CLIENT_SECRET'), 'public/index.html does not contain GOOGLE_CLIENT_SECRET');
    assert(!stylesCss.includes('CLOUDINARY_API_SECRET'), 'public/styles.css does not contain CLOUDINARY_API_SECRET');

  } catch (err) {
    console.error('Test execution error:', err);
    failed++;
  } finally {
    if (httpServer) {
      httpServer.close();
    }
  }

  console.log('\n====================================================');
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');

  process.exit(failed > 0 ? 1 : 0);
}

runTests();


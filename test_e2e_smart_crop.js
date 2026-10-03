require('dotenv').config();
const cloudinary = require('cloudinary').v2;
const https = require('https');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

function fetchUrlInfo(url) {
  return new Promise((resolve) => {
    const req = https.get(url, (res) => {
      let bodyLength = 0;
      res.on('data', chunk => { bodyLength += chunk.length; });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          contentType: res.headers['content-type'],
          contentLength: res.headers['content-length'] || bodyLength,
          error: res.headers['x-cld-error']
        });
      });
    });
    req.on('error', (err) => {
      resolve({ statusCode: 0, error: err.message });
    });
    req.setTimeout(15000, () => {
      req.abort();
      resolve({ statusCode: 408, error: 'Timeout' });
    });
  });
}

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
  });
}

async function runE2ETests() {
  console.log('====================================================');
  console.log('STARTING SMART CROP END-TO-END VERIFICATION');
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

  // Real images with diverse aspect ratios:
  const testImages = [
    {
      name: 'Landscape UGC (16:9 / 3:2 coffee scene)',
      url: 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=800&auto=format&fit=crop&q=80',
      expectedRatio: 'landscape'
    },
    {
      name: 'Portrait UGC (4:5 / 2:3 fashion portrait)',
      url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=800&auto=format&fit=crop&q=80',
      expectedRatio: 'portrait'
    },
    {
      name: 'Product UGC (Square sneaker focus)',
      url: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800&auto=format&fit=crop&q=80',
      expectedRatio: 'square'
    }
  ];

  for (const imgConfig of testImages) {
    console.log(`\n--- Testing ${imgConfig.name} ---`);
    console.log(`  Fetching source image from ${imgConfig.url.slice(0, 55)}...`);
    const buffer = await fetchBuffer(imgConfig.url);
    const publicId = `test_ugc_${Date.now()}_${imgConfig.expectedRatio}`;

    console.log(`  Uploading buffer (${buffer.length} bytes) to Cloudinary as "${publicId}"...`);
    const uploadRes = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        {
          folder: 'smart-ugc-studio-test',
          public_id: publicId,
          resource_type: 'image',
          eager: [
            { width: 1080, height: 1080, crop: 'fill', gravity: 'auto', fetch_format: 'auto', quality: 'auto' },
            { width: 1080, height: 1350, crop: 'fill', gravity: 'auto', fetch_format: 'auto', quality: 'auto' },
            { width: 1600, height: 900, crop: 'fill', gravity: 'auto', fetch_format: 'auto', quality: 'auto' },
            { width: 1080, height: 1920, crop: 'fill', gravity: 'auto', fetch_format: 'auto', quality: 'auto' }
          ]
        },
        (err, res) => (err ? reject(err) : resolve(res))
      ).end(buffer);
    });

    assert(Boolean(uploadRes && uploadRes.public_id), `Uploaded successfully: ${uploadRes.public_id}`);

    const fullPublicId = uploadRes.public_id;

    // Generate 4 Smart Crop URLs using SDK
    const crop11Url = cloudinary.url(fullPublicId, {
      width: 1080,
      height: 1080,
      crop: 'fill',
      gravity: 'auto',
      fetch_format: 'auto',
      quality: 'auto',
      sign_url: true,
      secure: true
    });

    const crop45Url = cloudinary.url(fullPublicId, {
      width: 1080,
      height: 1350,
      crop: 'fill',
      gravity: 'auto',
      fetch_format: 'auto',
      quality: 'auto',
      sign_url: true,
      secure: true
    });

    const crop169Url = cloudinary.url(fullPublicId, {
      width: 1600,
      height: 900,
      crop: 'fill',
      gravity: 'auto',
      fetch_format: 'auto',
      quality: 'auto',
      sign_url: true,
      secure: true
    });

    const crop916Url = cloudinary.url(fullPublicId, {
      width: 1080,
      height: 1920,
      crop: 'fill',
      gravity: 'auto',
      fetch_format: 'auto',
      quality: 'auto',
      sign_url: true,
      secure: true
    });

    assert(crop11Url.includes('/c_fill,f_auto,g_auto,h_1080,q_auto,w_1080/'), '1:1 Crop URL contains c_fill,g_auto,h_1080,w_1080');
    assert(crop45Url.includes('/c_fill,f_auto,g_auto,h_1350,q_auto,w_1080/'), '4:5 Crop URL contains c_fill,g_auto,h_1350,w_1080');
    assert(crop169Url.includes('/c_fill,f_auto,g_auto,h_900,q_auto,w_1600/'), '16:9 Crop URL contains c_fill,g_auto,h_900,w_1600');
    assert(crop916Url.includes('/c_fill,f_auto,g_auto,h_1920,q_auto,w_1080/'), '9:16 Crop URL contains c_fill,g_auto,h_1920,w_1080');

    // Fetch and verify all 4 URLs over HTTPS
    const res11 = await fetchUrlInfo(crop11Url);
    assert(res11.statusCode === 200, `1:1 Crop HTTP status is 200 (Got: ${res11.statusCode})`);
    assert(res11.contentType && res11.contentType.startsWith('image/'), `1:1 Content-Type is image (Got: ${res11.contentType})`);

    const res45 = await fetchUrlInfo(crop45Url);
    assert(res45.statusCode === 200, `4:5 Crop HTTP status is 200 (Got: ${res45.statusCode})`);
    assert(res45.contentType && res45.contentType.startsWith('image/'), `4:5 Content-Type is image (Got: ${res45.contentType})`);

    const res169 = await fetchUrlInfo(crop169Url);
    assert(res169.statusCode === 200, `16:9 Crop HTTP status is 200 (Got: ${res169.statusCode})`);
    assert(res169.contentType && res169.contentType.startsWith('image/'), `16:9 Content-Type is image (Got: ${res169.contentType})`);

    const res916 = await fetchUrlInfo(crop916Url);
    assert(res916.statusCode === 200, `9:16 Crop HTTP status is 200 (Got: ${res916.statusCode})`);
    assert(res916.contentType && res916.contentType.startsWith('image/'), `9:16 Content-Type is image (Got: ${res916.contentType})`);

    // Clean up test asset from Cloudinary
    await cloudinary.uploader.destroy(fullPublicId, { invalidate: true });
    console.log(`  Cleaned up test asset "${fullPublicId}".`);
  }

  console.log('\n====================================================');
  console.log(`SMART CROP E2E SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');
  process.exit(failed > 0 ? 1 : 0);
}

runE2ETests().catch(err => {
  console.error('Fatal Test Error:', err);
  process.exit(1);
});

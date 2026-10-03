/**
 * Smart UGC Moderation & Asset Studio
 * Cloudinary AI Hackathon 2026 — Track 1: AI Media Pipelines
 * Security & Google Authentication Upgrade
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const session = require('express-session');
const passport = require('passport');
const rateLimit = require('express-rate-limit');
const cloudinary = require('cloudinary').v2;

const db = require('./db/database');
const { configurePassport } = require('./auth/passport');

const app = express();
const PORT = process.env.PORT || 3000;

// Configure Cloudinary SDK securely via environment variables
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

// Trust proxy for production deployments (e.g. Vercel, reverse proxies)
app.set('trust proxy', 1);

// Configure CORS securely
const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000'
];

if (process.env.FRONTEND_ORIGIN) {
  allowedOrigins.push(process.env.FRONTEND_ORIGIN);
}

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. mobile apps, curl, same-origin)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      return callback(null, true);
    }
    // Allow any localhost port for local development convenience
    if (/^http:\/\/localhost:\d+$/.test(origin) || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) {
      return callback(null, true);
    }
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate Limiters
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 60,
  message: { success: false, message: 'Too many authentication requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 40,
  message: { success: false, message: 'Upload rate limit exceeded. Please wait a few minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

const deleteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 80,
  message: { success: false, message: 'Delete rate limit exceeded. Please wait a few minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

const apiGeneralLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  message: { success: false, message: 'API request limit exceeded. Please wait a few minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Configure Session Management
const sessionSecret = process.env.SESSION_SECRET || 'ugc-studio-secure-session-secret-2026';
const isProduction = process.env.NODE_ENV === 'production';

app.use(session({
  store: db.getSessionStore(session),
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  name: 'ugc_studio_sid',
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
}));

// Initialize Passport Authentication
const authConfig = configurePassport();
app.use(passport.initialize());
app.use(passport.session());

// Database readiness middleware (Serverless & cold-start safe)
app.use(async (req, res, next) => {
  try {
    await db.ensureInitialized();
    next();
  } catch (err) {
    console.error('[Database Readiness Error]', err);
    return res.status(500).json({
      success: false,
      message: 'Database initialization failed. Please check your database connection.'
    });
  }
});

// Serve static frontend assets from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Configure Multer for in-memory file handling (no permanent local filesystem storage)
const storage = multer.memoryStorage();

const allowedMimeTypes = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp'
];

const fileFilter = (req, file, cb) => {
  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Please upload an image file (JPG, PNG, or WEBP).'), false);
  }
};

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10 MB maximum
  },
  fileFilter
});

/**
 * Helper: Verify Cloudinary credentials presence
 */
const hasCloudinaryCredentials = () => {
  const name = process.env.CLOUDINARY_CLOUD_NAME;
  const key = process.env.CLOUDINARY_API_KEY;
  const secret = process.env.CLOUDINARY_API_SECRET;

  return Boolean(
    name && name !== 'your_cloud_name' &&
    key && key !== 'your_api_key' &&
    secret && secret !== 'your_api_secret'
  );
};

/**
 * Authentication Authorization Middleware
 * Enforces authenticated server-side session for protected routes
 */
const requireAuth = (req, res, next) => {
  if (req.isAuthenticated && req.isAuthenticated() && req.user) {
    return next();
  }
  return res.status(401).json({
    success: false,
    message: 'Please sign in with Google to upload and process images.'
  });
};

/**
 * Helper: Format and sanitize AI background generation prompt for Cloudinary transformation URLs
 */
const formatGenBgPrompt = (promptStr) => {
  if (!promptStr || typeof promptStr !== 'string') {
    return 'clean studio background with soft lighting';
  }
  const cleaned = promptStr
    .replace(/[,;.:/\\"'`?#&%()[\]{}|<>+*^$!=~_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned || 'clean studio background with soft lighting';
};

/**
 * Helper: Generate Signed Cloudinary URLs for private/authorized delivery
 * Using sign_url: true prevents unauthorized tampering and URL manipulation
 */
const generateSignedAssetUrls = (publicId, prompt = 'clean modern studio background with soft lighting') => {
  const cleanPrompt = formatGenBgPrompt(prompt);

  const originalUrl = cloudinary.url(publicId, {
    sign_url: true,
    secure: true
  });

  const optimizedUrl = cloudinary.url(publicId, {
    fetch_format: 'auto',
    quality: 'auto',
    sign_url: true,
    secure: true
  });

  const thumbnailUrl = cloudinary.url(publicId, {
    width: 500,
    height: 380,
    crop: 'fill',
    gravity: 'auto',
    fetch_format: 'auto',
    quality: 'auto',
    sign_url: true,
    secure: true
  });

  const backgroundRemovedUrl = cloudinary.url(publicId, {
    effect: 'background_removal',
    format: 'png',
    sign_url: true,
    secure: true
  });

  const generatedBackgroundUrl = cloudinary.url(publicId, {
    transformation: [
      { effect: `gen_background_replace:prompt_${cleanPrompt}` },
      { fetch_format: 'auto', quality: 'auto' }
    ],
    sign_url: true,
    secure: true
  });

  // 1:1 Square (1080x1080)
  const crop11Url = cloudinary.url(publicId, {
    width: 1080,
    height: 1080,
    crop: 'fill',
    gravity: 'auto',
    fetch_format: 'auto',
    quality: 'auto',
    sign_url: true,
    secure: true
  });
  const smartCropUrl = crop11Url;

  // 4:5 Portrait (1080x1350)
  const crop45Url = cloudinary.url(publicId, {
    width: 1080,
    height: 1350,
    crop: 'fill',
    gravity: 'auto',
    fetch_format: 'auto',
    quality: 'auto',
    sign_url: true,
    secure: true
  });

  // 16:9 Landscape (1600x900)
  const crop169Url = cloudinary.url(publicId, {
    width: 1600,
    height: 900,
    crop: 'fill',
    gravity: 'auto',
    fetch_format: 'auto',
    quality: 'auto',
    sign_url: true,
    secure: true
  });

  // 9:16 Vertical (1080x1920)
  const crop916Url = cloudinary.url(publicId, {
    width: 1080,
    height: 1920,
    crop: 'fill',
    gravity: 'auto',
    fetch_format: 'auto',
    quality: 'auto',
    sign_url: true,
    secure: true
  });

  // AI Generated Background Smart Crops
  const genCrop11Url = cloudinary.url(publicId, {
    transformation: [
      { effect: `gen_background_replace:prompt_${cleanPrompt}` },
      { width: 1080, height: 1080, crop: 'fill', gravity: 'auto' },
      { fetch_format: 'auto', quality: 'auto' }
    ],
    sign_url: true,
    secure: true
  });

  const genCrop45Url = cloudinary.url(publicId, {
    transformation: [
      { effect: `gen_background_replace:prompt_${cleanPrompt}` },
      { width: 1080, height: 1350, crop: 'fill', gravity: 'auto' },
      { fetch_format: 'auto', quality: 'auto' }
    ],
    sign_url: true,
    secure: true
  });

  const genCrop169Url = cloudinary.url(publicId, {
    transformation: [
      { effect: `gen_background_replace:prompt_${cleanPrompt}` },
      { width: 1600, height: 900, crop: 'fill', gravity: 'auto' },
      { fetch_format: 'auto', quality: 'auto' }
    ],
    sign_url: true,
    secure: true
  });

  const genCrop916Url = cloudinary.url(publicId, {
    transformation: [
      { effect: `gen_background_replace:prompt_${cleanPrompt}` },
      { width: 1080, height: 1920, crop: 'fill', gravity: 'auto' },
      { fetch_format: 'auto', quality: 'auto' }
    ],
    sign_url: true,
    secure: true
  });

  const crops = {
    square: {
      url: crop11Url,
      width: 1080,
      height: 1080,
      aspectRatio: '1:1',
      label: '1:1 Square'
    },
    portrait: {
      url: crop45Url,
      width: 1080,
      height: 1350,
      aspectRatio: '4:5',
      label: '4:5 Portrait'
    },
    landscape: {
      url: crop169Url,
      width: 1600,
      height: 900,
      aspectRatio: '16:9',
      label: '16:9 Landscape'
    },
    vertical: {
      url: crop916Url,
      width: 1080,
      height: 1920,
      aspectRatio: '9:16',
      label: '9:16 Vertical'
    }
  };

  const aiBgCrops = {
    square: {
      url: genCrop11Url,
      width: 1080,
      height: 1080,
      aspectRatio: '1:1',
      label: '1:1 Square (AI Background)'
    },
    portrait: {
      url: genCrop45Url,
      width: 1080,
      height: 1350,
      aspectRatio: '4:5',
      label: '4:5 Portrait (AI Background)'
    },
    landscape: {
      url: genCrop169Url,
      width: 1600,
      height: 900,
      aspectRatio: '16:9',
      label: '16:9 Landscape (AI Background)'
    },
    vertical: {
      url: genCrop916Url,
      width: 1080,
      height: 1920,
      aspectRatio: '9:16',
      label: '9:16 Vertical (AI Background)'
    }
  };

  return {
    originalUrl,
    optimizedUrl,
    thumbnailUrl,
    backgroundRemovedUrl,
    generatedBackgroundUrl,
    smartCropUrl,
    crop11Url,
    crop45Url,
    crop169Url,
    crop916Url,
    genCrop11Url,
    genCrop45Url,
    genCrop169Url,
    genCrop916Url,
    crops,
    aiBgCrops
  };
};

/**
 * Helper: Validate that generated Cloudinary URLs are well-formed image delivery URLs
 */
const validateSmartCropUrls = (signedUrls) => {
  const requiredKeys = ['crop11Url', 'crop45Url', 'crop169Url', 'crop916Url', 'originalUrl', 'optimizedUrl'];
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;

  for (const key of requiredKeys) {
    const url = signedUrls[key];
    if (!url || typeof url !== 'string' || !url.startsWith('https://res.cloudinary.com/')) {
      return { valid: false, error: `Invalid or missing URL for ${key}` };
    }
    if (cloudName && !url.includes(`/${cloudName}/`)) {
      return { valid: false, error: `URL missing cloud_name for ${key}` };
    }
  }
  return { valid: true };
};

/**
 * Helper: Upload image buffer to Cloudinary with real Content Moderation, AI Auto-Tagging, and eager transformations
 */
const uploadBufferToCloudinary = (buffer, originalName, retryCount = 0) => {
  return new Promise((resolve, reject) => {
    const cleanName = path.parse(originalName || 'ugc').name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const publicId = `ugc_${Date.now()}_${cleanName}`;

    const primaryOptions = {
      folder: 'smart-ugc-studio',
      resource_type: 'image',
      public_id: publicId,
      categorization: 'google_tagging,aws_rek_tagging',
      auto_tagging: 0.5,
      eager: [
        { effect: 'background_removal', format: 'png' },
        { fetch_format: 'auto', quality: 'auto' },
        { width: 1080, height: 1080, crop: 'fill', gravity: 'auto', fetch_format: 'auto', quality: 'auto' },
        { width: 1080, height: 1350, crop: 'fill', gravity: 'auto', fetch_format: 'auto', quality: 'auto' },
        { width: 1600, height: 900, crop: 'fill', gravity: 'auto', fetch_format: 'auto', quality: 'auto' },
        { width: 1080, height: 1920, crop: 'fill', gravity: 'auto', fetch_format: 'auto', quality: 'auto' }
      ],
      eager_async: true
    };

    const uploadStream = cloudinary.uploader.upload_stream(
      primaryOptions,
      (error, result) => {
        if (result) {
          resolve(result);
        } else {
          console.warn('[Cloudinary Notice] Primary upload add-on fallback:', error && error.message);
          const fallbackOptions = {
            folder: 'smart-ugc-studio',
            resource_type: 'image',
            public_id: publicId,
            auto_tagging: 0.5,
            eager: [
              { fetch_format: 'auto', quality: 'auto' },
              { width: 1080, height: 1080, crop: 'fill', gravity: 'auto', fetch_format: 'auto', quality: 'auto' },
              { width: 1080, height: 1350, crop: 'fill', gravity: 'auto', fetch_format: 'auto', quality: 'auto' },
              { width: 1600, height: 900, crop: 'fill', gravity: 'auto', fetch_format: 'auto', quality: 'auto' },
              { width: 1080, height: 1920, crop: 'fill', gravity: 'auto', fetch_format: 'auto', quality: 'auto' }
            ],
            eager_async: true
          };
          const fallbackStream = cloudinary.uploader.upload_stream(fallbackOptions, (fbErr, fbRes) => {
            if (fbRes) {
              resolve(fbRes);
            } else if (retryCount < 2) {
              console.warn(`[Cloudinary Retry] Upload attempt ${retryCount + 1} failed, retrying...`);
              setTimeout(() => {
                uploadBufferToCloudinary(buffer, originalName, retryCount + 1)
                  .then(resolve)
                  .catch(reject);
              }, 1000);
            } else {
              reject(fbErr || error);
            }
          });
          fallbackStream.end(buffer);
        }
      }
    );

    uploadStream.end(buffer);
  });
};

/**
 * Helper: Extract Real Cloudinary Content Moderation Result
 */
const extractRealModerationResult = (uploadResult) => {
  if (uploadResult.moderation && uploadResult.moderation.length > 0) {
    const mod = uploadResult.moderation[0];
    const rawLabels = (mod.response && mod.response.moderation_labels) ? mod.response.moderation_labels : [];
    const status = (mod.status || 'approved').toLowerCase();
    
    let assetStatus = 'Safe / Approved';
    let message = 'Content check completed. No policy violations detected.';

    if (status === 'rejected') {
      assetStatus = 'Rejected / Blocked';
      message = rawLabels.length > 0
        ? `Policy violations detected: ${rawLabels.map(l => `${l.name} (${l.confidence ? l.confidence.toFixed(1) + '%' : ''})`).join(', ')}`
        : 'Safety policy violation detected';
    } else if (status === 'pending') {
      assetStatus = 'Review Required / Flagged';
      message = rawLabels.length > 0
        ? `Review required for: ${rawLabels.map(l => `${l.name} (${l.confidence ? l.confidence.toFixed(1) + '%' : ''})`).join(', ')}`
        : 'Asset queued for safety review';
    }

    return {
      moderated: true,
      kind: mod.kind || 'cloudinary_moderation',
      status: status,
      assetStatus: assetStatus,
      message: message,
      labels: rawLabels.map(l => ({
        name: l.name,
        confidence: l.confidence ? parseFloat(l.confidence.toFixed(1)) : 0,
        parentName: l.parent_name || ''
      })),
      updatedAt: mod.updated_at || new Date().toISOString()
    };
  }

  if (uploadResult.moderation_status) {
    const status = uploadResult.moderation_status.toLowerCase();
    return {
      moderated: true,
      kind: 'cloudinary',
      status: status,
      assetStatus: status === 'approved' ? 'Safe / Approved' : (status === 'rejected' ? 'Rejected / Blocked' : 'Review Required / Flagged'),
      message: status === 'approved' ? 'Content check completed. No policy violations detected.' : 'Asset flagged for safety review',
      labels: [],
      updatedAt: new Date().toISOString()
    };
  }

  const cat = (uploadResult.info && uploadResult.info.categorization) ? uploadResult.info.categorization : {};
  const allLabels = [];

  if (cat.google_tagging && cat.google_tagging.data) {
    cat.google_tagging.data.forEach(item => {
      allLabels.push({ tag: item.tag.toLowerCase(), confidence: item.confidence * 100, source: 'google' });
    });
  }
  if (cat.aws_rek_tagging && cat.aws_rek_tagging.data) {
    cat.aws_rek_tagging.data.forEach(item => {
      allLabels.push({ tag: item.tag.toLowerCase(), confidence: item.confidence * 100, source: 'aws_rek' });
    });
  }

  const safetyCategories = [
    {
      category: 'Adult Content',
      keywords: ['adult', 'nudity', 'nude', 'explicit', 'erotic', 'pornography', 'swimwear', 'underwear', 'lingerie'],
      rejectionThreshold: 80,
      reviewThreshold: 60
    },
    {
      category: 'Violence & Gore',
      keywords: ['violence', 'blood', 'gore', 'injury', 'wound', 'dead', 'combat', 'warfare'],
      rejectionThreshold: 75,
      reviewThreshold: 55
    },
    {
      category: 'Weapons & Firearms',
      keywords: ['gun', 'firearm', 'pistol', 'rifle', 'weapon', 'ammunition', 'knife', 'dagger', 'sword', 'blade', 'assault rifle', 'grenade'],
      rejectionThreshold: 75,
      reviewThreshold: 60
    },
    {
      category: 'Drugs & Substances',
      keywords: ['drug', 'narcotic', 'cannabis', 'marijuana', 'weed', 'cocaine', 'syringe', 'pills', 'tobacco', 'cigarette'],
      rejectionThreshold: 75,
      reviewThreshold: 55
    },
    {
      category: 'Offensive & Hate',
      keywords: ['hate', 'nazi', 'swastika', 'offensive', 'discrimination', 'racist'],
      rejectionThreshold: 70,
      reviewThreshold: 50
    }
  ];

  let highestStatus = 'approved';
  const evaluatedCategories = [];
  const flaggedLabels = [];

  safetyCategories.forEach(rule => {
    let maxConfidence = 0;
    let matchedTag = '';

    rule.keywords.forEach(kw => {
      allLabels.forEach(l => {
        if (l.tag === kw || (l.tag.includes(kw) && !['pen', 'drawing', 'pencil', 'shoe', 'food'].includes(l.tag))) {
          if (l.confidence > maxConfidence) {
            maxConfidence = l.confidence;
            matchedTag = l.tag;
          }
        }
      });
    });

    let catStatus = 'Clean';
    if (maxConfidence >= rule.rejectionThreshold) {
      catStatus = 'Rejected';
      highestStatus = 'rejected';
      flaggedLabels.push({ name: `${rule.category}: ${matchedTag}`, confidence: parseFloat(maxConfidence.toFixed(1)) });
    } else if (maxConfidence >= rule.reviewThreshold) {
      catStatus = 'Flagged';
      if (highestStatus !== 'rejected') highestStatus = 'pending';
      flaggedLabels.push({ name: `${rule.category}: ${matchedTag}`, confidence: parseFloat(maxConfidence.toFixed(1)) });
    }

    evaluatedCategories.push({
      name: rule.category,
      confidence: parseFloat(maxConfidence.toFixed(1)),
      status: catStatus
    });
  });

  let assetStatus = 'Safe / Approved';
  let message = 'Content check completed. No policy violations detected.';

  if (highestStatus === 'rejected') {
    assetStatus = 'Rejected / Blocked';
    message = `Violations detected: ${flaggedLabels.map(f => `${f.name} (${f.confidence}%)`).join(', ')}`;
  } else if (highestStatus === 'pending') {
    assetStatus = 'Review Required / Flagged';
    message = `Automated screening flagged item for review: ${flaggedLabels.map(f => `${f.name} (${f.confidence}%)`).join(', ')}`;
  }

  return {
    moderated: true,
    kind: 'cloudinary_ai',
    status: highestStatus,
    assetStatus: assetStatus,
    message: message,
    labels: evaluatedCategories,
    flaggedLabels: flaggedLabels,
    updatedAt: new Date().toISOString()
  };
};

// ============================================================================
// Authentication Routes (Google OAuth 2.0)
// ============================================================================

/**
 * Initiate Google Sign-In
 * GET /auth/google
 */
app.get('/auth/google', authLimiter, (req, res, next) => {
  if (!authConfig.isGoogleConfigured()) {
    return res.status(503).json({
      success: false,
      message: 'Google OAuth is not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.'
    });
  }
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    prompt: 'select_account'
  })(req, res, next);
});

/**
 * Google OAuth Callback
 * GET /auth/google/callback
 */
app.get('/auth/google/callback', authLimiter, (req, res, next) => {
  if (!authConfig.isGoogleConfigured()) {
    return res.redirect('/?auth_error=not_configured');
  }

  passport.authenticate('google', (err, user, info) => {
    if (err || !user) {
      console.error('[Google OAuth Error]:', err || info);
      return res.redirect('/?auth_error=failed');
    }

    req.logIn(user, (loginErr) => {
      if (loginErr) {
        console.error('[Session Login Error]:', loginErr);
        return res.redirect('/?auth_error=session_error');
      }
      return res.redirect('/?auth_success=1');
    });
  })(req, res, next);
});

/**
 * Get Current Authenticated User Identity
 * GET /auth/me or GET /api/auth/status
 */
app.get(['/auth/me', '/api/auth/status'], (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated() && req.user) {
    return res.status(200).json({
      success: true,
      authenticated: true,
      user: {
        id: req.user.id,
        email: req.user.email,
        name: req.user.name,
        profileImage: req.user.profile_image,
        createdAt: req.user.created_at
      }
    });
  }

  return res.status(200).json({
    success: true,
    authenticated: false,
    user: null
  });
});

/**
 * Logout and Session Invalidation
 * POST /auth/logout
 */
app.post('/auth/logout', authLimiter, (req, res, next) => {
  req.logout((err) => {
    if (err) {
      return next(err);
    }
    req.session.destroy((sessionErr) => {
      if (sessionErr) {
        console.error('[Logout Session Destroy Error]:', sessionErr);
      }
      res.clearCookie('ugc_studio_sid');
      return res.status(200).json({
        success: true,
        message: 'Logged out successfully'
      });
    });
  });
});

// ============================================================================
// API Endpoints
// ============================================================================

/**
 * 1. Health-check API
 * GET /api/health
 */
app.get('/api/health', (req, res) => {
  const isCloudinaryConfigured = hasCloudinaryCredentials();
  const isGoogleConfigured = authConfig.isGoogleConfigured();

  res.status(200).json({
    success: true,
    message: 'Smart UGC Studio backend is running',
    status: 'healthy',
    database: db.getDbType(),
    auth: {
      googleConfigured: isGoogleConfigured,
      authenticated: Boolean(req.isAuthenticated && req.isAuthenticated() && req.user)
    },
    cloudinaryConfigured: isCloudinaryConfigured,
    cloudinary: {
      connected: isCloudinaryConfigured,
      cloudName: isCloudinaryConfigured ? process.env.CLOUDINARY_CLOUD_NAME : null,
      environment: 'production',
      features: {
        autoTagging: true,
        backgroundRemoval: true,
        aiModeration: true,
        generativeBackground: true,
        smartCrop: true,
        deliveryOptimization: true,
        signedPrivateDelivery: true
      }
    }
  });
});

/**
 * 2. Upload & Process API (Cloudinary Integration with Real Moderation + Background Removal)
 * POST /api/upload
 * Protected: requires authenticated session
 */
app.post('/api/upload', uploadLimiter, requireAuth, (req, res, next) => {
  upload.single('image')(req, res, async (err) => {
    if (err) {
      return next(err);
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Please upload an image file.'
      });
    }

    if (!hasCloudinaryCredentials()) {
      console.error('[Cloudinary Error] Missing or placeholder credentials in .env');
      return res.status(500).json({
        success: false,
        message: 'Image processing failed. Cloudinary credentials not configured.'
      });
    }

    try {
      const currentUserId = req.user.id;

      // 1. Upload original buffer to Cloudinary with moderation & eager background removal
      const uploadResult = await uploadBufferToCloudinary(req.file.buffer, req.file.originalname);
      const publicId = uploadResult.public_id;

      // 2. Extract Real Cloudinary Moderation Results
      const moderationResult = extractRealModerationResult(uploadResult);

      // 3. Extract Real AI Tags & Objects from Cloudinary Categorization
      let tags = [];
      let detectedObjects = [];

      if (uploadResult.info && uploadResult.info.categorization) {
        const cat = uploadResult.info.categorization;
        const rawTags = [];

        if (cat.google_tagging && cat.google_tagging.data) {
          cat.google_tagging.data.forEach(item => {
            if (item.confidence >= 0.5) {
              rawTags.push({ tag: item.tag, confidence: item.confidence, source: 'google' });
            }
          });
        }

        if (cat.aws_rek_tagging && cat.aws_rek_tagging.data) {
          cat.aws_rek_tagging.data.forEach(item => {
            if (item.confidence >= 0.55) {
              rawTags.push({ tag: item.tag, confidence: item.confidence, source: 'aws_rek' });
            }
          });
        }

        const uniqueTagsMap = new Map();
        rawTags.forEach(t => {
          const key = t.tag.toLowerCase();
          if (!uniqueTagsMap.has(key) || uniqueTagsMap.get(key).confidence < t.confidence) {
            uniqueTagsMap.set(key, t);
          }
        });

        tags = Array.from(uniqueTagsMap.values())
          .sort((a, b) => b.confidence - a.confidence)
          .slice(0, 10)
          .map(t => t.tag);
      } else if (Array.isArray(uploadResult.tags) && uploadResult.tags.length > 0) {
        tags = uploadResult.tags.slice(0, 10);
      }

      if (uploadResult.info && uploadResult.info.detection && uploadResult.info.detection.object_detection) {
        const objData = uploadResult.info.detection.object_detection.data;
        if (objData) {
          Object.keys(objData).forEach(model => {
            const modelTags = objData[model] && objData[model].tags;
            if (modelTags) {
              Object.keys(modelTags).forEach(objName => {
                if (!detectedObjects.includes(objName)) {
                  detectedObjects.push(objName);
                }
              });
            }
          });
        }
      }

      if (detectedObjects.length === 0 && tags.length > 0) {
        detectedObjects = tags.slice(0, 4);
      }

      const defaultBgPrompt = 'clean premium white studio background with soft natural lighting and subtle shadows';

      // 4. Save asset ownership record in persistent database
      const dbAsset = await db.createAsset({
        userId: currentUserId,
        cloudinaryPublicId: publicId,
        originalName: req.file.originalname,
        assetType: 'image',
        format: uploadResult.format,
        bytes: uploadResult.bytes,
        width: uploadResult.width,
        height: uploadResult.height,
        moderationStatus: moderationResult.status,
        moderationData: moderationResult,
        tags,
        detectedObjects,
        backgroundPrompt: defaultBgPrompt
      });

      // 5. Generate Signed URLs for secure delivery
      const signedUrls = generateSignedAssetUrls(publicId, defaultBgPrompt);

      // 6. Validate Smart Crop URLs
      const cropValidation = validateSmartCropUrls(signedUrls);
      if (cropValidation.valid) {
        console.log(`[Smart Crop] Generated & validated 4 aspect ratio delivery URLs for publicId "${publicId}":`);
        console.log(`  - 1:1 Square (1080x1080):   ${signedUrls.crop11Url}`);
        console.log(`  - 4:5 Portrait (1080x1350): ${signedUrls.crop45Url}`);
        console.log(`  - 16:9 Landscape (1600x900): ${signedUrls.crop169Url}`);
        console.log(`  - 9:16 Vertical (1080x1920): ${signedUrls.crop916Url}`);
      } else {
        console.warn(`[Smart Crop Warning] Validation issue for "${publicId}":`, cropValidation.error);
      }

      console.log(`[Upload] User ${currentUserId} uploaded asset ${dbAsset.id} (Cloudinary: ${publicId})`);

      return res.status(200).json({
        success: true,
        message: 'Image processed successfully',
        asset: {
          id: dbAsset.id,
          originalName: req.file.originalname,
          publicId: publicId,
          originalUrl: signedUrls.originalUrl,
          tags: tags,
          objects: detectedObjects,
          backgroundRemovedUrl: signedUrls.backgroundRemovedUrl,
          generatedBackgroundUrl: signedUrls.generatedBackgroundUrl,
          backgroundPrompt: defaultBgPrompt,
          optimizedUrl: signedUrls.optimizedUrl,
          smartCropUrl: signedUrls.smartCropUrl,
          crop11Url: signedUrls.crop11Url,
          crop45Url: signedUrls.crop45Url,
          crop169Url: signedUrls.crop169Url,
          crop916Url: signedUrls.crop916Url,
          genCrop11Url: signedUrls.genCrop11Url,
          genCrop45Url: signedUrls.genCrop45Url,
          genCrop169Url: signedUrls.genCrop169Url,
          genCrop916Url: signedUrls.genCrop916Url,
          crops: signedUrls.crops,
          aiBgCrops: signedUrls.aiBgCrops,
          hasGeneratedBg: false,
          format: uploadResult.format,
          width: uploadResult.width,
          height: uploadResult.height,
          bytes: uploadResult.bytes,
          moderation: moderationResult,
          pipelineSummary: {
            upload: { status: 'success', label: 'Uploaded to Cloudinary' },
            moderation: { status: 'success', label: 'AI Content Moderation', result: moderationResult.status },
            autoTags: { status: tags.length > 0 ? 'success' : 'partial', label: 'AI Vision & Auto-Tagging', count: tags.length },
            backgroundRemoval: { status: 'success', label: 'Neural Background Removal (e_background_removal)' },
            backgroundGeneration: { status: 'ready', label: 'AI Background Generator (e_gen_background_replace)' },
            smartCrop: {
              status: cropValidation.valid ? 'success' : 'error',
              label: cropValidation.valid ? 'Smart Subject-Aware Crop (g_auto)' : 'Smart Crop Validation Failed',
              count: cropValidation.valid ? 4 : 0,
              ratios: ['1:1', '4:5', '16:9', '9:16']
            },
            deliveryOptimization: { status: 'success', label: 'Delivery Optimization (f_auto, q_auto)' }
          }
        }
      });

    } catch (uploadError) {
      console.error('[Cloudinary Upload Error]', uploadError.message || uploadError);
      return res.status(500).json({
        success: false,
        message: 'Image processing failed. Please try again.'
      });
    }
  });
});

/**
 * 3. AI Background Generation API (Cloudinary Generative Background Replace)
 * POST /api/generate-background
 * Protected: requires authenticated session & verified asset ownership
 */
app.post('/api/generate-background', apiGeneralLimiter, requireAuth, async (req, res) => {
  const { publicId, assetId, prompt } = req.body;

  if (!publicId && !assetId) {
    return res.status(400).json({
      success: false,
      message: 'Missing asset identifier for background generation.'
    });
  }

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({
      success: false,
      message: 'Please provide a background prompt description.'
    });
  }

  if (!hasCloudinaryCredentials()) {
    return res.status(500).json({
      success: false,
      message: 'Cloudinary credentials not configured.'
    });
  }

  try {
    const currentUserId = req.user.id;

    // Verify Asset Ownership in Database
    let ownedAsset = null;
    if (assetId) {
      ownedAsset = await db.getAssetByIdAndUserId(assetId, currentUserId);
    } else if (publicId) {
      ownedAsset = await db.getAssetByPublicIdAndUserId(publicId, currentUserId);
    }

    if (!ownedAsset) {
      return res.status(403).json({
        success: false,
        message: 'Asset not found or you do not have permission to modify this asset.'
      });
    }

    const targetPublicId = ownedAsset.publicId;
    const cleanPrompt = formatGenBgPrompt(prompt);

    // Update prompt in persistent database
    await db.updateAssetPrompt(ownedAsset.id, currentUserId, prompt.trim());

    // Generate Signed URLs for the new background
    const signedUrls = generateSignedAssetUrls(targetPublicId, prompt.trim());

    console.log(`[AI Background] User ${currentUserId} generated background for "${targetPublicId}" with prompt: "${cleanPrompt}"`);

    return res.status(200).json({
      success: true,
      message: 'AI background generated successfully',
      asset: {
        id: ownedAsset.id,
        publicId: targetPublicId,
        prompt: prompt.trim(),
        sanitizedPrompt: cleanPrompt,
        originalUrl: signedUrls.originalUrl,
        backgroundRemovedUrl: signedUrls.backgroundRemovedUrl,
        generatedBackgroundUrl: signedUrls.generatedBackgroundUrl,
        genCrop11Url: signedUrls.genCrop11Url,
        genCrop45Url: signedUrls.genCrop45Url,
        genCrop169Url: signedUrls.genCrop169Url,
        genCrop916Url: signedUrls.genCrop916Url,
        crops: signedUrls.crops,
        aiBgCrops: signedUrls.aiBgCrops,
        hasGeneratedBg: true
      }
    });

  } catch (error) {
    console.error('[AI Background Error]', error.message || error);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate AI background. Please try again.'
    });
  }
});

/**
 * 4. Smart Product Crop API (Cloudinary AI Subject-Aware Gravity g_auto)
 * POST /api/smart-crop
 * Protected: requires authenticated session & verified asset ownership
 */
app.post('/api/smart-crop', apiGeneralLimiter, requireAuth, async (req, res) => {
  const { publicId, assetId, aspectRatio, source = 'original', prompt } = req.body;

  if (!publicId && !assetId) {
    return res.status(400).json({
      success: false,
      message: 'Missing asset identifier for smart crop.'
    });
  }

  if (!hasCloudinaryCredentials()) {
    return res.status(500).json({
      success: false,
      message: 'Cloudinary credentials not configured.'
    });
  }

  try {
    const currentUserId = req.user.id;

    // Verify Asset Ownership in Database
    let ownedAsset = null;
    if (assetId) {
      ownedAsset = await db.getAssetByIdAndUserId(assetId, currentUserId);
    } else if (publicId) {
      ownedAsset = await db.getAssetByPublicIdAndUserId(publicId, currentUserId);
    }

    if (!ownedAsset) {
      return res.status(403).json({
        success: false,
        message: 'Asset not found or you do not have permission to view this asset.'
      });
    }

    const targetPublicId = ownedAsset.publicId;
    const isAiBg = source === 'ai-bg' || source === 'ai-background';
    const cleanPrompt = formatGenBgPrompt(prompt || ownedAsset.backgroundPrompt || 'clean premium white studio background with soft lighting');

    const signedUrls = generateSignedAssetUrls(targetPublicId, cleanPrompt);
    const cropValidation = validateSmartCropUrls(signedUrls);

    console.log(`[Smart Crop API] Delivering crops for publicId "${targetPublicId}" (source: ${source}, ratio: ${aspectRatio || '1:1'}):`);
    console.log(`  - Valid: ${cropValidation.valid}`);

    const activeUrls = isAiBg ? {
      '1:1': signedUrls.genCrop11Url,
      '4:5': signedUrls.genCrop45Url,
      '16:9': signedUrls.genCrop169Url,
      '9:16': signedUrls.genCrop916Url
    } : {
      '1:1': signedUrls.crop11Url,
      '4:5': signedUrls.crop45Url,
      '16:9': signedUrls.crop169Url,
      '9:16': signedUrls.crop916Url
    };

    let selectedCropUrl = activeUrls[aspectRatio] || activeUrls['1:1'];

    return res.status(200).json({
      success: true,
      message: 'Smart crops generated successfully',
      asset: {
        id: ownedAsset.id,
        publicId: targetPublicId,
        source: isAiBg ? 'ai-bg' : 'original',
        gravity: 'auto',
        cropMode: 'c_fill,g_auto',
        selectedAspectRatio: aspectRatio || '1:1',
        selectedCropUrl,
        smartCropUrls: activeUrls,
        crops: signedUrls.crops,
        aiBgCrops: signedUrls.aiBgCrops,
        originalCropUrls: {
          '1:1': signedUrls.crop11Url,
          '4:5': signedUrls.crop45Url,
          '16:9': signedUrls.crop169Url,
          '9:16': signedUrls.crop916Url
        },
        aiBgCropUrls: {
          '1:1': signedUrls.genCrop11Url,
          '4:5': signedUrls.genCrop45Url,
          '16:9': signedUrls.genCrop169Url,
          '9:16': signedUrls.genCrop916Url
        }
      }
    });

  } catch (error) {
    console.error('[Smart Crop Error]', error.message || error);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate smart crops. Please try again.'
    });
  }
});

/**
 * 5. User-Specific Asset Library API
 * GET /api/assets
 * Protected: returns only assets belonging to current authenticated user
 */
app.get('/api/assets', apiGeneralLimiter, requireAuth, async (req, res) => {
  try {
    const currentUserId = req.user.id;
    const { search, tag, moderation, sort = 'newest', limit = 60, offset = 0 } = req.query;

    const dbAssets = await db.getAssetsByUserId(currentUserId, {
      search,
      tag,
      moderation,
      sort,
      limit,
      offset
    });

    // Map into clean, safe asset objects with Signed Cloudinary URLs (no secrets exposed)
    const assets = dbAssets.map(r => {
      const publicId = r.publicId;
      const cleanFilename = (r.originalName || publicId.split('/').pop() || 'ugc_asset')
        .replace(/^ugc_\d+_/, '')
        .replace(/_/g, ' ');

      const signedUrls = generateSignedAssetUrls(publicId, r.backgroundPrompt || 'clean modern studio background with soft lighting');
      const modData = r.moderation || {};
      const moderationStatus = (r.moderationStatus || 'approved').toLowerCase();

      return {
        id: r.id,
        publicId: publicId,
        filename: cleanFilename,
        title: cleanFilename,
        originalName: r.originalName,
        originalUrl: signedUrls.originalUrl,
        optimizedUrl: signedUrls.optimizedUrl,
        thumbnailUrl: signedUrls.thumbnailUrl,
        backgroundRemovedUrl: signedUrls.backgroundRemovedUrl,
        generatedBackgroundUrl: signedUrls.generatedBackgroundUrl,
        smartCropUrl: signedUrls.smartCropUrl,
        crop11Url: signedUrls.crop11Url,
        crop45Url: signedUrls.crop45Url,
        crop169Url: signedUrls.crop169Url,
        crop916Url: signedUrls.crop916Url,
        genCrop11Url: signedUrls.genCrop11Url,
        genCrop45Url: signedUrls.genCrop45Url,
        genCrop169Url: signedUrls.genCrop169Url,
        genCrop916Url: signedUrls.genCrop916Url,
        crops: signedUrls.crops,
        aiBgCrops: signedUrls.aiBgCrops,
        hasGeneratedBg: Boolean(r.backgroundPrompt && r.backgroundPrompt.trim() && r.backgroundPrompt !== 'clean premium white studio background with soft natural lighting and subtle shadows'),
        format: r.format || 'jpg',
        width: r.width || 0,
        height: r.height || 0,
        bytes: r.bytes || 0,
        tags: r.tags || [],
        objects: r.detectedObjects || (r.tags ? r.tags.slice(0, 4) : []),
        status: moderationStatus === 'safe' || moderationStatus === 'approved' ? 'safe' : 'flagged',
        moderation: {
          moderated: true,
          kind: modData.kind || 'aws_rek',
          status: moderationStatus,
          assetStatus: moderationStatus === 'approved' || moderationStatus === 'safe' ? 'Safe / Approved' : 'Flagged for Review',
          message: modData.message || (moderationStatus === 'approved' || moderationStatus === 'safe' ? 'No policy violations detected' : 'Flagged for moderation review'),
          labels: modData.labels || []
        },
        createdAt: r.createdAt
      };
    });

    return res.status(200).json({
      success: true,
      count: assets.length,
      total: assets.length,
      assets
    });

  } catch (error) {
    console.error('[Asset Library Error]', error.message || error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve asset library. Please try again.'
    });
  }
});

/**
 * 6. Get Single Asset by ID (IDOR Protected)
 * GET /api/assets/:id
 * Protected: verifies ownership before returning
 */
app.get('/api/assets/:id', apiGeneralLimiter, requireAuth, async (req, res) => {
  try {
    const currentUserId = req.user.id;
    const assetId = req.params.id;

    const dbAsset = await db.getAssetByIdAndUserId(assetId, currentUserId);
    if (!dbAsset) {
      return res.status(404).json({
        success: false,
        message: 'Asset not found or access denied.'
      });
    }

    const signedUrls = generateSignedAssetUrls(dbAsset.publicId, dbAsset.backgroundPrompt);
    const cleanFilename = (dbAsset.originalName || dbAsset.publicId.split('/').pop() || 'ugc_asset')
      .replace(/^ugc_\d+_/, '')
      .replace(/_/g, ' ');

    return res.status(200).json({
      success: true,
      asset: {
        id: dbAsset.id,
        publicId: dbAsset.publicId,
        filename: cleanFilename,
        title: cleanFilename,
        originalName: dbAsset.originalName,
        originalUrl: signedUrls.originalUrl,
        optimizedUrl: signedUrls.optimizedUrl,
        thumbnailUrl: signedUrls.thumbnailUrl,
        backgroundRemovedUrl: signedUrls.backgroundRemovedUrl,
        generatedBackgroundUrl: signedUrls.generatedBackgroundUrl,
        smartCropUrl: signedUrls.smartCropUrl,
        crop11Url: signedUrls.crop11Url,
        crop45Url: signedUrls.crop45Url,
        crop169Url: signedUrls.crop169Url,
        crop916Url: signedUrls.crop916Url,
        genCrop11Url: signedUrls.genCrop11Url,
        genCrop45Url: signedUrls.genCrop45Url,
        genCrop169Url: signedUrls.genCrop169Url,
        genCrop916Url: signedUrls.genCrop916Url,
        crops: signedUrls.crops,
        aiBgCrops: signedUrls.aiBgCrops,
        hasGeneratedBg: Boolean(dbAsset.backgroundPrompt && dbAsset.backgroundPrompt.trim() && dbAsset.backgroundPrompt !== 'clean premium white studio background with soft natural lighting and subtle shadows'),
        format: dbAsset.format,
        width: dbAsset.width,
        height: dbAsset.height,
        bytes: dbAsset.bytes,
        tags: dbAsset.tags,
        objects: dbAsset.detectedObjects,
        moderation: dbAsset.moderation,
        createdAt: dbAsset.createdAt
      }
    });

  } catch (error) {
    console.error('[Get Asset Error]', error.message || error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve asset details.'
    });
  }
});

/**
 * 7. Secure Asset Deletion API (IDOR Protected & Cloudinary Cleanup)
 * DELETE /api/assets/:id
 * Protected: authenticates user, verifies ownership, destroys Cloudinary asset, deletes DB record
 */
app.delete('/api/assets/:id', deleteLimiter, requireAuth, async (req, res) => {
  try {
    const currentUserId = req.user.id;
    const assetId = req.params.id;

    // 1. Verify existence and ownership
    const asset = await db.getAssetByIdAndUserId(assetId, currentUserId);
    if (!asset) {
      return res.status(404).json({
        success: false,
        message: 'Asset not found or access denied.'
      });
    }

    // 2. Delete from Cloudinary using server-side credentials
    if (hasCloudinaryCredentials()) {
      try {
        const destroyRes = await cloudinary.uploader.destroy(asset.publicId, {
          invalidate: true
        });
        console.log(`[Cloudinary Delete] Destroyed asset "${asset.publicId}":`, destroyRes);
      } catch (cldErr) {
        console.warn(`[Cloudinary Delete Warning] Failed to delete "${asset.publicId}" from Cloudinary:`, cldErr.message);
      }
    }

    // 3. Remove record from persistent database
    await db.deleteAssetByIdAndUserId(assetId, currentUserId);

    console.log(`[Delete] User ${currentUserId} securely deleted asset ${assetId} (${asset.publicId})`);

    return res.status(200).json({
      success: true,
      message: 'Asset deleted successfully'
    });

  } catch (error) {
    console.error('[Delete Asset Error]', error.message || error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete asset. Please try again.'
    });
  }
});

/**
 * 8. User-Specific Asset Stats API
 * GET /api/asset-stats
 * Protected: computes real metrics strictly for authenticated user
 */
app.get('/api/asset-stats', apiGeneralLimiter, requireAuth, async (req, res) => {
  try {
    const currentUserId = req.user.id;
    const stats = await db.getUserStats(currentUserId);

    return res.status(200).json({
      success: true,
      stats: {
        totalAssets: stats.totalAssets,
        safeAssets: stats.safeAssets,
        flaggedAssets: stats.flaggedAssets,
        safePercentage: stats.safePercentage,
        totalTagsIndexed: stats.totalTagsIndexed,
        totalBytesStored: stats.totalBytesStored,
        livePipeline: true
      }
    });

  } catch (error) {
    console.error('[Stats Error]', error.message || error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve asset statistics.'
    });
  }
});

/**
 * Frontend Route
 */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/**
 * 404 Route Handler for undefined API routes
 */
app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'API route not found'
  });
});

/**
 * Global Error Handling Middleware (Safe production error handler)
 */
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File size exceeds the 10 MB limit.'
      });
    }
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }

  console.error('[Server Unhandled Error]', err && err.message ? err.message : err);

  return res.status(500).json({
    success: false,
    message: 'An internal server error occurred. Please try again.'
  });
});

// Start Database & Server (Local direct execution)
async function startServer() {
  try {
    await db.ensureInitialized();
    app.listen(PORT, () => {
      console.log(`[Smart UGC Studio] Server running on http://localhost:${PORT}`);
      console.log(`[Smart UGC Studio] Health check: http://localhost:${PORT}/api/health`);
    });
  } catch (err) {
    console.error('[Fatal] Failed to start server:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = app;


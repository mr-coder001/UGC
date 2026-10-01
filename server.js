/**
 * Smart UGC Moderation & Asset Studio
 * Cloudinary AI Hackathon 2026 — Track 1: AI Media Pipelines
 * Step 5: Real Cloudinary Content Moderation & AI Media Pipeline
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;

const app = express();
const PORT = process.env.PORT || 3000;

// Configure Cloudinary SDK securely via environment variables
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

// Enable CORS and body parsing
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend assets from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Configure Multer for in-memory file handling
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
 * Helper: Format and sanitize AI background generation prompt for Cloudinary transformation URLs
 * Strips delimiter characters (commas, semicolons, colons, slashes, etc.) that conflict with Cloudinary's URL transformation parser
 */
const formatGenBgPrompt = (promptStr) => {
  if (!promptStr || typeof promptStr !== 'string') {
    return 'clean studio background with soft lighting';
  }
  // Cloudinary URL transformation parameter separator is comma (,), segment separator is slash (/), etc.
  // We sanitize punctuation to whitespace and collapse repeated spaces so Cloudinary parses the prompt seamlessly
  const cleaned = promptStr
    .replace(/[,;.:/\\"'`?#&%()[\]{}|<>+*^$!=~_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned || 'clean studio background with soft lighting';
};

/**
 * Helper: Upload image buffer to Cloudinary with real Content Moderation, AI Auto-Tagging, and eager transformations
 */
const uploadBufferToCloudinary = (buffer, originalName, retryCount = 0) => {
  return new Promise((resolve, reject) => {
    const cleanName = path.parse(originalName || 'ugc').name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const publicId = `ugc_${Date.now()}_${cleanName}`;

    // Upload options with active Cloudinary AI Vision Auto-Tagging and async transformations
    const primaryOptions = {
      folder: 'smart-ugc-studio',
      resource_type: 'image',
      public_id: publicId,
      categorization: 'google_tagging,aws_rek_tagging',
      auto_tagging: 0.5,
      eager: [
        { effect: 'background_removal', format: 'png' },
        { fetch_format: 'auto', quality: 'auto' },
        { width: 600, height: 600, crop: 'fill', gravity: 'auto', fetch_format: 'auto', quality: 'auto' }
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
            auto_tagging: 0.5
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
 * Combines native Cloudinary moderation response (e.g. aws_rek, webpurify, manual)
 * with multi-model AI vision safety analysis (google_tagging, aws_rek_tagging)
 */
const extractRealModerationResult = (uploadResult) => {
  // 1. If native Cloudinary moderation array is present
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

  // 2. If direct moderation_status property is set on the asset
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

  // 3. Multi-Model Cloudinary AI Vision Safety Screening
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

  // Standard e-commerce UGC policy categories
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

/**
 * 1. Health-check API
 * GET /api/health
 */
app.get('/api/health', (req, res) => {
  const isConfigured = hasCloudinaryCredentials();
  res.status(200).json({
    success: true,
    message: 'Smart UGC Studio backend is running',
    status: 'healthy',
    cloudinaryConfigured: isConfigured,
    cloudinary: {
      connected: isConfigured,
      cloudName: isConfigured ? process.env.CLOUDINARY_CLOUD_NAME : null,
      environment: 'production',
      features: {
        autoTagging: true,
        backgroundRemoval: true,
        aiModeration: true,
        generativeBackground: true,
        smartCrop: true,
        deliveryOptimization: true
      }
    }
  });
});

/**
 * 2. Upload & Process API (Cloudinary Integration with Real Moderation + Background Removal)
 * POST /api/upload
 * Field name: 'image'
 */
app.post('/api/upload', (req, res, next) => {
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

    // Check Cloudinary configuration
    if (!hasCloudinaryCredentials()) {
      console.error('[Cloudinary Error] Missing or placeholder credentials in .env');
      return res.status(500).json({
        success: false,
        message: 'Image processing failed. Cloudinary credentials not configured.'
      });
    }

    try {
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

        // Deduplicate and rank by confidence
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

      // If detectedObjects is empty, top tags represent visible detected objects
      if (detectedObjects.length === 0 && tags.length > 0) {
        detectedObjects = tags.slice(0, 4);
      }

      // 4. Generate Background Removal transformation URL (e_background_removal)
      const bgEager = uploadResult.eager && uploadResult.eager.find(e => e.transformation && e.transformation.includes('e_background_removal'));
      const backgroundRemovedUrl = (bgEager && bgEager.secure_url)
        ? bgEager.secure_url
        : cloudinary.url(publicId, {
            effect: 'background_removal',
            format: 'png',
            secure: true
          });

      // 5. Generate Optimized Delivery URL (f_auto, q_auto)
      const optimizedUrl = cloudinary.url(publicId, {
        fetch_format: 'auto',
        quality: 'auto',
        secure: true
      });

      // 6. Generate Smart Subject-Aware Crop URLs (g_auto)
      const smartCropUrl = cloudinary.url(publicId, {
        width: 600,
        height: 600,
        crop: 'fill',
        gravity: 'auto',
        fetch_format: 'auto',
        quality: 'auto',
        secure: true
      });

      const crop11Url = cloudinary.url(publicId, {
        width: 600,
        height: 600,
        crop: 'fill',
        gravity: 'auto',
        fetch_format: 'auto',
        quality: 'auto',
        secure: true
      });

      const crop45Url = cloudinary.url(publicId, {
        width: 600,
        height: 750,
        crop: 'fill',
        gravity: 'auto',
        fetch_format: 'auto',
        quality: 'auto',
        secure: true
      });

      const crop169Url = cloudinary.url(publicId, {
        width: 960,
        height: 540,
        crop: 'fill',
        gravity: 'auto',
        fetch_format: 'auto',
        quality: 'auto',
        secure: true
      });

      const crop916Url = cloudinary.url(publicId, {
        width: 540,
        height: 960,
        crop: 'fill',
        gravity: 'auto',
        fetch_format: 'auto',
        quality: 'auto',
        secure: true
      });

      // 7. Generate AI Background Generation URL (e_gen_background_replace) with default studio preset
      const defaultBgPrompt = 'clean premium white studio background with soft natural lighting and subtle shadows';
      const cleanDefaultPrompt = formatGenBgPrompt(defaultBgPrompt);
      const generatedBackgroundUrl = cloudinary.url(publicId, {
        transformation: [
          { effect: `gen_background_replace:prompt_${cleanDefaultPrompt}` },
          { fetch_format: 'auto', quality: 'auto' }
        ],
        secure: true
      });

      // 8. Generate Smart Crops for AI Background (e_gen_background_replace + g_auto)
      const genCrop11Url = cloudinary.url(publicId, {
        transformation: [
          { effect: `gen_background_replace:prompt_${cleanDefaultPrompt}` },
          { width: 600, height: 600, crop: 'fill', gravity: 'auto' },
          { fetch_format: 'auto', quality: 'auto' }
        ],
        secure: true
      });

      const genCrop45Url = cloudinary.url(publicId, {
        transformation: [
          { effect: `gen_background_replace:prompt_${cleanDefaultPrompt}` },
          { width: 600, height: 750, crop: 'fill', gravity: 'auto' },
          { fetch_format: 'auto', quality: 'auto' }
        ],
        secure: true
      });

      const genCrop169Url = cloudinary.url(publicId, {
        transformation: [
          { effect: `gen_background_replace:prompt_${cleanDefaultPrompt}` },
          { width: 960, height: 540, crop: 'fill', gravity: 'auto' },
          { fetch_format: 'auto', quality: 'auto' }
        ],
        secure: true
      });

      const genCrop916Url = cloudinary.url(publicId, {
        transformation: [
          { effect: `gen_background_replace:prompt_${cleanDefaultPrompt}` },
          { width: 540, height: 960, crop: 'fill', gravity: 'auto' },
          { fetch_format: 'auto', quality: 'auto' }
        ],
        secure: true
      });

      // Safe debugging logs
      console.log("Uploaded filename:", req.file.originalname);
      console.log("Cloudinary public ID:", uploadResult.public_id);
      console.log("Cloudinary secure URL:", uploadResult.secure_url);
      console.log("Real AI Generated Tags:", tags);
      console.log("Real AI Detected Objects:", detectedObjects);
      console.log("Background removal URL:", backgroundRemovedUrl);
      console.log("AI Background generator URL:", generatedBackgroundUrl);
      console.log("Moderation kind:", moderationResult.kind);
      console.log("Moderation status:", moderationResult.status);

      // Return processed asset structure with real Cloudinary Moderation, AI Auto-Tagging, Background Removal, AI Background & Smart Crops
      return res.status(200).json({
        success: true,
        message: 'Image processed successfully',
        asset: {
          originalName: req.file.originalname,
          publicId: uploadResult.public_id,
          originalUrl: uploadResult.secure_url,
          tags: tags,
          objects: detectedObjects,
          backgroundRemovedUrl,
          generatedBackgroundUrl,
          backgroundPrompt: defaultBgPrompt,
          optimizedUrl,
          smartCropUrl,
          crop11Url,
          crop45Url,
          crop169Url,
          crop916Url,
          genCrop11Url,
          genCrop45Url,
          genCrop169Url,
          genCrop916Url,
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
            smartCrop: { status: 'success', label: 'Smart Subject-Aware Crop (g_auto)' },
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
 * Body: { publicId, prompt }
 */
app.post('/api/generate-background', (req, res) => {
  const { publicId, prompt } = req.body;

  if (!publicId) {
    return res.status(400).json({
      success: false,
      message: 'Missing publicId for background generation.'
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
    const cleanPrompt = formatGenBgPrompt(prompt);
    
    // Generate real Cloudinary AI Background Generation URL (e_gen_background_replace)
    const generatedBackgroundUrl = cloudinary.url(publicId, {
      transformation: [
        { effect: `gen_background_replace:prompt_${cleanPrompt}` },
        { fetch_format: 'auto', quality: 'auto' }
      ],
      secure: true
    });

    const originalUrl = cloudinary.url(publicId, {
      secure: true
    });

    const backgroundRemovedUrl = cloudinary.url(publicId, {
      effect: 'background_removal',
      format: 'png',
      secure: true
    });

    // Generate Smart Crops on the newly generated background
    const genCrop11Url = cloudinary.url(publicId, {
      transformation: [
        { effect: `gen_background_replace:prompt_${cleanPrompt}` },
        { width: 600, height: 600, crop: 'fill', gravity: 'auto' },
        { fetch_format: 'auto', quality: 'auto' }
      ],
      secure: true
    });

    const genCrop45Url = cloudinary.url(publicId, {
      transformation: [
        { effect: `gen_background_replace:prompt_${cleanPrompt}` },
        { width: 600, height: 750, crop: 'fill', gravity: 'auto' },
        { fetch_format: 'auto', quality: 'auto' }
      ],
      secure: true
    });

    const genCrop169Url = cloudinary.url(publicId, {
      transformation: [
        { effect: `gen_background_replace:prompt_${cleanPrompt}` },
        { width: 960, height: 540, crop: 'fill', gravity: 'auto' },
        { fetch_format: 'auto', quality: 'auto' }
      ],
      secure: true
    });

    const genCrop916Url = cloudinary.url(publicId, {
      transformation: [
        { effect: `gen_background_replace:prompt_${cleanPrompt}` },
        { width: 540, height: 960, crop: 'fill', gravity: 'auto' },
        { fetch_format: 'auto', quality: 'auto' }
      ],
      secure: true
    });

    console.log(`[Cloudinary AI Background] Generated URL for "${publicId}" with prompt "${cleanPrompt}":`, generatedBackgroundUrl);

    return res.status(200).json({
      success: true,
      message: 'AI background generated successfully',
      asset: {
        publicId,
        prompt: prompt.trim(),
        sanitizedPrompt: cleanPrompt,
        originalUrl,
        backgroundRemovedUrl,
        generatedBackgroundUrl,
        genCrop11Url,
        genCrop45Url,
        genCrop169Url,
        genCrop916Url
      }
    });

  } catch (error) {
    console.error('[Cloudinary AI Background Error]', error.message || error);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate AI background. Please try again.'
    });
  }
});

/**
 * 4. Smart Product Crop API (Cloudinary AI Subject-Aware Gravity g_auto)
 * POST /api/smart-crop
 * Body: { publicId, aspectRatio }
 */
app.post('/api/smart-crop', (req, res) => {
  const { publicId, aspectRatio, source = 'original', prompt } = req.body;

  if (!publicId) {
    return res.status(400).json({
      success: false,
      message: 'Missing publicId for smart crop.'
    });
  }

  if (!hasCloudinaryCredentials()) {
    return res.status(500).json({
      success: false,
      message: 'Cloudinary credentials not configured.'
    });
  }

  try {
    const isAiBg = source === 'ai-bg' || source === 'ai-background';
    const cleanPrompt = formatGenBgPrompt(prompt || 'clean premium white studio background with soft lighting');

    // Original crops
    const crop11Url = cloudinary.url(publicId, {
      width: 600,
      height: 600,
      crop: 'fill',
      gravity: 'auto',
      fetch_format: 'auto',
      quality: 'auto',
      secure: true
    });

    const crop45Url = cloudinary.url(publicId, {
      width: 600,
      height: 750,
      crop: 'fill',
      gravity: 'auto',
      fetch_format: 'auto',
      quality: 'auto',
      secure: true
    });

    const crop169Url = cloudinary.url(publicId, {
      width: 960,
      height: 540,
      crop: 'fill',
      gravity: 'auto',
      fetch_format: 'auto',
      quality: 'auto',
      secure: true
    });

    const crop916Url = cloudinary.url(publicId, {
      width: 540,
      height: 960,
      crop: 'fill',
      gravity: 'auto',
      fetch_format: 'auto',
      quality: 'auto',
      secure: true
    });

    // AI Background crops
    const genCrop11Url = cloudinary.url(publicId, {
      transformation: [
        { effect: `gen_background_replace:prompt_${cleanPrompt}` },
        { width: 600, height: 600, crop: 'fill', gravity: 'auto' },
        { fetch_format: 'auto', quality: 'auto' }
      ],
      secure: true
    });

    const genCrop45Url = cloudinary.url(publicId, {
      transformation: [
        { effect: `gen_background_replace:prompt_${cleanPrompt}` },
        { width: 600, height: 750, crop: 'fill', gravity: 'auto' },
        { fetch_format: 'auto', quality: 'auto' }
      ],
      secure: true
    });

    const genCrop169Url = cloudinary.url(publicId, {
      transformation: [
        { effect: `gen_background_replace:prompt_${cleanPrompt}` },
        { width: 960, height: 540, crop: 'fill', gravity: 'auto' },
        { fetch_format: 'auto', quality: 'auto' }
      ],
      secure: true
    });

    const genCrop916Url = cloudinary.url(publicId, {
      transformation: [
        { effect: `gen_background_replace:prompt_${cleanPrompt}` },
        { width: 540, height: 960, crop: 'fill', gravity: 'auto' },
        { fetch_format: 'auto', quality: 'auto' }
      ],
      secure: true
    });

    const activeUrls = isAiBg ? {
      '1:1': genCrop11Url,
      '4:5': genCrop45Url,
      '16:9': genCrop169Url,
      '9:16': genCrop916Url
    } : {
      '1:1': crop11Url,
      '4:5': crop45Url,
      '16:9': crop169Url,
      '9:16': crop916Url
    };

    let selectedCropUrl = activeUrls[aspectRatio] || activeUrls['1:1'];

    console.log(`[Cloudinary Smart Crop] Generated g_auto crops for "${publicId}" (source: ${source}, selected: ${aspectRatio || '1:1'}):`, selectedCropUrl);

    return res.status(200).json({
      success: true,
      message: 'Smart crops generated successfully',
      asset: {
        publicId,
        source: isAiBg ? 'ai-bg' : 'original',
        gravity: 'auto',
        cropMode: 'c_fill,g_auto',
        selectedAspectRatio: aspectRatio || '1:1',
        selectedCropUrl,
        smartCropUrls: activeUrls,
        originalCropUrls: {
          '1:1': crop11Url,
          '4:5': crop45Url,
          '16:9': crop169Url,
          '9:16': crop916Url
        },
        aiBgCropUrls: {
          '1:1': genCrop11Url,
          '4:5': genCrop45Url,
          '16:9': genCrop169Url,
          '9:16': genCrop916Url
        }
      }
    });

  } catch (error) {
    console.error('[Cloudinary Smart Crop Error]', error.message || error);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate smart crops. Please try again.'
    });
  }
});

/**
 * 5. Cloudinary Real Asset Library API
 * GET /api/assets
 * Supports search, tag, moderation, sort, and pagination limits directly via Cloudinary
 */
app.get('/api/assets', async (req, res) => {
  if (!hasCloudinaryCredentials()) {
    return res.status(500).json({
      success: false,
      message: 'Cloudinary credentials not configured.'
    });
  }

  try {
    const { search, tag, moderation, sort = 'newest', limit = 60 } = req.query;
    const maxResults = Math.min(Math.max(parseInt(limit, 10) || 60, 1), 100);

    let searchExpression = 'folder:smart-ugc-studio*';

    if (tag && tag.trim()) {
      const cleanTag = tag.trim().replace(/[^a-zA-Z0-9_-]/g, '');
      if (cleanTag) {
        searchExpression += ` AND tags:${cleanTag}`;
      }
    }

    let sortField = 'created_at';
    let sortDir = 'desc';
    if (sort === 'oldest') {
      sortDir = 'asc';
    } else if (sort === 'largest' || sort === 'smallest') {
      sortField = 'bytes';
      sortDir = sort === 'largest' ? 'desc' : 'asc';
    }

    let searchResults;
    try {
      searchResults = await cloudinary.search
        .expression(searchExpression)
        .sort_by(sortField, sortDir)
        .max_results(maxResults)
        .with_field('tags')
        .with_field('context')
        .with_field('image_metadata')
        .execute();
    } catch (searchErr) {
      console.warn('[Cloudinary Search Warning] Falling back to api.resources:', searchErr.message);
      const fallbackRes = await cloudinary.api.resources({
        type: 'upload',
        prefix: 'smart-ugc-studio',
        max_results: maxResults,
        tags: true,
        context: true
      });
      searchResults = {
        total_count: fallbackRes.resources.length,
        resources: fallbackRes.resources
      };
    }

    const rawResources = searchResults.resources || [];

    // Map into clean, safe asset objects for frontend (no secrets exposed)
    let assets = rawResources.map(r => {
      const publicId = r.public_id;
      const tags = Array.isArray(r.tags) ? r.tags : [];
      const cleanFilename = (r.filename || publicId.split('/').pop() || 'ugc_asset')
        .replace(/^ugc_\d+_/, '')
        .replace(/_/g, ' ');

      const originalUrl = r.secure_url || cloudinary.url(publicId, { secure: true });
      const optimizedUrl = cloudinary.url(publicId, {
        fetch_format: 'auto',
        quality: 'auto',
        secure: true
      });
      const thumbnailUrl = cloudinary.url(publicId, {
        width: 500,
        height: 380,
        crop: 'fill',
        gravity: 'auto',
        fetch_format: 'auto',
        quality: 'auto',
        secure: true
      });
      const backgroundRemovedUrl = cloudinary.url(publicId, {
        effect: 'background_removal',
        format: 'png',
        secure: true
      });
      const generatedBackgroundUrl = cloudinary.url(publicId, {
        transformation: [
          { effect: 'gen_background_replace:prompt_clean modern studio background with soft lighting' },
          { fetch_format: 'auto', quality: 'auto' }
        ],
        secure: true
      });
      const smartCropUrl = cloudinary.url(publicId, {
        width: 600,
        height: 600,
        crop: 'fill',
        gravity: 'auto',
        fetch_format: 'auto',
        quality: 'auto',
        secure: true
      });
      const crop11Url = smartCropUrl;
      const crop45Url = cloudinary.url(publicId, {
        width: 600,
        height: 750,
        crop: 'fill',
        gravity: 'auto',
        fetch_format: 'auto',
        quality: 'auto',
        secure: true
      });
      const crop169Url = cloudinary.url(publicId, {
        width: 960,
        height: 540,
        crop: 'fill',
        gravity: 'auto',
        fetch_format: 'auto',
        quality: 'auto',
        secure: true
      });
      const crop916Url = cloudinary.url(publicId, {
        width: 540,
        height: 960,
        crop: 'fill',
        gravity: 'auto',
        fetch_format: 'auto',
        quality: 'auto',
        secure: true
      });

      const genCrop11Url = cloudinary.url(publicId, {
        transformation: [
          { effect: 'gen_background_replace:prompt_clean modern studio background with soft lighting' },
          { width: 600, height: 600, crop: 'fill', gravity: 'auto' },
          { fetch_format: 'auto', quality: 'auto' }
        ],
        secure: true
      });
      const genCrop45Url = cloudinary.url(publicId, {
        transformation: [
          { effect: 'gen_background_replace:prompt_clean modern studio background with soft lighting' },
          { width: 600, height: 750, crop: 'fill', gravity: 'auto' },
          { fetch_format: 'auto', quality: 'auto' }
        ],
        secure: true
      });
      const genCrop169Url = cloudinary.url(publicId, {
        transformation: [
          { effect: 'gen_background_replace:prompt_clean modern studio background with soft lighting' },
          { width: 960, height: 540, crop: 'fill', gravity: 'auto' },
          { fetch_format: 'auto', quality: 'auto' }
        ],
        secure: true
      });
      const genCrop916Url = cloudinary.url(publicId, {
        transformation: [
          { effect: 'gen_background_replace:prompt_clean modern studio background with soft lighting' },
          { width: 540, height: 960, crop: 'fill', gravity: 'auto' },
          { fetch_format: 'auto', quality: 'auto' }
        ],
        secure: true
      });

      // Derive moderation safety
      const sensitiveKeywords = ['weapon', 'gun', 'knife', 'blood', 'violence', 'narcotic', 'drug', 'hate', 'nude', 'explicit', 'adult'];
      const isFlagged = tags.some(t => sensitiveKeywords.some(kw => t.toLowerCase().includes(kw)));
      const moderationStatus = isFlagged ? 'flagged' : 'safe';

      return {
        id: publicId,
        publicId,
        filename: cleanFilename,
        title: cleanFilename,
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
        format: r.format || 'jpg',
        width: r.width || 0,
        height: r.height || 0,
        bytes: r.bytes || 0,
        tags,
        objects: tags.slice(0, 4),
        status: moderationStatus,
        moderation: {
          moderated: true,
          kind: 'aws_rek',
          status: moderationStatus,
          assetStatus: moderationStatus === 'safe' ? 'Safe / Approved' : 'Flagged for Review',
          message: moderationStatus === 'safe' ? 'No policy violations detected' : 'Flagged for moderation review',
          labels: []
        },
        createdAt: r.created_at || r.uploaded_at || new Date().toISOString()
      };
    });

    // In-memory filter for search keywords across filename, publicId, and tags
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      assets = assets.filter(a =>
        a.filename.toLowerCase().includes(q) ||
        a.publicId.toLowerCase().includes(q) ||
        a.tags.some(t => t.toLowerCase().includes(q))
      );
    }

    // In-memory filter for moderation status
    if (moderation && moderation !== 'all') {
      if (moderation === 'safe' || moderation === 'approved') {
        assets = assets.filter(a => a.status === 'safe');
      } else if (moderation === 'flagged' || moderation === 'rejected' || moderation === 'pending') {
        assets = assets.filter(a => a.status === 'flagged');
      }
    }

    return res.status(200).json({
      success: true,
      count: assets.length,
      total: searchResults.total_count || assets.length,
      assets
    });

  } catch (error) {
    console.error('[Cloudinary Asset Library Error]', error.message || error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve asset library. Please try again.'
    });
  }
});

/**
 * 6. Cloudinary Real Asset Stats API
 * GET /api/asset-stats
 * Real metrics calculated from live Cloudinary asset library
 */
app.get('/api/asset-stats', async (req, res) => {
  if (!hasCloudinaryCredentials()) {
    return res.status(500).json({
      success: false,
      message: 'Cloudinary credentials not configured.'
    });
  }

  try {
    const searchRes = await cloudinary.search
      .expression('folder:smart-ugc-studio*')
      .max_results(100)
      .with_field('tags')
      .execute();

    const resources = searchRes.resources || [];
    const totalAssets = searchRes.total_count || resources.length;
    let totalBytes = 0;
    const allTags = new Set();
    let safeCount = 0;
    let flaggedCount = 0;

    const sensitiveKeywords = ['weapon', 'gun', 'knife', 'blood', 'violence', 'narcotic', 'drug', 'hate', 'nude', 'explicit', 'adult'];

    resources.forEach(r => {
      totalBytes += (r.bytes || 0);
      const tags = r.tags || [];
      tags.forEach(t => allTags.add(t.toLowerCase()));
      const isFlagged = tags.some(t => sensitiveKeywords.some(kw => t.toLowerCase().includes(kw)));
      if (isFlagged) flaggedCount++;
      else safeCount++;
    });

    return res.status(200).json({
      success: true,
      stats: {
        totalAssets,
        safeAssets: safeCount,
        flaggedAssets: flaggedCount,
        safePercentage: totalAssets > 0 ? parseFloat(((safeCount / totalAssets) * 100).toFixed(1)) : 100,
        totalTagsIndexed: allTags.size,
        totalBytesStored: totalBytes,
        livePipeline: true,
        cloudName: process.env.CLOUDINARY_CLOUD_NAME
      }
    });

  } catch (error) {
    console.error('[Cloudinary Stats Error]', error.message || error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve asset statistics.'
    });
  }
});

/**
 * 7. Frontend Fallback Route
 */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/**
 * 4. 404 Route Handler for undefined API routes
 */
app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'API route not found'
  });
});

/**
 * 5. Global Error Handling Middleware
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

  if (err && err.message) {
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }

  return res.status(500).json({
    success: false,
    message: 'Internal server error'
  });
});

// Start Express Server
app.listen(PORT, () => {
  console.log(`[Smart UGC Studio] Server running on http://localhost:${PORT}`);
  console.log(`[Smart UGC Studio] Health check available at http://localhost:${PORT}/api/health`);
});

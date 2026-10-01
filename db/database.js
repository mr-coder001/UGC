/**
 * Database Layer - Smart UGC Moderation & Asset Studio
 * 
 * Supports:
 * 1. PostgreSQL (Production / Vercel Postgres / Neon / Supabase / Railway) via `DATABASE_URL`
 * 2. SQLite (Local development zero-config fallback)
 * 
 * Stores:
 * - `users`: OAuth user profiles, Google ID, email, avatar, timestamps
 * - `assets`: User-owned media metadata, Cloudinary public IDs, AI tags, moderation data
 * - `session`: Persistent session store for express-session
 */

const path = require('path');
const crypto = require('crypto');

let dbClient = null;
let dbType = 'sqlite'; // 'postgres' | 'sqlite'
let pgPool = null;
let sqliteDb = null;
let initPromise = null;

/**
 * Get or create PostgreSQL pool
 */
function getPgPool() {
  if (!pgPool) {
    const databaseUrl = process.env.DATABASE_URL;
    if (databaseUrl && (databaseUrl.startsWith('postgres://') || databaseUrl.startsWith('postgresql://'))) {
      try {
        const { Pool } = require('pg');
        pgPool = new Pool({
          connectionString: databaseUrl,
          ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : (databaseUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : false),
          max: 10,
          idleTimeoutMillis: 30000
        });
        dbType = 'postgres';
      } catch (err) {
        console.warn('[Database] Could not create PostgreSQL pool:', err.message);
      }
    }
  }
  return pgPool;
}

/**
 * Memoized, idempotent database initializer (Serverless-safe)
 */
function ensureInitialized() {
  if (!initPromise) {
    initPromise = initDatabase().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

/**
 * Initialize Database connection and auto-migrate tables
 */
async function initDatabase() {
  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl && (databaseUrl.startsWith('postgres://') || databaseUrl.startsWith('postgresql://'))) {
    // Production PostgreSQL
    try {
      const pool = getPgPool();
      if (pool) {
        const client = await pool.connect();
        client.release();
        dbType = 'postgres';
        console.log('[Database] Connected to PostgreSQL successfully.');
        await migratePostgres();
        return;
      }
    } catch (err) {
      console.warn('[Database] PostgreSQL connection failed, falling back to local SQLite:', err.message);
    }
  }

  // Local SQLite fallback
  dbType = 'sqlite';
  const sqlite3 = require('sqlite3').verbose();
  const dbPath = path.join(__dirname, '..', 'ugc_studio.sqlite');
  
  await new Promise((resolve, reject) => {
    sqliteDb = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('[Database] Failed to initialize SQLite database:', err.message);
        reject(err);
      } else {
        console.log(`[Database] Connected to local SQLite database at ${dbPath}`);
        resolve();
      }
    });
  });

  await migrateSqlite();
}

/**
 * PostgreSQL Schema Migration
 */
async function migratePostgres() {
  const schemaSql = `
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(64) PRIMARY KEY,
      google_id VARCHAR(128) UNIQUE NOT NULL,
      email VARCHAR(255) NOT NULL,
      name VARCHAR(255),
      profile_image TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      last_login TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

    CREATE TABLE IF NOT EXISTS assets (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      cloudinary_public_id VARCHAR(255) NOT NULL,
      original_name VARCHAR(255),
      asset_type VARCHAR(64) DEFAULT 'image',
      format VARCHAR(32),
      bytes BIGINT DEFAULT 0,
      width INTEGER DEFAULT 0,
      height INTEGER DEFAULT 0,
      moderation_status VARCHAR(64) DEFAULT 'approved',
      moderation_data TEXT,
      tags TEXT,
      detected_objects TEXT,
      background_removed_public_id VARCHAR(255),
      background_prompt TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_assets_user_id ON assets(user_id);
    CREATE INDEX IF NOT EXISTS idx_assets_public_id ON assets(cloudinary_public_id);
    CREATE INDEX IF NOT EXISTS idx_assets_created_at ON assets(created_at DESC);

    CREATE TABLE IF NOT EXISTS "session" (
      "sid" varchar NOT NULL COLLATE "default",
      "sess" json NOT NULL,
      "expire" timestamp(6) NOT NULL,
      CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
    ) WITH (OIDS=FALSE);

    CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
  `;

  await pgPool.query(schemaSql);
  console.log('[Database] PostgreSQL schema verified.');
}

/**
 * SQLite Schema Migration
 */
async function migrateSqlite() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      google_id TEXT UNIQUE NOT NULL,
      email TEXT NOT NULL,
      name TEXT,
      profile_image TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      last_login TEXT DEFAULT (datetime('now'))
    );`,
    `CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);`,
    `CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);`,
    `CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      cloudinary_public_id TEXT NOT NULL,
      original_name TEXT,
      asset_type TEXT DEFAULT 'image',
      format TEXT,
      bytes INTEGER DEFAULT 0,
      width INTEGER DEFAULT 0,
      height INTEGER DEFAULT 0,
      moderation_status TEXT DEFAULT 'approved',
      moderation_data TEXT,
      tags TEXT,
      detected_objects TEXT,
      background_removed_public_id TEXT,
      background_prompt TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );`,
    `CREATE INDEX IF NOT EXISTS idx_assets_user_id ON assets(user_id);`,
    `CREATE INDEX IF NOT EXISTS idx_assets_public_id ON assets(cloudinary_public_id);`,
    `CREATE INDEX IF NOT EXISTS idx_assets_created_at ON assets(created_at DESC);`
  ];

  for (const sql of statements) {
    await new Promise((resolve, reject) => {
      sqliteDb.run(sql, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
  console.log('[Database] SQLite schema verified.');
}

/**
 * Generic Query Helper
 */
async function query(sql, params = []) {
  if (dbType === 'postgres') {
    const res = await pgPool.query(sql, params);
    return res.rows;
  } else {
    // Translate $1, $2 to ? for SQLite
    let sqliteSql = sql;
    let index = 1;
    while (sqliteSql.includes(`$${index}`)) {
      sqliteSql = sqliteSql.replace(`$${index}`, '?');
      index++;
    }

    const trimmed = sqliteSql.trim().toUpperCase();
    if (trimmed.startsWith('SELECT') || trimmed.startsWith('WITH')) {
      return new Promise((resolve, reject) => {
        sqliteDb.all(sqliteSql, params, (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        });
      });
    } else {
      return new Promise((resolve, reject) => {
        sqliteDb.run(sqliteSql, params, function(err) {
          if (err) reject(err);
          else resolve({ changes: this.changes, lastID: this.lastID });
        });
      });
    }
  }
}

// ============================================================================
// User Operations
// ============================================================================

async function findUserByGoogleId(googleId) {
  if (!googleId) return null;
  const rows = await query('SELECT * FROM users WHERE google_id = $1 LIMIT 1', [googleId]);
  return rows[0] || null;
}

async function findUserById(id) {
  if (!id) return null;
  const rows = await query('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]);
  return rows[0] || null;
}

async function createUser({ googleId, email, name, profileImage }) {
  const id = 'usr_' + crypto.randomBytes(12).toString('hex');
  const now = new Date().toISOString();

  if (dbType === 'postgres') {
    const sql = `
      INSERT INTO users (id, google_id, email, name, profile_image, created_at, last_login)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;
    const rows = await query(sql, [id, googleId, email, name || '', profileImage || '', now, now]);
    return rows[0];
  } else {
    const sql = `
      INSERT INTO users (id, google_id, email, name, profile_image, created_at, last_login)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `;
    await query(sql, [id, googleId, email, name || '', profileImage || '', now, now]);
    return findUserById(id);
  }
}

async function updateUserLastLogin(id, { name, profileImage } = {}) {
  const now = new Date().toISOString();
  if (name || profileImage) {
    await query(
      'UPDATE users SET last_login = $1, name = COALESCE($2, name), profile_image = COALESCE($3, profile_image) WHERE id = $4',
      [now, name || null, profileImage || null, id]
    );
  } else {
    await query('UPDATE users SET last_login = $1 WHERE id = $2', [now, id]);
  }
  return findUserById(id);
}

// ============================================================================
// Asset Operations (Ownership Enforced)
// ============================================================================

async function createAsset({
  userId,
  cloudinaryPublicId,
  originalName,
  assetType = 'image',
  format,
  bytes = 0,
  width = 0,
  height = 0,
  moderationStatus = 'approved',
  moderationData = null,
  tags = [],
  detectedObjects = [],
  backgroundPrompt = null
}) {
  const id = 'ast_' + crypto.randomBytes(12).toString('hex');
  const now = new Date().toISOString();
  const modDataJson = typeof moderationData === 'object' ? JSON.stringify(moderationData) : (moderationData || '{}');
  const tagsJson = Array.isArray(tags) ? JSON.stringify(tags) : (tags || '[]');
  const objJson = Array.isArray(detectedObjects) ? JSON.stringify(detectedObjects) : (detectedObjects || '[]');

  const sql = `
    INSERT INTO assets (
      id, user_id, cloudinary_public_id, original_name, asset_type,
      format, bytes, width, height, moderation_status, moderation_data,
      tags, detected_objects, background_prompt, created_at, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
  `;

  await query(sql, [
    id, userId, cloudinaryPublicId, originalName || 'ugc_asset', assetType,
    format || 'jpg', bytes, width, height, moderationStatus, modDataJson,
    tagsJson, objJson, backgroundPrompt || '', now, now
  ]);

  return getAssetByIdAndUserId(id, userId);
}

function parseAssetRow(row) {
  if (!row) return null;
  let parsedMod = {};
  let parsedTags = [];
  let parsedObjs = [];

  try {
    parsedMod = typeof row.moderation_data === 'string' ? JSON.parse(row.moderation_data) : (row.moderation_data || {});
  } catch (e) {
    parsedMod = {};
  }

  try {
    parsedTags = typeof row.tags === 'string' ? JSON.parse(row.tags) : (row.tags || []);
  } catch (e) {
    parsedTags = [];
  }

  try {
    parsedObjs = typeof row.detected_objects === 'string' ? JSON.parse(row.detected_objects) : (row.detected_objects || []);
  } catch (e) {
    parsedObjs = [];
  }

  return {
    id: row.id,
    userId: row.user_id,
    publicId: row.cloudinary_public_id,
    originalName: row.original_name,
    assetType: row.asset_type,
    format: row.format,
    bytes: parseInt(row.bytes, 10) || 0,
    width: parseInt(row.width, 10) || 0,
    height: parseInt(row.height, 10) || 0,
    moderationStatus: row.moderation_status || 'approved',
    moderation: parsedMod,
    tags: parsedTags,
    detectedObjects: parsedObjs,
    backgroundPrompt: row.background_prompt || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function getAssetsByUserId(userId, { search, tag, moderation, sort = 'newest', limit = 60, offset = 0 } = {}) {
  if (!userId) return [];

  let sql = 'SELECT * FROM assets WHERE user_id = $1';
  const params = [userId];

  if (search && search.trim()) {
    params.push(`%${search.trim()}%`);
    const searchIdx = params.length;
    sql += ` AND (original_name LIKE $${searchIdx} OR cloudinary_public_id LIKE $${searchIdx} OR tags LIKE $${searchIdx})`;
  }

  if (tag && tag.trim()) {
    params.push(`%${tag.trim()}%`);
    const tagIdx = params.length;
    sql += ` AND tags LIKE $${tagIdx}`;
  }

  if (moderation && moderation !== 'all') {
    if (moderation === 'safe' || moderation === 'approved') {
      sql += ` AND (moderation_status = 'approved' OR moderation_status = 'safe')`;
    } else if (moderation === 'flagged' || moderation === 'rejected' || moderation === 'pending') {
      sql += ` AND (moderation_status = 'flagged' OR moderation_status = 'rejected' OR moderation_status = 'pending')`;
    }
  }

  let orderBy = 'created_at DESC';
  if (sort === 'oldest') {
    orderBy = 'created_at ASC';
  } else if (sort === 'largest') {
    orderBy = 'bytes DESC';
  } else if (sort === 'smallest') {
    orderBy = 'bytes ASC';
  }

  sql += ` ORDER BY ${orderBy} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(Math.min(Math.max(parseInt(limit, 10) || 60, 1), 100));
  params.push(Math.max(parseInt(offset, 10) || 0, 0));

  const rows = await query(sql, params);
  return rows.map(parseAssetRow);
}

async function getAssetByIdAndUserId(assetId, userId) {
  if (!assetId || !userId) return null;
  const rows = await query('SELECT * FROM assets WHERE id = $1 AND user_id = $2 LIMIT 1', [assetId, userId]);
  return parseAssetRow(rows[0]);
}

async function getAssetByPublicIdAndUserId(publicId, userId) {
  if (!publicId || !userId) return null;
  const rows = await query('SELECT * FROM assets WHERE cloudinary_public_id = $1 AND user_id = $2 LIMIT 1', [publicId, userId]);
  return parseAssetRow(rows[0]);
}

async function updateAssetPrompt(assetId, userId, prompt) {
  if (!assetId || !userId) return null;
  const now = new Date().toISOString();
  await query('UPDATE assets SET background_prompt = $1, updated_at = $2 WHERE id = $3 AND user_id = $4', [prompt, now, assetId, userId]);
  return getAssetByIdAndUserId(assetId, userId);
}

async function deleteAssetByIdAndUserId(assetId, userId) {
  if (!assetId || !userId) return false;
  // First retrieve to confirm existence
  const existing = await getAssetByIdAndUserId(assetId, userId);
  if (!existing) return null;

  await query('DELETE FROM assets WHERE id = $1 AND user_id = $2', [assetId, userId]);
  return existing;
}

async function getUserStats(userId) {
  if (!userId) return null;

  const assets = await query('SELECT bytes, moderation_status, tags FROM assets WHERE user_id = $1', [userId]);
  const totalAssets = assets.length;
  let totalBytes = 0;
  let safeCount = 0;
  let flaggedCount = 0;
  const uniqueTags = new Set();

  assets.forEach(a => {
    totalBytes += parseInt(a.bytes, 10) || 0;
    const status = (a.moderation_status || 'approved').toLowerCase();
    if (status === 'approved' || status === 'safe') {
      safeCount++;
    } else {
      flaggedCount++;
    }

    try {
      const parsed = typeof a.tags === 'string' ? JSON.parse(a.tags) : (a.tags || []);
      if (Array.isArray(parsed)) {
        parsed.forEach(t => uniqueTags.add(String(t).toLowerCase()));
      }
    } catch (e) {}
  });

  const safePercentage = totalAssets > 0 ? parseFloat(((safeCount / totalAssets) * 100).toFixed(1)) : 100;

  return {
    totalAssets,
    safeAssets: safeCount,
    flaggedAssets: flaggedCount,
    safePercentage,
    totalTagsIndexed: uniqueTags.size,
    totalBytesStored: totalBytes,
    livePipeline: true
  };
}

/**
 * Session Store Factory
 */
function getSessionStore(session) {
  const pool = getPgPool();
  if (pool) {
    const pgSession = require('connect-pg-simple')(session);
    return new pgSession({
      pool: pool,
      tableName: 'session',
      createTableIfMissing: true
    });
  }
  // Memory store fallback for local development
  return new session.MemoryStore();
}

module.exports = {
  initDatabase,
  ensureInitialized,
  query,
  getDbType: () => dbType,
  findUserByGoogleId,
  findUserById,
  createUser,
  updateUserLastLogin,
  createAsset,
  getAssetsByUserId,
  getAssetByIdAndUserId,
  getAssetByPublicIdAndUserId,
  updateAssetPrompt,
  deleteAssetByIdAndUserId,
  getUserStats,
  getSessionStore
};


# Smart UGC Moderation & Asset Studio

> **Transform raw UGC into production-ready media with automated AI moderation, neural background removal, generative backgrounds, smart subject-aware crops, dynamic delivery optimization, and secure Google Authentication with persistent ownership isolation.**  
> *Cloudinary AI Hackathon 2026 — Track 1: AI Media Pipelines*

---

## 🌟 Overview

Smart UGC Studio is an enterprise-grade automated media platform designed to ingest, screen, enrich, and transform User-Generated Content (UGC) into production-ready assets. 

With the security and authentication architecture:
* **Google** handles identity authentication (OAuth 2.0 / OpenID Connect).
* **The Application** handles authorization and ownership verification on every request.
* **The Persistent Database** (PostgreSQL / local SQLite fallback) stores user records, asset ownership mappings, and session state.
* **Cloudinary** stores media buffers, executes multi-model AI content moderation, neural background cutouts, generative scene synthesis, smart cropping (`g_auto`), and delivery optimization (`f_auto, q_auto`).
* **Signed Private Delivery** (`sign_url: true`) protects media assets from unauthorized parameter tampering and direct URL manipulation.
* **Strict IDOR Protection & Secure Deletion** ensure users can only view, transform, and delete their own assets.

---

## 🔒 Security & Architecture Model

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             CLIENT (BROWSER)                                │
│   • Dark Futuristic Glassmorphism UI (No Secrets Exposed)                   │
│   • HttpOnly Session Cookie (ugc_studio_sid)                                │
│   • Dynamic "Continue with Google" / Profile Management                     │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ HTTPS / Encrypted Session
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        EXPRESS BACKEND (SERVER-SIDE)                        │
│   • Rate Limiting (express-rate-limit on Auth, Upload, API, Deletion)       │
│   • Passport.js Google OAuth 2.0 Strategy                                   │
│   • Server-Side Authorization Middleware (requireAuth)                      │
│   • In-Memory Multer Processing (No disk storage of UGC)                    │
│   • Server-Side Signed URL Synthesis (sign_url: true)                       │
│   • IDOR Ownership Validation (asset.user_id === session.user.id)           │
└──────────────────┬──────────────────────────────────────┬───────────────────┘
                   │                                      │
                   ▼                                      ▼
┌─────────────────────────────────────┐  ┌────────────────────────────────────┐
│         PERSISTENT DATABASE         │  │         CLOUDINARY MEDIA CLOUD     │
│   (PostgreSQL / Local SQLite)       │  │   • Multi-Model AI Moderation      │
│   • users table (Google ID, profile)│  │   • AI Auto-Tagging & Vision       │
│   • assets table (ownership map)    │  │   • Neural Background Removal      │
│   • session table (persistent state)│  │   • Generative Background Replace  │
│   • Metadata only (NO media files)  │  │   • Smart Subject Crop (g_auto)    │
│                                     │  │   • Dynamic CDN Delivery           │
└─────────────────────────────────────┘  └────────────────────────────────────┘
```

---

## 🛡️ User Asset Ownership & IDOR Protection

1. **Authentication:** When a user signs in via Google OAuth 2.0, the backend retrieves the verified Google ID, email, display name, and avatar, creating or updating a record in the `users` table with a server-assigned UUID (`usr_...`).
2. **Session Security:** An authenticated session is established using `express-session` with a persistent session store, signed with `SESSION_SECRET`, and managed via an `HttpOnly`, `SameSite=Lax` (and `Secure` in production) cookie.
3. **Strict Authorization:** Every protected asset operation (`POST /api/upload`, `POST /api/generate-background`, `POST /api/smart-crop`, `GET /api/assets`, `GET /api/assets/:id`, `DELETE /api/assets/:id`, `GET /api/asset-stats`) identifies the user solely from the validated server-side session (`req.user.id`).
4. **IDOR Prevention:** Client-provided parameters (`user_id`, `email`, or arbitrary `public_id`) are never trusted. All database queries strictly scope records by `WHERE id = $1 AND user_id = $2`.
5. **Private Media Delivery:** Cloudinary URLs are signed server-side using the Cloudinary API secret (`sign_url: true`), ensuring only validly generated, server-authorized URLs can access media.
6. **Secure Deletion:** When an asset is deleted, the backend confirms the asset belongs to `req.user.id`, calls the Cloudinary API to permanently delete the cloud asset and derivatives (`cloudinary.uploader.destroy`), and deletes the record from the database.

---

## 🔑 Google Cloud Console OAuth 2.0 Setup

To enable Google Authentication:

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project or select an existing project (e.g., `Smart UGC Studio`).
3. Navigate to **APIs & Services** → **OAuth consent screen**:
   * Select **External** (or Internal for Google Workspace).
   * Fill in **App name**, **User support email**, and **Developer contact information**.
   * Add scopes: `.../auth/userinfo.email` and `.../auth/userinfo.profile`.
   * Save and continue.
4. Navigate to **APIs & Services** → **Credentials**:
   * Click **+ CREATE CREDENTIALS** → **OAuth client ID**.
   * **Application type:** `Web application`.
   * **Name:** `Smart UGC Studio Client`.
   * **Authorized JavaScript origins:**
     * Local development: `http://localhost:3000`
     * Production: `<your-production-domain>` (e.g., `https://your-app.vercel.app`)
   * **Authorized redirect URIs:**
     * Local development: `http://localhost:3000/auth/google/callback`
     * Production: `https://<your-production-domain>/auth/google/callback`
5. Click **Create** and copy your **Client ID** and **Client Secret**.
6. Paste them into your `.env` file.

---

## 🗄️ Database Setup

Smart UGC Studio supports two database modes:

### 1. Production (PostgreSQL / Neon / Supabase / Vercel Postgres / Railway)
Provide your PostgreSQL connection string in `.env`:
```env
DATABASE_URL=postgres://user:password@host:5432/dbname?sslmode=require
```
The application will automatically connect and create the `users`, `assets`, and `session` tables on boot.

### 2. Local Development (SQLite Fallback)
If `DATABASE_URL` is omitted or empty, the application automatically falls back to an embedded SQLite database (`ugc_studio.sqlite`) with the exact same schema and relational integrity. No additional installation or database setup is required for local testing.

---

## ⚙️ Environment Variables

Create a `.env` file in the root directory following `.env.example`:

```env
# Server Port
PORT=3000

# Environment Mode ('development' | 'production')
NODE_ENV=development

# Google OAuth 2.0 Credentials
GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback

# Persistent Database Connection
# (PostgreSQL connection string for production, or leave empty for local SQLite fallback)
DATABASE_URL=

# Session Encryption Secret (Use a strong random string)
SESSION_SECRET=your_random_session_encryption_secret_key

# Cloudinary Credentials (Server-Side Only — Never exposed to frontend)
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# Allowed CORS Origin
FRONTEND_ORIGIN=http://localhost:3000
```

---

## 🚀 Local Development

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Test Suite
Verify security, auth isolation, IDOR prevention, and secret masking:
```bash
node test_security_auth.js
```

### 3. Start the Server
```bash
npm start
```
Open `http://localhost:3000` in your browser.

---

## ☁️ Vercel Deployment Configuration

When deploying to Vercel:

1. **Add Environment Variables in Vercel Dashboard:**
   * `NODE_ENV` = `production`
   * `GOOGLE_CLIENT_ID` = `<your_client_id>`
   * `GOOGLE_CLIENT_SECRET` = `<your_client_secret>`
   * `GOOGLE_CALLBACK_URL` = `https://<your-app-name>.vercel.app/auth/google/callback`
   * `DATABASE_URL` = `<your_neon_or_supabase_or_vercel_postgres_url>`
   * `SESSION_SECRET` = `<strong_random_secret>`
   * `CLOUDINARY_CLOUD_NAME` = `<your_cloud_name>`
   * `CLOUDINARY_API_KEY` = `<your_api_key>`
   * `CLOUDINARY_API_SECRET` = `<your_api_secret>`
   * `FRONTEND_ORIGIN` = `https://<your-app-name>.vercel.app`
2. **Add Vercel URL to Google Cloud Console:**
   * Add `https://<your-app-name>.vercel.app` to Authorized JavaScript Origins.
   * Add `https://<your-app-name>.vercel.app/auth/google/callback` to Authorized Redirect URIs.

---

## 📡 API Reference

| Method | Endpoint | Description | Access |
|---|---|---|---|
| `GET` | `/api/health` | Backend and Cloudinary health status | Public |
| `GET` | `/auth/google` | Initiates Google OAuth 2.0 flow | Public |
| `GET` | `/auth/google/callback` | OAuth redirect callback handler | Public |
| `GET` | `/auth/me` | Returns current authenticated user profile | Public / Session |
| `POST` | `/auth/logout` | Invalidates session and clears cookie | Authenticated |
| `POST` | `/api/upload` | Uploads image buffer, runs AI moderation & vision, stores ownership | Authenticated |
| `POST` | `/api/generate-background` | Generates AI background replacement on owned asset | Authenticated |
| `POST` | `/api/smart-crop` | Generates subject-aware crop URLs on owned asset | Authenticated |
| `GET` | `/api/assets` | Returns authenticated user's private assets | Authenticated |
| `GET` | `/api/assets/:id` | Returns single owned asset details | Authenticated |
| `DELETE` | `/api/assets/:id` | Deletes Cloudinary asset and DB ownership record | Authenticated |
| `GET` | `/api/asset-stats` | Computes user-specific moderation & storage metrics | Authenticated |

---

## ⚠️ Known Limitations & Security Disclaimers

* **Security Posture:** While this application implements strict server-side authentication, session security, IDOR protection, input sanitization, rate limiting, and signed URLs, no software system can claim 100% absolute security.
* **Temporary Processing:** Transformations requested on Cloudinary are generated dynamically via signed URLs; complex neural generative background transformations may take a few seconds on first request before caching on the CDN.
* **Rate Limits:** In-memory rate limiting is applied per IP address; in multi-instance serverless deployments, a centralized Redis store (e.g., Upstash) is recommended for distributed rate limiting.

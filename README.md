# Smart UGC Moderation & Asset Studio

> **Transform raw UGC into production-ready media.**  
> *Cloudinary AI Hackathon 2026 — Track 1: AI Media Pipelines*

---

## 🌟 Overview

Smart UGC Studio is an automated media platform designed to moderate, enrich, crop, and optimize user-generated content (UGC) for production applications using Cloudinary's dynamic AI media pipeline.

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Set your Cloudinary credentials in `.env`:
```env
PORT=3000
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

### 3. Run Server
```bash
npm start
```
or
```bash
node server.js
```

The application will be live at `http://localhost:3000`.

---

## 📡 API Endpoints

### 1. Health Check
* **Endpoint:** `GET /api/health`
* **Response:**
```json
{
  "success": true,
  "message": "Smart UGC Studio backend is running",
  "status": "healthy",
  "cloudinaryConfigured": true
}
```

### 2. Upload & Cloudinary Pipeline API
* **Endpoint:** `POST /api/upload`
* **Payload:** `multipart/form-data` with field name `image`
* **Allowed Types:** JPG, PNG, WEBP (Max 10 MB)
* **Response:**
```json
{
  "success": true,
  "message": "Image processed successfully",
  "asset": {
    "originalName": "photo.jpg",
    "publicId": "smart-ugc-studio/ugc_1727620000_photo",
    "originalUrl": "https://res.cloudinary.com/.../image/upload/v1/.../photo.jpg",
    "optimizedUrl": "https://res.cloudinary.com/.../image/upload/f_auto,q_auto/.../photo.jpg",
    "backgroundRemovedUrl": "https://res.cloudinary.com/.../image/upload/e_background_removal/photo.png",
    "smartCropUrl": "https://res.cloudinary.com/.../image/upload/c_fill,g_auto,h_600,w_600/photo.jpg",
    "format": "jpg",
    "width": 1200,
    "height": 800,
    "bytes": 123456
  }
}
```

---

## 📁 Project Structure
```text
smart-ugc-studio/
├── public/
│   ├── index.html        # Frontend Application UI (Tabs, Pipeline, Results)
│   ├── styles.css        # Glassmorphism Dark Theme Styles
│   └── app.js            # Studio Logic & Cloudinary URL Binding
├── server.js             # Express + Multer + Cloudinary Pipeline
├── .env                  # Local Environment Variables (Ignored)
├── .env.example          # Environment Template
├── .gitignore            # Git Ignore Rules
├── package.json          # Node Dependencies & Scripts
└── README.md             # Documentation
```

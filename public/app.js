/**
 * Smart UGC Moderation & Asset Studio - Application Logic
 * Cloudinary AI Hackathon 2026 — Track 1: AI Media Pipelines
 * Security & Google Authentication Upgrade
 */

// Application State (Single Source of Truth: Database & Authenticated Session)
const state = {
  currentView: 'dashboard',
  user: null, // { id, email, name, profileImage }
  isAuthenticated: false,
  selectedFile: null,
  selectedFileDataUrl: null,
  selectedFileMeta: {
    name: 'sample_fashion_portrait.jpg',
    size: '3.8 MB',
    dimensions: '2400 × 1600 px',
    rawBytes: 3984588,
    type: 'image/jpeg'
  },
  uploadedAsset: null,
  isProcessing: false,
  activeResultTab: 'original',
  smartCropSource: 'original',
  libraryFilter: 'all',
  librarySort: 'newest',
  librarySearch: '',
  assets: [],
  dashboardStats: null,
  isLoadingLibrary: false,
  isLoadingStats: false
};

// Preset Sample Images for Quick Testing
const samplePresets = [
  {
    name: 'sample_fashion_portrait.jpg',
    url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=1000&auto=format&fit=crop&q=80',
    size: '3.8 MB',
    dimensions: '2400 × 1600 px'
  },
  {
    name: 'sample_product_sneaker.jpg',
    url: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=1000&auto=format&fit=crop&q=80',
    size: '4.2 MB',
    dimensions: '2000 × 1333 px'
  },
  {
    name: 'sample_street_coffee.jpg',
    url: 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=1000&auto=format&fit=crop&q=80',
    size: '2.9 MB',
    dimensions: '1920 × 1280 px'
  }
];

// Helper: Format byte sizes into readable KB / MB
function formatFileSize(bytes) {
  if (!bytes || isNaN(bytes)) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

// Helper: Escape HTML strings
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Helper: Format date string
function formatDate(dateStr) {
  if (!dateStr) return 'Recent';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch (e) {
    return dateStr;
  }
}

// Initialize application on DOM ready
document.addEventListener('DOMContentLoaded', async () => {
  initNavigation();
  initUploadHandler();
  initResultsTabs();
  initAssetLibrary();
  initSettings();
  initLightboxListeners();
  initSamplePresets();
  handleUrlAuthMessages();

  // Set default sample preview
  setSampleImage(0);

  // Fetch authentication status first
  await checkAuthStatus();

  // If authenticated, load user-specific data
  if (state.isAuthenticated) {
    fetchDashboardStats();
    fetchRecentDashboardAssets();
    fetchAssetLibrary().then(() => {
      if (!state.uploadedAsset && state.assets && state.assets.length > 0) {
        state.uploadedAsset = state.assets[0];
        populateResultsView(state.uploadedAsset);
      }
    });
  }
});

// Toast Notification Engine
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  
  let iconSvg;
  if (type === 'success') {
    iconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
  } else if (type === 'error') {
    iconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f43f5e" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
  } else {
    iconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
  }

  toast.innerHTML = `${iconSvg} <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(50px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3800);
}

// Check OAuth callback parameters in URL
function handleUrlAuthMessages() {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('auth_success')) {
    showToast('✓ Successfully signed in with Google!', 'success');
    window.history.replaceState({}, document.title, window.location.pathname);
  } else if (urlParams.get('auth_error')) {
    const err = urlParams.get('auth_error');
    if (err === 'not_configured') {
      showToast('Google OAuth is not configured in backend .env', 'error');
    } else {
      showToast('Google sign-in was cancelled or failed.', 'error');
    }
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}

// ==========================================================================
// 0. AUTHENTICATION CONTROLLER (Google OAuth 2.0 & Session State)
// ==========================================================================
async function checkAuthStatus() {
  try {
    const res = await fetch('/auth/me');
    const data = await res.json().catch(() => null);

    if (data && data.success && data.authenticated && data.user) {
      state.user = data.user;
      state.isAuthenticated = true;
    } else {
      state.user = null;
      state.isAuthenticated = false;
    }
  } catch (err) {
    console.warn('[Auth Check Error]:', err.message);
    state.user = null;
    state.isAuthenticated = false;
  }

  renderAuthUI();
}

function renderAuthUI() {
  const topbarAuth = document.getElementById('topbar-auth-container');
  const uploadGate = document.getElementById('upload-auth-gate');
  const uploadWrapper = document.getElementById('upload-main-wrapper');
  const libraryGate = document.getElementById('library-auth-gate');
  const libraryControls = document.getElementById('library-controls-bar');
  const settingsBadge = document.getElementById('settings-auth-status-badge');
  const settingsAccountDetails = document.getElementById('settings-account-details');

  if (state.isAuthenticated && state.user) {
    // 1. Topbar: Show logged-in user profile with logout button
    if (topbarAuth) {
      const avatarHtml = state.user.profileImage
        ? `<img src="${escapeHtml(state.user.profileImage)}" class="user-avatar-img" alt="${escapeHtml(state.user.name)}" onerror="this.onerror=null; this.outerHTML='<div class=\\'user-avatar-fallback\\'>${escapeHtml((state.user.name || 'U')[0].toUpperCase())}</div>'"/>`
        : `<div class="user-avatar-fallback">${escapeHtml((state.user.name || 'U')[0].toUpperCase())}</div>`;

      topbarAuth.innerHTML = `
        <div class="topbar-auth-group">
          <div class="user-profile-badge" onclick="navigateTo('settings')" title="Signed in as ${escapeHtml(state.user.email)}">
            ${avatarHtml}
            <div class="user-info-text">
              <span class="user-display-name">${escapeHtml(state.user.name || 'User')}</span>
              <span class="user-display-email">${escapeHtml(state.user.email)}</span>
            </div>
          </div>
          <button type="button" class="btn-logout" id="btn-logout-topbar" onclick="handleLogout()" title="Sign out of account">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
            Sign Out
          </button>
        </div>
      `;
    }

    // 2. Upload: show upload interface, hide gate
    if (uploadGate) uploadGate.style.display = 'none';
    if (uploadWrapper) {
      uploadWrapper.classList.remove('dropzone-disabled');
      uploadWrapper.style.opacity = '1';
      uploadWrapper.style.pointerEvents = 'auto';
    }

    // 3. Library: show library controls, hide gate
    if (libraryGate) libraryGate.style.display = 'none';
    if (libraryControls) libraryControls.style.display = 'flex';

    // 4. Settings: Show active account details
    if (settingsBadge) {
      settingsBadge.className = 'pill-badge cyan';
      settingsBadge.textContent = 'Authenticated (Google)';
    }

    if (settingsAccountDetails) {
      settingsAccountDetails.innerHTML = `
        <div style="display: flex; align-items: center; gap: 16px; padding: 14px; background: rgba(15,23,42,0.6); border: 1px solid var(--border-subtle); border-radius: var(--radius-md);">
          ${state.user.profileImage
            ? `<img src="${escapeHtml(state.user.profileImage)}" style="width: 48px; height: 48px; border-radius: 50%; border: 2px solid var(--purple-primary);" alt="${escapeHtml(state.user.name)}"/>`
            : `<div class="user-avatar-fallback" style="width: 48px; height: 48px; font-size: 18px;">${escapeHtml((state.user.name || 'U')[0].toUpperCase())}</div>`
          }
          <div style="flex: 1;">
            <div style="font-size: 15px; font-weight: 700; color: #fff;">${escapeHtml(state.user.name || 'Google User')}</div>
            <div style="font-size: 12.5px; color: var(--cyan-light); font-family: var(--font-mono); margin-top: 2px;">${escapeHtml(state.user.email)}</div>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">User ID: ${escapeHtml(state.user.id)}</div>
          </div>
          <button type="button" class="btn-logout" onclick="handleLogout()" style="padding: 8px 14px;">
            Sign Out
          </button>
        </div>
      `;
    }

  } else {
    // 1. Topbar: Show Continue with Google button
    if (topbarAuth) {
      topbarAuth.innerHTML = `
        <a href="/auth/google" class="btn-google-login" id="topbar-login-btn">
          <svg class="google-icon-svg" viewBox="0 0 24 24">
            <path fill="#EA4335" d="M12 5c1.6 0 3 .6 4.1 1.7l3.1-3.1C17.3 1.8 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.4 9 5 12 5z"/>
            <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.7-.2-2.3H12v4.6h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.9z"/>
            <path fill="#FBBC05" d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3 0-.8.2-1.6.4-2.3L1.9 7.3C.7 9.7 0 12.3 0 15.2c0 2.8.7 5.4 1.9 7.8l3.7-2.9z"/>
            <path fill="#34A853" d="M12 23.5c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.4-6.4-5.2L1.9 16.5C3.7 20.4 7.5 23.5 12 23.5z"/>
          </svg>
          <span>Continue with Google</span>
        </a>
      `;
    }

    // 2. Upload: show gate, disable upload actions
    if (uploadGate) uploadGate.style.display = 'flex';
    if (uploadWrapper) {
      uploadWrapper.classList.add('dropzone-disabled');
      uploadWrapper.style.opacity = '0.5';
      uploadWrapper.style.pointerEvents = 'none';
    }

    // 3. Library: show gate, hide controls
    if (libraryGate) libraryGate.style.display = 'flex';
    if (libraryControls) libraryControls.style.display = 'none';

    // 4. Settings: Show unauthenticated prompt
    if (settingsBadge) {
      settingsBadge.className = 'pill-badge purple';
      settingsBadge.textContent = 'Not Signed In';
    }

    if (settingsAccountDetails) {
      settingsAccountDetails.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 14px; background: rgba(15,23,42,0.6); border: 1px solid var(--border-subtle); border-radius: var(--radius-md);">
          <div>
            <div style="font-size: 14px; font-weight: 600; color: #fff;">No Active User Session</div>
            <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">Sign in with Google to enable private media upload and ownership.</div>
          </div>
          <a href="/auth/google" class="btn-google-login">
            <svg class="google-icon-svg" viewBox="0 0 24 24">
              <path fill="#EA4335" d="M12 5c1.6 0 3 .6 4.1 1.7l3.1-3.1C17.3 1.8 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.4 9 5 12 5z"/>
              <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.7-.2-2.3H12v4.6h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.9z"/>
              <path fill="#FBBC05" d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3 0-.8.2-1.6.4-2.3L1.9 7.3C.7 9.7 0 12.3 0 15.2c0 2.8.7 5.4 1.9 7.8l3.7-2.9z"/>
              <path fill="#34A853" d="M12 23.5c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.4-6.4-5.2L1.9 16.5C3.7 20.4 7.5 23.5 12 23.5z"/>
            </svg>
            <span>Sign in with Google</span>
          </a>
        </div>
      `;
    }
  }
}

window.handleLogout = async function() {
  try {
    const res = await fetch('/auth/logout', { method: 'POST' });
    const data = await res.json().catch(() => null);

    state.user = null;
    state.isAuthenticated = false;
    state.assets = [];
    state.uploadedAsset = null;
    state.dashboardStats = null;

    renderAuthUI();
    renderAssetLibraryGrid();
    showToast('✓ Logged out successfully.', 'info');
    navigateTo('dashboard');
  } catch (err) {
    console.error('[Logout Error]:', err);
    showToast('Error during logout.', 'error');
  }
};

// ==========================================================================
// 1. NAVIGATION & ROUTING
// ==========================================================================
function initNavigation() {
  const navItems = document.querySelectorAll('[data-nav-target]');
  const mobileToggle = document.getElementById('mobile-menu-toggle');
  const sidebar = document.querySelector('.sidebar');

  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const targetView = item.getAttribute('data-nav-target');
      navigateTo(targetView);

      if (sidebar && sidebar.classList.contains('mobile-open')) {
        sidebar.classList.remove('mobile-open');
      }
    });
  });

  if (mobileToggle && sidebar) {
    mobileToggle.addEventListener('click', () => {
      sidebar.classList.toggle('mobile-open');
    });
  }

  // Action buttons throughout the UI
  document.querySelectorAll('[data-action="goto-upload"]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!state.isAuthenticated) {
        showToast('Please sign in with Google to upload and process images.', 'info');
      }
      navigateTo('upload');
    });
  });

  document.querySelectorAll('[data-action="goto-library"]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!state.isAuthenticated) {
        showToast('Please sign in with Google to view your private asset library.', 'info');
      }
      navigateTo('assets');
      if (state.isAuthenticated) fetchAssetLibrary();
    });
  });

  document.querySelectorAll('[data-action="goto-studio"]').forEach(btn => {
    btn.addEventListener('click', () => navigateTo('results'));
  });
}

function navigateTo(viewName) {
  state.currentView = viewName;

  document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
    if (item.getAttribute('data-nav-target') === viewName) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  document.querySelectorAll('.view-section').forEach(view => {
    view.classList.remove('active-view');
  });

  const activeView = document.getElementById(`view-${viewName}`);
  if (activeView) {
    activeView.classList.add('active-view');
  }

  const titles = {
    dashboard: 'Dashboard',
    upload: 'Upload & Process UGC',
    processing: 'AI Pipeline Execution',
    results: 'Asset Studio',
    assets: 'Asset Library',
    settings: 'Settings'
  };

  const topbarTitle = document.getElementById('topbar-title');
  if (topbarTitle && titles[viewName]) {
    topbarTitle.textContent = titles[viewName];
  }

  if (viewName === 'results') {
    if (!state.uploadedAsset && state.assets && state.assets.length > 0) {
      state.uploadedAsset = state.assets[0];
    }
    populateResultsView(state.uploadedAsset);
  }

  if (viewName === 'assets') {
    if (state.isAuthenticated) {
      if (state.assets.length === 0 && !state.isLoadingLibrary) {
        fetchAssetLibrary();
      }
    } else {
      renderAuthUI();
    }
  }

  if (viewName === 'dashboard' && state.isAuthenticated) {
    fetchDashboardStats();
    fetchRecentDashboardAssets();
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ==========================================================================
// 2. UPLOAD & FILE INPUT HANDLING
// ==========================================================================
function initUploadHandler() {
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('imageInput') || document.getElementById('file-input');
  const browseBtn = document.getElementById('browse-files-btn');
  const removeBtn = document.getElementById('remove-file-btn');
  const startProcessBtn = document.getElementById('start-process-btn');

  if (!dropzone || !fileInput) return;

  if (browseBtn) {
    browseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!state.isAuthenticated) {
        showToast('Please sign in with Google to upload and process images.', 'info');
        return;
      }
      fileInput.click();
    });
  }

  dropzone.addEventListener('click', () => {
    if (!state.isAuthenticated) {
      showToast('Please sign in with Google to upload and process images.', 'info');
      return;
    }
    fileInput.click();
  });

  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('drag-over');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('drag-over');
    }, false);
  });

  dropzone.addEventListener('drop', (e) => {
    if (!state.isAuthenticated) {
      showToast('Please sign in with Google to upload and process images.', 'info');
      return;
    }
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files && files.length > 0) {
      handleFileSelection(files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (fileInput.files && fileInput.files.length > 0) {
      handleFileSelection(fileInput.files[0]);
    }
  });

  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      resetUploadSelection();
    });
  }

  if (startProcessBtn) {
    startProcessBtn.addEventListener('click', () => {
      if (!state.isAuthenticated) {
        showToast('Please sign in with Google to upload and process images.', 'error');
        return;
      }
      startProcessingPipeline();
    });
  }
}

function handleFileSelection(file) {
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    showToast('Please select a valid image file (JPG, PNG, or WEBP).', 'error');
    return;
  }

  if (file.size > 10 * 1024 * 1024) {
    showToast('File size exceeds the 10 MB limit.', 'error');
    return;
  }

  state.selectedFile = file;
  const sizeFormatted = formatFileSize(file.size);
  
  try {
    const localUrl = URL.createObjectURL(file);
    state.selectedFileDataUrl = localUrl;
  } catch (e) {
    const reader = new FileReader();
    reader.onload = (e) => { state.selectedFileDataUrl = e.target.result; };
    reader.readAsDataURL(file);
  }

  const img = new Image();
  img.onload = () => {
    state.selectedFileMeta = {
      name: file.name,
      size: sizeFormatted,
      dimensions: `${img.naturalWidth} × ${img.naturalHeight} px`,
      rawBytes: file.size,
      type: file.type
    };
    updateUploadPreviewUI();
    showToast(`Loaded "${file.name}" ready for Cloudinary pipeline!`);
  };
  img.src = state.selectedFileDataUrl;
}

function initSamplePresets() {
  const container = document.getElementById('preset-samples-grid');
  if (!container) return;

  container.innerHTML = samplePresets.map((preset, index) => `
    <button type="button" class="preset-thumb-btn" onclick="setSampleImage(${index})" title="Use ${preset.name}">
      <img src="${preset.url}" alt="${preset.name}" loading="lazy" />
      <span class="preset-tag">Preset ${index + 1}</span>
    </button>
  `).join('');
}

window.setSampleImage = async function(index) {
  const preset = samplePresets[index];
  if (!preset) return;

  state.selectedFileDataUrl = preset.url;
  state.selectedFileMeta = {
    name: preset.name,
    size: preset.size,
    dimensions: preset.dimensions,
    rawBytes: 3984588,
    type: 'image/jpeg'
  };

  try {
    const res = await fetch(preset.url);
    const blob = await res.blob();
    state.selectedFile = new File([blob], preset.name, { type: blob.type || 'image/jpeg' });
  } catch (err) {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 800;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, 1200, 800);
    canvas.toBlob((blob) => {
      state.selectedFile = new File([blob], preset.name, { type: 'image/jpeg' });
    }, 'image/jpeg', 0.85);
  }

  updateUploadPreviewUI();
};

function updateUploadPreviewUI() {
  const previewImg = document.getElementById('upload-preview-img');
  const previewName = document.getElementById('preview-filename');
  const previewSize = document.getElementById('preview-filesize');
  const previewDims = document.getElementById('preview-dimensions');
  const previewFormat = document.getElementById('preview-format');
  const previewCard = document.getElementById('upload-preview-card');

  if (previewImg && state.selectedFileDataUrl) {
    previewImg.src = state.selectedFileDataUrl;
  }
  if (previewName) previewName.textContent = state.selectedFileMeta.name;
  if (previewSize) previewSize.textContent = state.selectedFileMeta.size;
  if (previewDims) previewDims.textContent = state.selectedFileMeta.dimensions;
  if (previewFormat) previewFormat.textContent = (state.selectedFileMeta.name.split('.').pop() || 'IMAGE').toUpperCase();
  if (previewCard) previewCard.style.display = 'flex';
}

function resetUploadSelection() {
  state.selectedFile = null;
  const fileInput = document.getElementById('imageInput') || document.getElementById('file-input');
  if (fileInput) fileInput.value = '';
  setSampleImage(0);
  showToast('Reset selection to default sample UGC image.', 'info');
}

function resetProcessButton() {
  const startBtn = document.getElementById('start-process-btn');
  if (startBtn) {
    startBtn.disabled = false;
    startBtn.style.opacity = '1';
    startBtn.style.cursor = 'pointer';
    startBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
      ⚡ Process Image with AI
    `;
  }
}

// ==========================================================================
// 3. CLOUDINARY UPLOAD & PIPELINE EXECUTION
// ==========================================================================
const processingStages = [
  { id: 1, name: '01 Ingestion', detail: 'Streaming raw UGC bytes to Cloudinary media cloud...' },
  { id: 2, name: '02 AI Moderation', detail: 'Scanning content for safety policy compliance...' },
  { id: 3, name: '03 AI Vision', detail: 'Extracting semantic auto-tags and subject objects...' },
  { id: 4, name: '04 Background Removal', detail: 'Generating neural cutout (e_background_removal)...' },
  { id: 5, name: '05 Smart Crop', detail: 'Computing subject-aware framing with g_auto (1:1, 4:5, 16:9, 9:16)...' },
  { id: 6, name: '06 Smart Optimization', detail: 'Synthesizing dynamic signed delivery URLs (f_auto, q_auto)...' },
  { id: 7, name: '07 Asset Studio Ready', detail: 'Persisting asset to your authenticated library...' }
];

async function startProcessingPipeline() {
  if (state.isProcessing) return;

  if (!state.isAuthenticated) {
    showToast('Please sign in with Google to upload and process images.', 'error');
    return;
  }

  if (!state.selectedFile) {
    showToast('Please select an image first.', 'error');
    return;
  }

  const startBtn = document.getElementById('start-process-btn');
  if (startBtn) {
    startBtn.disabled = true;
    startBtn.style.opacity = '0.7';
    startBtn.style.cursor = 'not-allowed';
    startBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spinIcon 1.5s linear infinite;"><circle cx="12" cy="12" r="10"></circle><path d="M12 2a10 10 0 0 1 10 10"></path></svg>
      Uploading to Cloudinary...
    `;
  }

  state.isProcessing = true;
  navigateTo('processing');

  const progressBar = document.getElementById('progress-bar-fill');
  const progressPct = document.getElementById('progress-pct-label');
  const statusMsg = document.getElementById('processing-status-msg');

  if (progressBar) progressBar.style.width = '15%';
  if (progressPct) progressPct.textContent = '15%';
  if (statusMsg) statusMsg.textContent = 'Streaming image to Cloudinary...';
  renderStagesList(1);

  const formData = new FormData();
  formData.append('image', state.selectedFile);

  let backendAsset = null;

  try {
    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || !data || !data.success || !data.asset) {
      const errorMsg = (data && data.message) ? data.message : 'Image processing failed. Please try again.';
      showToast(errorMsg, 'error');
      resetProcessButton();
      state.isProcessing = false;
      navigateTo('upload');
      return;
    }

    backendAsset = data.asset;
    state.uploadedAsset = backendAsset;

    state.selectedFileMeta.name = backendAsset.originalName || state.selectedFileMeta.name;
    state.selectedFileMeta.size = formatFileSize(backendAsset.bytes) || state.selectedFileMeta.size;
    state.selectedFileMeta.dimensions = `${backendAsset.width || 2400} × ${backendAsset.height || 1600} px`;
    state.selectedFileMeta.type = backendAsset.format ? `image/${backendAsset.format}` : 'image/jpeg';

  } catch (err) {
    console.error('[Upload Request Error]:', err);
    showToast('Unable to connect to the backend server.', 'error');
    resetProcessButton();
    state.isProcessing = false;
    navigateTo('upload');
    return;
  }

  let currentStageIndex = 1;
  const totalStages = processingStages.length;
  const stageDuration = 250;

  const interval = setInterval(() => {
    currentStageIndex++;
    const progress = Math.min(Math.round((currentStageIndex / totalStages) * 100), 100);

    if (progressBar) progressBar.style.width = `${progress}%`;
    if (progressPct) progressPct.textContent = `${progress}%`;

    if (currentStageIndex <= totalStages) {
      const stage = processingStages[currentStageIndex - 1];
      if (statusMsg) statusMsg.textContent = stage.detail;
      renderStagesList(currentStageIndex);
    }

    if (currentStageIndex > totalStages) {
      clearInterval(interval);
      state.isProcessing = false;
      resetProcessButton();
      
      fetchDashboardStats();
      fetchAssetLibrary();

      setTimeout(() => {
        showToast('✓ AI Pipeline Complete: Moderation, Cutout, Smart Crops & Optimization!');
        populateResultsView(backendAsset);
        navigateTo('results');
      }, 300);
    }
  }, stageDuration);
}

function renderStagesList(currentActiveIndex) {
  const container = document.getElementById('stages-list-container');
  if (!container) return;

  container.innerHTML = processingStages.map((stage, idx) => {
    const stageNum = idx + 1;
    let itemClass = 'waiting';
    let badgeHtml = '<span class="stage-status-badge badge-waiting">○ Waiting</span>';

    if (stageNum < currentActiveIndex) {
      itemClass = 'completed';
      badgeHtml = '<span class="stage-status-badge badge-complete">✓ Complete</span>';
    } else if (stageNum === currentActiveIndex) {
      itemClass = 'processing';
      badgeHtml = '<span class="stage-status-badge badge-processing">⟳ Processing</span>';
    }

    return `
      <div class="stage-item ${itemClass}">
        <div class="stage-left">
          <span class="stage-num">${stage.name.split(' ')[0]}</span>
          <div class="stage-info">
            <span class="stage-name">${stage.name.split(' ').slice(1).join(' ')}</span>
            <span class="stage-detail">${stage.detail}</span>
          </div>
        </div>
        ${badgeHtml}
      </div>
    `;
  }).join('');
}

// ==========================================================================
// 4. ASSET STUDIO (Real Cloudinary URLs, Comparison Tabs & Pipeline Summary)
// ==========================================================================
function initResultsTabs() {
  const tabBtns = document.querySelectorAll('.results-tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tabId = btn.getAttribute('data-tab');
      switchResultTab(tabId);
    });
  });

  const btnRemoveBg = document.getElementById('btn-mode-remove-bg');
  const btnGenBg = document.getElementById('btn-mode-gen-bg');

  if (btnRemoveBg) {
    btnRemoveBg.addEventListener('click', () => {
      if (btnGenBg) btnGenBg.classList.remove('active');
      btnRemoveBg.classList.add('active');
      switchResultTab('bg-removed');
      const tabBtn = document.querySelector('.results-tab-btn[data-tab="bg-removed"]');
      if (tabBtn) {
        tabBtns.forEach(b => b.classList.remove('active'));
        tabBtn.classList.add('active');
      }
    });
  }

  if (btnGenBg) {
    btnGenBg.addEventListener('click', () => {
      if (btnRemoveBg) btnRemoveBg.classList.remove('active');
      btnGenBg.classList.add('active');
      switchResultTab('ai-background');
      const tabBtn = document.querySelector('.results-tab-btn[data-tab="ai-background"]');
      if (tabBtn) {
        tabBtns.forEach(b => b.classList.remove('active'));
        tabBtn.classList.add('active');
      }
    });
  }

  const promptChips = document.querySelectorAll('.prompt-chip');
  promptChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const promptText = chip.getAttribute('data-prompt');
      const input = document.getElementById('bg-prompt-input');
      if (input && promptText) {
        input.value = promptText;
        showToast(`Selected prompt: "${chip.textContent.trim()}"`, 'info');
      }
    });
  });

  const cropAspectBtns = document.querySelectorAll('.crop-aspect-btn');
  cropAspectBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      cropAspectBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const aspect = btn.getAttribute('data-aspect');
      switchResultTab('smart-crop');
      const smartCropTabBtn = document.querySelector('.results-tab-btn[data-tab="smart-crop"]');
      if (smartCropTabBtn) {
        tabBtns.forEach(b => b.classList.remove('active'));
        smartCropTabBtn.classList.add('active');
      }
      showToast(`Selected ${aspect} smart crop preview`, 'info');
    });
  });

  const btnGenCrop = document.getElementById('btn-generate-crop');
  if (btnGenCrop) {
    btnGenCrop.addEventListener('click', () => {
      switchResultTab('smart-crop');
      const smartCropTabBtn = document.querySelector('.results-tab-btn[data-tab="smart-crop"]');
      if (smartCropTabBtn) {
        tabBtns.forEach(b => b.classList.remove('active'));
        smartCropTabBtn.classList.add('active');
      }
      showToast('✓ Displaying Cloudinary subject-aware smart crops (c_fill,g_auto)');
    });
  }

  const genBgBtn = document.getElementById('btn-generate-bg');
  if (genBgBtn) {
    genBgBtn.addEventListener('click', () => {
      triggerGenerateAiBackground();
    });
  }

  const copyMetaBtn = document.getElementById('copy-metadata-btn');
  if (copyMetaBtn) {
    copyMetaBtn.addEventListener('click', () => {
      const asset = state.uploadedAsset || {};
      const assetTags = (asset.tags && asset.tags.length > 0) ? asset.tags : ['media', 'ugc-asset'];
      const assetObjects = (asset.objects && asset.objects.length > 0) ? asset.objects : ['Subject'];
      const meta = {
        id: asset.id || '',
        title: state.selectedFileMeta.name,
        public_id: asset.publicId || 'smart-ugc-studio/ugc_asset',
        original_url: asset.originalUrl || state.selectedFileDataUrl,
        optimized_url: asset.optimizedUrl || '',
        background_removed_url: asset.backgroundRemovedUrl || '',
        generated_background_url: asset.generatedBackgroundUrl || '',
        background_prompt: asset.backgroundPrompt || '',
        smart_crop_url: asset.smartCropUrl || '',
        format: asset.format || 'webp',
        width: asset.width || 2400,
        height: asset.height || 1600,
        bytes: asset.bytes || 3984588,
        moderation: asset.moderation || { status: 'approved', assetStatus: 'Safe / Approved', message: 'No policy violations detected' },
        tags: assetTags,
        objects: assetObjects,
        pipeline_summary: asset.pipelineSummary || {}
      };
      navigator.clipboard.writeText(JSON.stringify(meta, null, 2)).then(() => {
        showToast('✓ Cloudinary Asset Metadata copied to clipboard!');
      }).catch(() => {
        showToast('✓ Metadata ready!', 'info');
      });
    });
  }

  const btnCopyOpt = document.getElementById('btn-copy-optimized-url');
  if (btnCopyOpt) {
    btnCopyOpt.addEventListener('click', () => {
      const optUrl = (state.uploadedAsset && state.uploadedAsset.optimizedUrl) ? state.uploadedAsset.optimizedUrl : '';
      if (optUrl) {
        navigator.clipboard.writeText(optUrl).then(() => {
          showToast('✓ Signed Cloudinary Optimized URL (f_auto, q_auto) copied!');
        });
      } else {
        showToast('No active optimized asset URL available.', 'info');
      }
    });
  }

  const saveLibBtn = document.getElementById('save-to-library-btn');
  if (saveLibBtn) {
    saveLibBtn.addEventListener('click', () => {
      navigateTo('assets');
      if (state.isAuthenticated) fetchAssetLibrary();
    });
  }

  const processAnotherBtn = document.getElementById('process-another-btn');
  if (processAnotherBtn) {
    processAnotherBtn.addEventListener('click', () => {
      state.uploadedAsset = null;
      state.smartCropSource = 'original';
      state.selectedFile = null;
      setSampleImage(0);
      navigateTo('upload');
    });
  }
}

async function triggerGenerateAiBackground() {
  const asset = state.uploadedAsset;
  if (!asset || !asset.publicId) {
    showToast('Please upload or select an image in Asset Studio first.', 'error');
    return;
  }

  if (!state.isAuthenticated) {
    showToast('Please sign in with Google to generate AI backgrounds.', 'error');
    return;
  }

  const promptInput = document.getElementById('bg-prompt-input');
  const prompt = promptInput ? promptInput.value.trim() : '';

  if (!prompt) {
    showToast('Please enter a background prompt description.', 'error');
    if (promptInput) promptInput.focus();
    return;
  }

  const genBtn = document.getElementById('btn-generate-bg');
  const overlay = document.getElementById('gen-bg-loading-overlay');
  const aiBgImg = document.getElementById('res-img-ai-bg');
  const overlayTitle = overlay ? overlay.querySelector('span:nth-of-type(1)') : null;
  const overlaySubtitle = overlay ? overlay.querySelector('span:nth-of-type(2)') : null;

  if (genBtn) {
    genBtn.disabled = true;
    genBtn.style.opacity = '0.7';
    genBtn.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spinIcon 1.2s linear infinite;"><circle cx="12" cy="12" r="10"></circle><path d="M12 2a10 10 0 0 1 10 10"></path></svg>
      <span>Generating AI background...</span>
    `;
  }

  if (overlay) {
    overlay.style.display = 'flex';
    if (overlayTitle) overlayTitle.textContent = 'Generating AI background...';
    if (overlaySubtitle) overlaySubtitle.textContent = 'Cloudinary Generative AI Engine';
  }

  switchResultTab('ai-background');
  const aiTabBtn = document.querySelector('.results-tab-btn[data-tab="ai-background"]');
  if (aiTabBtn) {
    document.querySelectorAll('.results-tab-btn').forEach(b => b.classList.remove('active'));
    aiTabBtn.classList.add('active');
  }

  try {
    const response = await fetch('/api/generate-background', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicId: asset.publicId,
        assetId: asset.id,
        prompt: prompt
      })
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || !data || !data.success || !data.asset) {
      const errorMsg = (data && data.message) ? data.message : 'AI background generation failed.';
      showToast(errorMsg, 'error');
      if (overlay) overlay.style.display = 'none';
      resetGenerateBgButton();
      return;
    }

    const generatedUrl = data.asset.generatedBackgroundUrl;
    state.uploadedAsset.generatedBackgroundUrl = generatedUrl;
    state.uploadedAsset.backgroundPrompt = prompt;
    state.uploadedAsset.hasGeneratedBg = true;

    if (data.asset.genCrop11Url) state.uploadedAsset.genCrop11Url = data.asset.genCrop11Url;
    if (data.asset.genCrop45Url) state.uploadedAsset.genCrop45Url = data.asset.genCrop45Url;
    if (data.asset.genCrop169Url) state.uploadedAsset.genCrop169Url = data.asset.genCrop169Url;
    if (data.asset.genCrop916Url) state.uploadedAsset.genCrop916Url = data.asset.genCrop916Url;
    if (data.asset.crops) state.uploadedAsset.crops = data.asset.crops;
    if (data.asset.aiBgCrops) state.uploadedAsset.aiBgCrops = data.asset.aiBgCrops;

    setSmartCropSource('ai-bg', false);

    if (aiBgImg) {
      let attempts = 0;
      const maxAttempts = 25;
      const preloader = new Image();

      preloader.onload = () => {
        aiBgImg.src = preloader.src;
        if (overlay) overlay.style.display = 'none';
        resetGenerateBgButton();
        showToast('✓ Signed Cloudinary AI Background Generated & Applied to Smart Crops!');
      };

      preloader.onerror = () => {
        if (attempts < maxAttempts) {
          attempts++;
          if (overlayTitle) overlayTitle.textContent = `Generating AI background... (${attempts}/${maxAttempts})`;
          if (overlaySubtitle) overlaySubtitle.textContent = 'Processing neural scene synthesis on Cloudinary CDN';
          setTimeout(() => {
            const separator = generatedUrl.includes('?') ? '&' : '?';
            preloader.src = `${generatedUrl}${separator}_cld_poll=${Date.now()}`;
          }, 1500);
        } else {
          if (overlay) overlay.style.display = 'none';
          resetGenerateBgButton();
          aiBgImg.src = generatedUrl;
          showToast('Background generation queued on Cloudinary. Ready momentarily.', 'info');
        }
      };

      preloader.src = generatedUrl;
    } else {
      if (overlay) overlay.style.display = 'none';
      resetGenerateBgButton();
    }

  } catch (err) {
    console.error('[AI Background Request Error]:', err);
    showToast('Failed to connect to background generation server.', 'error');
    if (overlay) overlay.style.display = 'none';
    resetGenerateBgButton();
  }
}

function resetGenerateBgButton() {
  const genBtn = document.getElementById('btn-generate-bg');
  if (genBtn) {
    genBtn.disabled = false;
    genBtn.style.opacity = '1';
    genBtn.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
      <span id="btn-generate-bg-label">⚡ Generate AI Background</span>
    `;
  }
}

window.setSmartCropSource = function(source, showNotification = true) {
  state.smartCropSource = (source === 'ai-bg') ? 'ai-bg' : 'original';

  const vpOrigBtn = document.getElementById('vp-crop-src-original');
  const vpAiBtn = document.getElementById('vp-crop-src-ai-bg');
  const cardOrigBtn = document.getElementById('card-crop-src-original');
  const cardAiBtn = document.getElementById('card-crop-src-ai-bg');
  const statusBadge = document.getElementById('crop-source-status-badge');

  if (state.smartCropSource === 'ai-bg') {
    if (vpOrigBtn) vpOrigBtn.classList.remove('active');
    if (vpAiBtn) vpAiBtn.classList.add('active');
    if (cardOrigBtn) cardOrigBtn.classList.remove('active');
    if (cardAiBtn) cardAiBtn.classList.add('active');
    if (statusBadge) {
      statusBadge.textContent = 'AI Background Active';
      statusBadge.style.color = 'var(--cyan-light)';
      statusBadge.style.borderColor = 'rgba(6,182,212,0.3)';
      statusBadge.style.background = 'rgba(6,182,212,0.1)';
    }
    if (showNotification) {
      showToast('✓ Switched Smart Crop Source to: AI Generated Background');
    }
  } else {
    if (vpOrigBtn) vpOrigBtn.classList.add('active');
    if (vpAiBtn) vpAiBtn.classList.remove('active');
    if (cardOrigBtn) cardOrigBtn.classList.add('active');
    if (cardAiBtn) cardAiBtn.classList.remove('active');
    if (statusBadge) {
      statusBadge.textContent = 'Original UGC Active';
      statusBadge.style.color = 'var(--purple-light)';
      statusBadge.style.borderColor = 'rgba(139,92,246,0.3)';
      statusBadge.style.background = 'rgba(139,92,246,0.1)';
    }
    if (showNotification) {
      showToast('✓ Switched Smart Crop Source to: Original UGC Ingest');
    }
  }

  renderSmartCropPreviews();
};

function renderSmartCropPreviews(asset) {
  const currentAsset = asset || state.uploadedAsset || {};

  const isAiBg = state.smartCropSource === 'ai-bg';
  const fallbackUrl = state.selectedFileDataUrl || samplePresets[0].url;

  let crop11Url, crop45Url, crop169Url, crop916Url;
  let sourceLabel = '';
  let filenamePrefix = '';

  if (isAiBg) {
    sourceLabel = 'AI Background';
    filenamePrefix = 'ai_bg_smart_crop';
    crop11Url = (currentAsset.aiBgCrops && currentAsset.aiBgCrops.square && currentAsset.aiBgCrops.square.url)
      || currentAsset.genCrop11Url || currentAsset.crop11Url || fallbackUrl;
    crop45Url = (currentAsset.aiBgCrops && currentAsset.aiBgCrops.portrait && currentAsset.aiBgCrops.portrait.url)
      || currentAsset.genCrop45Url || currentAsset.crop45Url || fallbackUrl;
    crop169Url = (currentAsset.aiBgCrops && currentAsset.aiBgCrops.landscape && currentAsset.aiBgCrops.landscape.url)
      || currentAsset.genCrop169Url || currentAsset.crop169Url || fallbackUrl;
    crop916Url = (currentAsset.aiBgCrops && currentAsset.aiBgCrops.vertical && currentAsset.aiBgCrops.vertical.url)
      || currentAsset.genCrop916Url || currentAsset.crop916Url || fallbackUrl;
  } else {
    sourceLabel = 'Original UGC';
    filenamePrefix = 'smart_crop';
    crop11Url = (currentAsset.crops && currentAsset.crops.square && currentAsset.crops.square.url)
      || currentAsset.crop11Url || currentAsset.smartCropUrl || fallbackUrl;
    crop45Url = (currentAsset.crops && currentAsset.crops.portrait && currentAsset.crops.portrait.url)
      || currentAsset.crop45Url || fallbackUrl;
    crop169Url = (currentAsset.crops && currentAsset.crops.landscape && currentAsset.crops.landscape.url)
      || currentAsset.crop169Url || fallbackUrl;
    crop916Url = (currentAsset.crops && currentAsset.crops.vertical && currentAsset.crops.vertical.url)
      || currentAsset.crop916Url || fallbackUrl;
  }

  const cropConfigs = [
    { id: '1-1', url: crop11Url, ratio: '1:1 Square', filename: `${filenamePrefix}_1x1.jpg` },
    { id: '4-5', url: crop45Url, ratio: '4:5 Portrait', filename: `${filenamePrefix}_4x5.jpg` },
    { id: '16-9', url: crop169Url, ratio: '16:9 Landscape', filename: `${filenamePrefix}_16x9.jpg` },
    { id: '9-16', url: crop916Url, ratio: '9:16 Vertical', filename: `${filenamePrefix}_9x16.jpg` }
  ];

  cropConfigs.forEach(item => {
    const img = document.getElementById(`crop-img-${item.id}`);
    const lbl = document.getElementById(`label-crop-${item.id}`);
    const btnDl = document.getElementById(`btn-dl-crop-${item.id}`);
    const spinner = document.getElementById(`crop-spinner-${item.id}`);

    if (lbl) {
      lbl.textContent = `${item.ratio} (${sourceLabel})`;
    }

    if (btnDl) {
      btnDl.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.triggerDownload(item.url, item.filename);
      };
    }

    if (img) {
      img.dataset.cropUrl = item.url;
      img.alt = `${item.ratio} (${sourceLabel})`;

      if (spinner) {
        spinner.innerHTML = `
          <div class="crop-spinner-icon"></div>
          <span class="crop-spinner-text">Loading ${item.id}...</span>
        `;
        spinner.style.display = 'flex';
      }
      img.style.opacity = '0';

      let retryCount = 0;
      const maxRetries = 5;

      img.onload = () => {
        if (spinner) spinner.style.display = 'none';
        img.style.opacity = '1';
      };

      img.onerror = () => {
        if (retryCount < maxRetries) {
          retryCount++;
          setTimeout(() => {
            const separator = item.url.includes('?') ? '&' : '?';
            img.src = `${item.url}${separator}_retry=${Date.now()}`;
          }, 1500);
        } else {
          if (spinner) {
            spinner.innerHTML = `
              <div style="color: #f43f5e; font-size: 11px; text-align: center; padding: 4px;">
                <span>Failed to load preview</span><br>
                <button type="button" class="btn btn-secondary btn-xs" style="margin-top: 4px; padding: 2px 6px; font-size: 10px;" onclick="renderSmartCropPreviews()">Retry</button>
              </div>
            `;
            spinner.style.display = 'flex';
          }
        }
      };

      img.src = item.url;
    }
  });
}

function populateResultsView(asset) {
  const currentAsset = asset || state.uploadedAsset;
  const fallbackUrl = state.selectedFileDataUrl || samplePresets[0].url;

  const originalUrl = (currentAsset && currentAsset.originalUrl) ? currentAsset.originalUrl : fallbackUrl;
  const bgRemovedUrl = (currentAsset && currentAsset.backgroundRemovedUrl) ? currentAsset.backgroundRemovedUrl : fallbackUrl;
  const genBgUrl = (currentAsset && currentAsset.generatedBackgroundUrl) ? currentAsset.generatedBackgroundUrl : fallbackUrl;
  const optimizedUrl = (currentAsset && currentAsset.optimizedUrl) ? currentAsset.optimizedUrl : fallbackUrl;

  const originalImg = document.getElementById('res-img-original');
  const modImg = document.getElementById('res-img-moderated');
  const bgOrigImg = document.getElementById('res-img-bg-orig');
  const bgCutoutImg = document.getElementById('res-img-bg-cutout');
  const genBgOrig = document.getElementById('res-gen-bg-orig');
  const genBgImg = document.getElementById('res-img-ai-bg');
  const optOrigImg = document.getElementById('res-img-opt-orig');
  const optImg = document.getElementById('res-img-optimized');

  if (originalImg) originalImg.src = originalUrl;
  if (modImg) modImg.src = originalUrl;
  if (bgOrigImg) bgOrigImg.src = originalUrl;
  if (genBgOrig) genBgOrig.src = originalUrl;
  if (optOrigImg) optOrigImg.src = originalUrl;
  if (optImg) optImg.src = optimizedUrl;
  
  if (bgCutoutImg) {
    bgCutoutImg.src = bgRemovedUrl;
    let bgRetries = 0;
    bgCutoutImg.onerror = () => {
      if (bgRetries < 10) {
        bgRetries++;
        setTimeout(() => {
          bgCutoutImg.src = bgRemovedUrl + (bgRemovedUrl.includes('?') ? '&' : '?') + `_retry=${Date.now()}`;
        }, 1500);
      }
    };
  }

  if (genBgImg) {
    genBgImg.src = genBgUrl;
    let genRetries = 0;
    genBgImg.onerror = () => {
      if (genRetries < 20) {
        genRetries++;
        setTimeout(() => {
          genBgImg.src = genBgUrl + (genBgUrl.includes('?') ? '&' : '?') + `_retry=${Date.now()}`;
        }, 1500);
      }
    };
  }

  const promptInput = document.getElementById('bg-prompt-input');
  if (promptInput) {
    promptInput.value = (currentAsset && currentAsset.backgroundPrompt)
      ? currentAsset.backgroundPrompt
      : 'Clean premium white studio background with soft natural lighting and a subtle realistic shadow underneath the subject.';
  }

  // Default to original UGC crops unless asset explicitly has an AI background generated
  state.smartCropSource = (currentAsset && currentAsset.hasGeneratedBg) ? 'ai-bg' : 'original';
  setSmartCropSource(state.smartCropSource, false);

  const origSizeEl = document.getElementById('res-stat-orig-size');
  if (origSizeEl) {
    origSizeEl.textContent = currentAsset && currentAsset.bytes ? formatFileSize(currentAsset.bytes) : state.selectedFileMeta.size;
  }

  const openOptBtn = document.getElementById('btn-open-optimized');
  if (openOptBtn) {
    openOptBtn.href = optimizedUrl;
  }

  renderPipelineSummary(currentAsset);

  const modData = (currentAsset && currentAsset.moderation) ? currentAsset.moderation : {
    moderated: false,
    kind: 'aws_rek',
    status: 'approved',
    assetStatus: 'Safe / Approved',
    message: 'No policy violations detected',
    labels: []
  };

  const modStatus = (modData.status || 'approved').toLowerCase();
  const modHero = document.getElementById('moderation-status-hero');
  const modHeroIcon = document.getElementById('mod-hero-icon');
  const modStatusText = document.getElementById('moderation-status-text');
  const modMessageText = document.getElementById('moderation-message-text');
  const modCardBadge = document.getElementById('mod-card-badge');
  const modBarsList = document.getElementById('moderation-bars-list');
  const modViewportOverlay = document.getElementById('mod-viewport-overlay');
  const modViewportIcon = document.getElementById('mod-viewport-icon');
  const modViewportText = document.getElementById('mod-viewport-text');

  if (modCardBadge) {
    modCardBadge.textContent = modData.kind && modData.kind !== 'none'
      ? `Cloudinary AI (${modData.kind})`
      : 'Cloudinary AI Moderation';
  }

  if (modMessageText) {
    modMessageText.textContent = modData.message || 'No policy violations detected';
  }

  if (modStatus === 'rejected') {
    if (modHero) {
      modHero.className = 'moderation-status-hero rejected';
      if (modHeroIcon) modHeroIcon.outerHTML = '<svg id="mod-hero-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f43f5e" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
    }
    if (modStatusText) modStatusText.textContent = '✕ REJECTED';

    if (modViewportOverlay) {
      modViewportOverlay.className = 'moderation-overlay-box rejected';
      if (modViewportIcon) modViewportIcon.outerHTML = '<svg id="mod-viewport-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
      if (modViewportText) modViewportText.textContent = '✕ REJECTED • Safety Policy Violation';
    }
  } else if (modStatus === 'pending' || modStatus === 'flagged' || modStatus === 'review_required') {
    if (modHero) {
      modHero.className = 'moderation-status-hero flagged';
      if (modHeroIcon) modHeroIcon.outerHTML = '<svg id="mod-hero-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--warning-amber)" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
    }
    if (modStatusText) modStatusText.textContent = '⚠ REVIEW REQUIRED';

    if (modViewportOverlay) {
      modViewportOverlay.className = 'moderation-overlay-box flagged';
      if (modViewportIcon) modViewportIcon.outerHTML = '<svg id="mod-viewport-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
      if (modViewportText) modViewportText.textContent = '⚠ REVIEW REQUIRED • Flagged for Safety';
    }
  } else {
    if (modHero) {
      modHero.className = 'moderation-status-hero';
      if (modHeroIcon) modHeroIcon.outerHTML = '<svg id="mod-hero-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--safe-emerald)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    }
    if (modStatusText) modStatusText.textContent = '✓ APPROVED';

    if (modViewportOverlay) {
      modViewportOverlay.className = 'moderation-overlay-box';
      if (modViewportIcon) modViewportIcon.outerHTML = '<svg id="mod-viewport-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>';
      if (modViewportText) modViewportText.textContent = '✓ APPROVED • AI Verified (Cloudinary)';
    }
  }

  if (modBarsList) {
    if (modData.labels && modData.labels.length > 0) {
      modBarsList.innerHTML = modData.labels.map(l => {
        const conf = typeof l.confidence === 'number' ? l.confidence : parseFloat(l.confidence || 0);
        const barClass = modStatus === 'rejected' ? 'rejected' : (modStatus === 'pending' ? 'flagged' : '');
        return `
          <div class="mod-bar-item">
            <div class="mod-bar-label-row">
              <span class="mod-category">${escapeHtml(l.name)} ${l.parentName ? `<span style="color:var(--text-muted);">(${escapeHtml(l.parentName)})</span>` : ''}</span>
              <span class="mod-pct" style="color: ${modStatus === 'rejected' ? '#f43f5e' : (modStatus === 'pending' ? 'var(--warning-amber)' : '#fff')};">${conf.toFixed(1)}%</span>
            </div>
            <div class="mod-progress-track">
              <div class="mod-progress-bar ${barClass}" style="width: ${Math.min(conf, 100)}%;"></div>
            </div>
          </div>
        `;
      }).join('');
    } else {
      const defaultCategories = [
        { name: 'Adult / Explicit Content', val: '0.0%' },
        { name: 'Violence / Gore', val: '0.0%' },
        { name: 'Weapons / Threat', val: '0.0%' },
        { name: 'Drugs / Controlled Substances', val: '0.0%' },
        { name: 'Offensive / Hate Symbols', val: '0.0%' }
      ];

      modBarsList.innerHTML = defaultCategories.map(cat => `
        <div class="mod-bar-item">
          <div class="mod-bar-label-row">
            <span class="mod-category">${cat.name}</span>
            <span class="mod-pct" style="color: var(--safe-emerald);">${cat.val}</span>
          </div>
          <div class="mod-progress-track">
            <div class="mod-progress-bar" style="width: 0%;"></div>
          </div>
        </div>
      `).join('');
    }
  }

  const tagsContainer = document.getElementById('res-tags-cloud');
  const objectsContainer = document.getElementById('res-objects-cloud');
  const visionCardBadge = document.getElementById('vision-card-badge');

  if (visionCardBadge) {
    visionCardBadge.textContent = 'Cloudinary AI Vision';
  }

  const assetTags = (currentAsset && Array.isArray(currentAsset.tags)) ? currentAsset.tags : [];

  if (tagsContainer) {
    if (assetTags.length > 0) {
      tagsContainer.innerHTML = assetTags.map(tag => `
        <span class="tag-pill">#${escapeHtml(tag)}</span>
      `).join('');
    } else {
      tagsContainer.innerHTML = `<span class="tag-pill" style="opacity: 0.7;">AI metadata ready</span>`;
    }
  }

  const assetObjects = (currentAsset && Array.isArray(currentAsset.objects) && currentAsset.objects.length > 0)
    ? currentAsset.objects
    : (assetTags.length > 0 ? assetTags.slice(0, 4) : []);

  if (objectsContainer) {
    if (assetObjects.length > 0) {
      objectsContainer.innerHTML = assetObjects.map(obj => `
        <span class="obj-pill">${escapeHtml(obj)}</span>
      `).join('');
    } else {
      objectsContainer.innerHTML = `<span class="obj-pill" style="opacity: 0.7;">Subject</span>`;
    }
  }

  const mainTitle = document.getElementById('results-main-title');
  const statusBadge = document.getElementById('results-status-badge');
  const subtitle = document.getElementById('results-subtitle');

  if (mainTitle) mainTitle.textContent = currentAsset && currentAsset.originalName ? `Studio: ${currentAsset.originalName}` : 'Asset Studio';
  if (statusBadge) statusBadge.textContent = 'Signed Private Asset';
  if (subtitle) subtitle.textContent = 'AI Moderation, Auto-Tagging, Background Removal (e_background_removal), AI Background Generator (e_gen_background_replace), Smart Crop (g_auto), and Delivery Optimization.';

  switchResultTab('original');
}

function renderPipelineSummary(asset) {
  const container = document.getElementById('pipeline-summary-list');
  if (!container) return;

  const currentAsset = asset || state.uploadedAsset || {};
  const rawSummary = currentAsset.pipelineSummary || {};

  const stepKeys = [
    { key: ['upload'], defaultName: 'Upload to Cloudinary', defaultDetail: `Stored securely in Cloudinary (${formatFileSize(currentAsset.bytes || 3984588)})`, defaultStatus: 'success' },
    { key: ['moderation'], defaultName: 'AI Content Moderation', defaultDetail: (currentAsset.moderation && currentAsset.moderation.message) ? currentAsset.moderation.message : 'Safety analysis completed', defaultStatus: (currentAsset.moderation && currentAsset.moderation.status === 'rejected') ? 'rejected' : 'success' },
    { key: ['autoTags', 'vision'], defaultName: 'AI Auto-Tagging & Vision', defaultDetail: `Extracted ${(currentAsset.tags || []).length || 5} semantic tags`, defaultStatus: 'success' },
    { key: ['backgroundRemoval', 'bgRemoval'], defaultName: 'Neural Background Removal', defaultDetail: 'Generated transparent cutout (e_background_removal)', defaultStatus: 'success' },
    { key: ['backgroundGeneration', 'genBackground'], defaultName: 'AI Background Generator', defaultDetail: currentAsset.generatedBackgroundUrl ? 'Custom AI background rendered (e_gen_background_replace)' : 'Ready for custom prompt generation (e_gen_background_replace)', defaultStatus: currentAsset.generatedBackgroundUrl ? 'success' : 'ready' },
    { key: ['smartCrop'], defaultName: 'Smart Product Crop', defaultDetail: 'Generated 1:1, 4:5, 16:9, and 9:16 crops with g_auto', defaultStatus: 'success' },
    { key: ['deliveryOptimization', 'optimization'], defaultName: 'Smart Delivery Optimization', defaultDetail: 'Configured f_auto and q_auto dynamic delivery', defaultStatus: 'success' }
  ];

  const steps = stepKeys.map(def => {
    let matched = null;
    for (const k of def.key) {
      if (rawSummary[k]) {
        matched = rawSummary[k];
        break;
      }
    }
    return {
      name: (matched && (matched.name || matched.label)) || def.defaultName,
      detail: (matched && matched.detail) || def.defaultDetail,
      status: (matched && matched.status) || def.defaultStatus
    };
  });

  container.innerHTML = steps.map(step => {
    let badgeClass = 'complete';
    let badgeLabel = '✓ Complete';

    if (step.status === 'ready') {
      badgeClass = 'ready';
      badgeLabel = '⚡ Ready';
    } else if (step.status === 'warning' || step.status === 'pending' || step.status === 'flagged') {
      badgeClass = 'warning';
      badgeLabel = '⚠ Flagged';
    } else if (step.status === 'rejected') {
      badgeClass = 'rejected';
      badgeLabel = '✕ Rejected';
    } else if (step.status === 'failed' || step.status === 'error') {
      badgeClass = 'rejected';
      badgeLabel = '✕ Failed';
    }

    return `
      <div class="summary-step-item">
        <div class="summary-step-info">
          <span class="summary-step-name">${escapeHtml(step.name)}</span>
          <span class="summary-step-detail">${escapeHtml(step.detail)}</span>
        </div>
        <span class="summary-step-badge ${badgeClass}">${badgeLabel}</span>
      </div>
    `;
  }).join('');
}

function switchResultTab(tabId) {
  state.activeResultTab = tabId;

  document.querySelectorAll('.tab-viewport').forEach(vp => {
    vp.style.display = 'none';
  });

  const activeViewport = document.getElementById(`viewport-${tabId}`);
  if (activeViewport) {
    activeViewport.style.display = 'flex';
  }

  if (tabId === 'smart-crop') {
    renderSmartCropPreviews();
  }
}

// ==========================================================================
// 5. ASSET LIBRARY & SECURE DELETION (User-Specific)
// ==========================================================================
function initAssetLibrary() {
  const searchInput = document.getElementById('library-search-input');
  const filterBtns = document.querySelectorAll('.filter-btn');
  const sortSelect = document.getElementById('library-sort-select');
  const refreshBtn = document.getElementById('btn-refresh-library');

  let debounceTimer = null;
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      state.librarySearch = e.target.value.trim();
      debounceTimer = setTimeout(() => {
        if (state.isAuthenticated) fetchAssetLibrary();
      }, 350);
    });
  }

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.libraryFilter = btn.getAttribute('data-filter');
      if (state.isAuthenticated) fetchAssetLibrary();
    });
  });

  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      state.librarySort = e.target.value;
      if (state.isAuthenticated) fetchAssetLibrary();
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      if (!state.isAuthenticated) {
        showToast('Please sign in with Google to view your assets.', 'info');
        return;
      }
      showToast('Syncing your private assets from database...', 'info');
      fetchAssetLibrary(true);
      fetchDashboardStats();
    });
  }
}

async function fetchAssetLibrary(showToastOnComplete = false) {
  const grid = document.getElementById('asset-grid-container');
  if (!grid) return;

  if (!state.isAuthenticated) {
    renderAuthUI();
    return;
  }

  state.isLoadingLibrary = true;
  grid.innerHTML = `
    <div class="loading-state-box">
      <div class="loading-spinner"></div>
      <p style="font-size: 15px; font-weight: 600; color: #fff;">Loading your private assets...</p>
      <p style="font-size: 12.5px; color: var(--text-muted); margin-top: 4px;">Querying database with authorized signed delivery</p>
    </div>
  `;

  try {
    const params = new URLSearchParams();
    if (state.librarySearch) params.append('search', state.librarySearch);
    if (state.libraryFilter && state.libraryFilter !== 'all') {
      if (state.libraryFilter === 'safe' || state.libraryFilter === 'flagged') {
        params.append('moderation', state.libraryFilter);
      } else {
        params.append('tag', state.libraryFilter);
      }
    }
    if (state.librarySort) params.append('sort', state.librarySort);

    const response = await fetch(`/api/assets?${params.toString()}`);
    const data = await response.json().catch(() => null);

    if (response.status === 401) {
      state.isAuthenticated = false;
      state.user = null;
      renderAuthUI();
      return;
    }

    if (!response.ok || !data || !data.success) {
      grid.innerHTML = `
        <div class="empty-state-box">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#f43f5e" stroke-width="1.5" style="margin-bottom: 12px; opacity: 0.8;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          <p style="font-size: 16px; font-weight: 600; color: #fff;">Unable to load assets</p>
          <p style="font-size: 13px; color: var(--text-muted); margin-top: 4px;">Could not retrieve your private assets.</p>
          <button class="btn btn-secondary btn-sm" onclick="fetchAssetLibrary(true)" style="margin-top: 14px;">Try Again</button>
        </div>
      `;
      state.isLoadingLibrary = false;
      return;
    }

    state.assets = data.assets || [];
    renderAssetLibraryGrid();

    if (showToastOnComplete) {
      showToast(`✓ Loaded ${state.assets.length} private assets!`);
    }

  } catch (err) {
    console.error('[Asset Library Fetch Error]:', err);
    grid.innerHTML = `
      <div class="empty-state-box">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom: 12px; opacity: 0.5;"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
        <p style="font-size: 16px; font-weight: 600; color: #fff;">Network Error</p>
        <p style="font-size: 13px; color: var(--text-muted); margin-top: 4px;">Failed to reach the backend service.</p>
      </div>
    `;
  } finally {
    state.isLoadingLibrary = false;
  }
}

function renderAssetLibraryGrid() {
  const grid = document.getElementById('asset-grid-container');
  if (!grid) return;

  if (!state.isAuthenticated) {
    grid.innerHTML = '';
    return;
  }

  if (!state.assets || state.assets.length === 0) {
    grid.innerHTML = `
      <div class="empty-state-box">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom: 12px; opacity: 0.5;"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
        <p style="font-size: 16px; font-weight: 600; color: #fff;">No assets uploaded yet</p>
        <p style="font-size: 13px; color: var(--text-muted); margin-top: 4px;">Upload your first image to process it through the AI pipeline.</p>
        <button class="btn btn-primary btn-sm" onclick="navigateTo('upload')" style="margin-top: 14px;">＋ Upload UGC Image</button>
      </div>
    `;
    return;
  }

  grid.innerHTML = state.assets.map(asset => {
    const statusClass = asset.status === 'safe' ? 'safe' : (asset.status === 'flagged' ? 'flagged' : 'pending');
    const statusLabel = asset.status === 'safe' ? '✓ SAFE' : (asset.status === 'flagged' ? '⚠ FLAGGED' : '○ PENDING');
    const tags = Array.isArray(asset.tags) ? asset.tags : [];
    const displayThumb = asset.thumbnailUrl || asset.optimizedUrl || asset.originalUrl;

    return `
      <div class="asset-card" onclick="openAssetModal('${escapeHtml(asset.id)}')">
        <div class="asset-thumb-wrap">
          <img class="asset-thumb-img" src="${displayThumb}" alt="${escapeHtml(asset.title)}" loading="lazy" />
          <span class="asset-status-tag ${statusClass}">
            ${statusLabel}
          </span>
          <div class="card-quick-actions" onclick="event.stopPropagation()">
            <button type="button" class="quick-act-btn" title="Open in Asset Studio" onclick="loadAssetIntoStudio('${escapeHtml(asset.id)}')">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
            </button>
            <button type="button" class="quick-act-btn" title="Copy Signed Optimized URL" onclick="copyAssetUrl('${escapeHtml(asset.optimizedUrl || asset.originalUrl)}')">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            </button>
            <button type="button" class="quick-act-btn danger" title="Delete Asset" onclick="confirmDeleteAsset('${escapeHtml(asset.id)}', '${escapeHtml(asset.title)}')">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f43f5e" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
        </div>
        <div class="asset-body">
          <div class="asset-title-row">
            <span class="asset-filename" title="${escapeHtml(asset.title)}">${escapeHtml(asset.title)}</span>
          </div>
          <div class="asset-tags-row">
            ${tags.slice(0, 3).map(t => `<span class="asset-mini-tag">#${escapeHtml(t)}</span>`).join('')}
            ${tags.length > 3 ? `<span class="asset-mini-tag">+${tags.length - 3}</span>` : ''}
          </div>
          <div class="asset-footer-row">
            <span>${formatFileSize(asset.bytes) || 'Cloudinary'}</span>
            <span class="asset-size-savings">f_auto / q_auto</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// Modal View for Assets
window.openAssetModal = function(assetId) {
  const asset = state.assets.find(a => a.id === assetId || a.publicId === assetId);
  if (!asset) return;

  const modalBackdrop = document.getElementById('asset-modal-backdrop');
  const modalContent = document.getElementById('asset-modal-body');

  if (!modalBackdrop || !modalContent) return;

  const statusPillClass = asset.status === 'safe' ? 'cyan' : (asset.status === 'flagged' ? 'purple' : 'cyan');
  const tags = Array.isArray(asset.tags) ? asset.tags : [];
  const previewImg = asset.optimizedUrl || asset.originalUrl;

  modalContent.innerHTML = `
    <div style="display: flex; gap: 24px; flex-wrap: wrap;">
      <div style="flex: 1; min-width: 260px; max-height: 380px; border-radius: 12px; overflow: hidden; background: #000; display: flex; align-items: center; justify-content: center; position: relative;" class="clickable-preview" onclick="openLightbox('${previewImg}', '${escapeHtml(asset.title)}', 'Cloudinary Signed Asset')">
        <img src="${previewImg}" alt="${escapeHtml(asset.title)}" style="max-width: 100%; max-height: 100%; object-fit: contain;" />
        <div class="img-hover-hint">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          Enlarge
        </div>
      </div>
      <div style="flex: 1.2; min-width: 260px; display: flex; flex-direction: column; gap: 14px;">
        <div>
          <span class="pill-badge ${statusPillClass}">${(asset.status || 'safe').toUpperCase()} ASSET</span>
          <h3 style="font-size: 18px; margin-top: 8px; color: #fff; word-break: break-word;">${escapeHtml(asset.title)}</h3>
          <p style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">Processed ${formatDate(asset.createdAt)} • Cloudinary Managed</p>
        </div>

        <div style="background: rgba(15,23,42,0.7); border: 1px solid var(--border-subtle); padding: 12px 16px; border-radius: 10px; display: flex; flex-direction: column; gap: 6px;">
          <div style="display: flex; justify-content: space-between; font-size: 12px;">
            <span style="color: var(--text-secondary);">Ingested Size:</span>
            <span style="color: #fff; font-weight: 600;">${formatFileSize(asset.bytes)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 12px;">
            <span style="color: var(--text-secondary);">Delivery Format:</span>
            <span style="color: var(--cyan-light); font-weight: 600;">Auto WebP / AVIF (f_auto)</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 12px;">
            <span style="color: var(--text-secondary);">Perceptual Quality:</span>
            <span style="color: var(--safe-emerald); font-weight: 600;">q_auto (Lossless Perceptual)</span>
          </div>
        </div>

        ${tags.length > 0 ? `
          <div>
            <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase;">Cloudinary AI Tags</label>
            <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px;">
              ${tags.map(t => `<span class="tag-pill">#${escapeHtml(t)}</span>`).join('')}
            </div>
          </div>
        ` : ''}

        <div style="margin-top: auto; display: flex; flex-wrap: wrap; gap: 8px; align-items: center;">
          <button type="button" class="btn btn-primary btn-sm" onclick="loadAssetIntoStudio('${escapeHtml(asset.id)}'); closeAssetModal();">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
            Open in Studio
          </button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="triggerDownload('${previewImg}', '${escapeHtml(asset.title || 'asset.jpg')}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            Download
          </button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="copyAssetUrl('${escapeHtml(asset.optimizedUrl || asset.originalUrl)}')">
            Copy URL
          </button>
          <button type="button" class="btn btn-danger btn-sm" style="margin-left: auto;" onclick="confirmDeleteAsset('${escapeHtml(asset.id)}', '${escapeHtml(asset.title)}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            Delete Asset
          </button>
        </div>
      </div>
    </div>
  `;

  modalBackdrop.classList.add('active');
};

window.closeAssetModal = function() {
  const modalBackdrop = document.getElementById('asset-modal-backdrop');
  if (modalBackdrop) modalBackdrop.classList.remove('active');
};

window.copyAssetUrl = function(url) {
  if (!url) return;
  navigator.clipboard.writeText(url).then(() => {
    showToast('✓ Signed Asset URL copied to clipboard!');
  }).catch(() => {
    showToast('✓ Asset URL ready.', 'info');
  });
};

window.loadAssetIntoStudio = function(assetId) {
  const asset = state.assets.find(a => a.id === assetId || a.publicId === assetId);
  if (!asset) return;

  state.uploadedAsset = asset;
  state.selectedFileMeta = {
    name: asset.title || asset.originalName || 'Cloudinary UGC Asset',
    size: formatFileSize(asset.bytes),
    dimensions: `${asset.width || 2400} × ${asset.height || 1600} px`,
    rawBytes: asset.bytes || 3984588,
    type: asset.format ? `image/${asset.format}` : 'image/jpeg'
  };

  populateResultsView(asset);
  navigateTo('results');
  showToast(`Loaded "${asset.title}" into Asset Studio!`);
};

// Secure Asset Deletion Action
window.confirmDeleteAsset = async function(assetId, assetTitle) {
  if (!confirm(`Are you sure you want to permanently delete "${assetTitle || 'this asset'}"?\nThis will remove the Cloudinary file and all associated metadata.`)) {
    return;
  }

  showToast('Deleting asset from Cloudinary and database...', 'info');

  try {
    const response = await fetch(`/api/assets/${encodeURIComponent(assetId)}`, {
      method: 'DELETE'
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || !data || !data.success) {
      const errorMsg = (data && data.message) ? data.message : 'Failed to delete asset.';
      showToast(errorMsg, 'error');
      return;
    }

    showToast('✓ Asset permanently deleted successfully!', 'success');
    closeAssetModal();

    // If active asset in studio was deleted, reset
    if (state.uploadedAsset && state.uploadedAsset.id === assetId) {
      state.uploadedAsset = null;
    }

    // Refresh library and stats
    await fetchAssetLibrary();
    await fetchDashboardStats();
    await fetchRecentDashboardAssets();

  } catch (err) {
    console.error('[Delete Asset Error]:', err);
    showToast('Network error while deleting asset.', 'error');
  }
};

// ==========================================================================
// 6. DASHBOARD DYNAMIC METRICS & RECENT ACTIVITY
// ==========================================================================
async function fetchDashboardStats() {
  if (!state.isAuthenticated) return;
  state.isLoadingStats = true;
  try {
    const res = await fetch('/api/asset-stats');
    const data = await res.json().catch(() => null);

    if (data && data.success && data.stats) {
      state.dashboardStats = data.stats;
      
      const kpiAssets = document.getElementById('kpi-assets-count');
      const kpiSafe = document.getElementById('kpi-safe-rate');
      const kpiTags = document.getElementById('kpi-tags-count');
      const kpiStorage = document.getElementById('kpi-storage-managed');

      const totalAssets = data.stats.totalAssets || 0;
      const safeRate = data.stats.safePercentage != null ? data.stats.safePercentage : 100;
      const totalTags = data.stats.totalTagsIndexed != null ? data.stats.totalTagsIndexed : 0;
      const totalBytes = data.stats.totalBytesStored != null ? data.stats.totalBytesStored : 0;

      if (kpiAssets) kpiAssets.textContent = totalAssets.toLocaleString();
      if (kpiSafe) kpiSafe.textContent = `${safeRate}%`;
      if (kpiTags) kpiTags.textContent = totalTags.toLocaleString();
      if (kpiStorage) kpiStorage.textContent = formatFileSize(totalBytes);
    }
  } catch (err) {
    console.warn('[Stats Fetch Notice]:', err.message);
  } finally {
    state.isLoadingStats = false;
  }
}

async function fetchRecentDashboardAssets() {
  const recentGrid = document.getElementById('dashboard-recent-grid');
  if (!recentGrid) return;

  if (!state.isAuthenticated) {
    recentGrid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 32px 16px; color: var(--text-muted);">
        <p style="font-size: 14px; color: #fff;">Private Studio Dashboard</p>
        <p style="font-size: 12px; margin-top: 4px;">Sign in with Google to access your automated AI media pipeline and personal library.</p>
        <a href="/auth/google" class="btn-google-login" style="margin-top: 14px; display: inline-flex;">
          <svg class="google-icon-svg" viewBox="0 0 24 24">
            <path fill="#EA4335" d="M12 5c1.6 0 3 .6 4.1 1.7l3.1-3.1C17.3 1.8 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.4 9 5 12 5z"/>
            <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.7-.2-2.3H12v4.6h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.9z"/>
            <path fill="#FBBC05" d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3 0-.8.2-1.6.4-2.3L1.9 7.3C.7 9.7 0 12.3 0 15.2c0 2.8.7 5.4 1.9 7.8l3.7-2.9z"/>
            <path fill="#34A853" d="M12 23.5c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.4-6.4-5.2L1.9 16.5C3.7 20.4 7.5 23.5 12 23.5z"/>
          </svg>
          <span>Continue with Google</span>
        </a>
      </div>
    `;
    return;
  }

  try {
    const res = await fetch('/api/assets?limit=3');
    const data = await res.json().catch(() => null);

    if (data && data.success && Array.isArray(data.assets) && data.assets.length > 0) {
      recentGrid.innerHTML = data.assets.slice(0, 3).map(asset => `
        <div class="asset-card" onclick="loadAssetIntoStudio('${escapeHtml(asset.id)}')">
          <div class="asset-thumb-wrap">
            <img class="asset-thumb-img" src="${asset.thumbnailUrl || asset.optimizedUrl || asset.originalUrl}" alt="${escapeHtml(asset.title)}" loading="lazy" />
            <span class="asset-status-tag ${asset.status === 'safe' ? 'safe' : 'flagged'}">
              ${asset.status === 'safe' ? '✓ SAFE' : '⚠ FLAGGED'}
            </span>
          </div>
          <div class="asset-body">
            <div class="asset-title-row">
              <span class="asset-filename" title="${escapeHtml(asset.title)}">${escapeHtml(asset.title)}</span>
            </div>
            <div class="asset-tags-row">
              ${(asset.tags || []).slice(0, 3).map(t => `<span class="asset-mini-tag">#${escapeHtml(t)}</span>`).join('')}
            </div>
            <div class="asset-footer-row">
              <span>${formatFileSize(asset.bytes) || 'Cloudinary'}</span>
              <span class="asset-size-savings">Open in Studio →</span>
            </div>
          </div>
        </div>
      `).join('');
    } else {
      recentGrid.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 32px 16px; color: var(--text-muted);">
          <p style="font-size: 14px; color: #fff;">No assets uploaded yet</p>
          <p style="font-size: 12px; margin-top: 4px;">Upload an image to trigger the automated Cloudinary AI pipeline.</p>
          <button class="btn btn-primary btn-sm" onclick="navigateTo('upload')" style="margin-top: 12px;">＋ Process New Image</button>
        </div>
      `;
    }
  } catch (err) {
    console.warn('[Recent Assets Fetch Notice]:', err.message);
  }
}

// ==========================================================================
// 7. SETTINGS & CLOUDINARY STATUS
// ==========================================================================
async function checkCloudinaryBackendHealth(showSuccessToast = false) {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    
    const isConnected = Boolean(data && data.success && data.cloudinaryConfigured);
    const cloudName = (data && data.cloudinary && data.cloudinary.cloudName) ? data.cloudinary.cloudName : 'Active';

    const connBadge = document.getElementById('settings-conn-badge');
    const cloudStatusTag = document.getElementById('settings-cloud-status-tag');
    const cloudNameEl = document.getElementById('settings-cloud-name');
    const sidebarBadge = document.getElementById('sidebar-cloud-badge');

    if (isConnected) {
      if (connBadge) {
        connBadge.className = 'pill-badge cyan';
        connBadge.innerHTML = '<span class="status-dot" style="position: static; transform: none; width: 6px; height: 6px;"></span> Connected';
      }
      if (cloudStatusTag) {
        cloudStatusTag.className = 'connected-tag';
        cloudStatusTag.textContent = '● Connected';
      }
      if (cloudNameEl) {
        cloudNameEl.textContent = cloudName;
      }
      if (sidebarBadge) {
        sidebarBadge.className = 'pill-badge cyan';
        sidebarBadge.textContent = 'Live';
      }
      if (showSuccessToast) {
        showToast(`✓ Cloudinary Connection Verified: Live & Connected (${cloudName})`, 'success');
      }
    } else {
      if (connBadge) {
        connBadge.className = 'pill-badge purple';
        connBadge.innerHTML = '● Disconnected';
      }
      if (cloudStatusTag) {
        cloudStatusTag.className = 'not-connected-tag';
        cloudStatusTag.textContent = '● Disconnected';
      }
      if (showSuccessToast) {
        showToast('Cloudinary credentials not configured in backend .env', 'error');
      }
    }
  } catch (err) {
    console.warn('[Health Check Notice]:', err.message);
    if (showSuccessToast) {
      showToast('Could not reach backend health check endpoint.', 'error');
    }
  }
}

function initSettings() {
  const toggles = document.querySelectorAll('.settings-card input[type="checkbox"]');
  toggles.forEach(toggle => {
    toggle.addEventListener('change', () => {
      showToast('✓ Preferences saved successfully!');
    });
  });

  const testBtn = document.getElementById('btn-test-connection');
  if (testBtn) {
    testBtn.addEventListener('click', () => {
      checkCloudinaryBackendHealth(true);
    });
  }

  checkCloudinaryBackendHealth(false);
}

// ==========================================================================
// 8. IMAGE LIGHTBOX & HIGH-RES ASSET DOWNLOAD SYSTEM
// ==========================================================================
let currentLightboxUrl = '';
let currentLightboxFilename = 'cloudinary_asset.jpg';

function initLightboxListeners() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      window.closeLightbox();
      if (typeof window.closeAssetModal === 'function') window.closeAssetModal();
    }
  });

  const copyBtn = document.getElementById('lightbox-copy-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      if (currentLightboxUrl) {
        navigator.clipboard.writeText(currentLightboxUrl).then(() => {
          showToast('✓ Signed Asset URL copied to clipboard!');
        }).catch(() => {
          showToast('Asset URL copied.', 'info');
        });
      }
    });
  }

  const downloadBtn = document.getElementById('lightbox-download-btn');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', () => {
      if (currentLightboxUrl) {
        window.triggerDownload(currentLightboxUrl, currentLightboxFilename);
      }
    });
  }
}

window.openLightbox = function(url, title = 'Asset Preview', subtitle = 'Cloudinary Signed Media') {
  if (!url) {
    showToast('No asset image available for preview.', 'info');
    return;
  }

  currentLightboxUrl = url;
  
  const baseName = (state.uploadedAsset && (state.uploadedAsset.originalName || state.uploadedAsset.title))
    ? (state.uploadedAsset.originalName || state.uploadedAsset.title).replace(/\.[^/.]+$/, "")
    : 'cloudinary_asset';
  const cleanTitle = title.toLowerCase().replace(/[^a-z0-9]/g, '_');
  currentLightboxFilename = `${baseName}_${cleanTitle}.jpg`;

  const modal = document.getElementById('lightbox-modal-backdrop');
  const imgEl = document.getElementById('lightbox-img');
  const titleEl = document.getElementById('lightbox-title');
  const badgeEl = document.getElementById('lightbox-badge');

  if (titleEl) titleEl.textContent = title;
  if (badgeEl) badgeEl.textContent = subtitle;
  if (imgEl) {
    imgEl.src = url;
    imgEl.alt = title;
  }

  if (modal) {
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
};

window.openLightboxFromId = function(imgElementId, title = 'Asset Preview', subtitle = 'Cloudinary Signed Media') {
  const img = document.getElementById(imgElementId);
  const url = (img && (img.dataset.cropUrl || img.src)) ? (img.dataset.cropUrl || img.src) : '';
  if (!url) {
    showToast('Image is still processing or loading.', 'info');
    return;
  }
  window.openLightbox(url, title, subtitle);
};

window.closeLightbox = function() {
  const modal = document.getElementById('lightbox-modal-backdrop');
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }
};

window.triggerDownload = async function(url, filename = 'cloudinary_asset.jpg') {
  if (!url) {
    showToast('No active asset available to download.', 'error');
    return;
  }

  showToast('Downloading image...', 'info');

  try {
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) throw new Error('Network response was not ok');
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);

    showToast(`✓ Downloaded ${filename}!`, 'success');
  } catch (err) {
    console.warn('[Download direct fallback]:', err);
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast(`✓ Downloading ${filename}...`, 'success');
  }
};

window.downloadFromImgId = function(imgElementId, filename) {
  const img = document.getElementById(imgElementId);
  const url = (img && (img.dataset.cropUrl || img.src)) ? (img.dataset.cropUrl || img.src) : '';
  if (!url) {
    showToast('Image is not ready to download yet.', 'info');
    return;
  }
  const actualFilename = filename || 'cloudinary_media.jpg';
  window.triggerDownload(url, actualFilename);
};

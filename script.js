/**
 * Imran Khan Portfolio — Interactive Canvas & UI Engine
 * Features:
 * - Chunked / Async 240-Frame Preload Engine (instant first 5 frames, streaming batches of 15 via requestIdleCallback)
 * - High-DPI Canvas Rendering Engine with aspect-ratio cover-fit centered algorithm
 * - Passive RAF-throttled scroll driving 60fps synchronization across mobile and desktop
 * - Dead-center portal lock on mobile viewports with no transform overrides
 * - 3D card tilt & parallax micro-interactions
 * - Interactive modals (Work Showcase, Let's Connect)
 * - Dynamic scroll progress synchronization
 */

(function () {
  'use strict';

  // --- Configuration ---
  const TOTAL_FRAMES = 240;
  const FRAME_DIR = './frames';
  const LERP_FACTOR = 0.20; // Silky smooth 60/120fps responsive physics glide

  // --- DOM Elements ---
  const canvas = document.getElementById('animation-canvas');
  const ctx = canvas ? canvas.getContext('2d', { alpha: false }) : null;
  const loader = document.getElementById('loader');
  const loaderBar = document.getElementById('loader-progress-bar');
  const loaderPercent = document.getElementById('loader-percent');
  const loaderCount = document.getElementById('loader-count');
  const progressLine = document.getElementById('progress-line');
  const bottomScrubBar = document.getElementById('bottom-scrub-bar');
  const experienceOrbit = document.querySelector('.experience-orbit');

  // Navigation & Views
  const btnDownloadResume = document.getElementById('btn-download-resume');
  const menuToggle = document.getElementById('menu-toggle');
  const mobileDrawer = document.getElementById('mobile-drawer');
  const drawerClose = document.getElementById('drawer-close');
  const navLinks = document.querySelectorAll('.nav-link');
  const mobileLinks = document.querySelectorAll('.mobile-link');
  const tiltBadges = document.querySelectorAll('[data-tilt]');
  const experienceFilters = document.querySelectorAll('[data-experience-filter]');
  const experienceCards = document.querySelectorAll('[data-experience-category]');
  const archiveToggle = document.getElementById('archive-toggle');
  const archivePanel = document.getElementById('archive-panel');
  const viewClose = document.getElementById('view-close');
  const viewTriggers = document.querySelectorAll('[data-view-target]');
  const viewPanels = document.querySelectorAll('[data-view-panel]');
  const stageOnlyElements = document.querySelectorAll('[data-stage-only]');
  const portfolioContainer = document.querySelector('.portfolio-container');
  const contactForm = document.getElementById('contact-form');

  // --- State Variables ---
  const images = new Array(TOTAL_FRAMES);
  const frameStatus = new Int8Array(TOTAL_FRAMES); // 0 = unrequested, 1 = in-flight, 2 = loaded, -1 = error
  const MAX_CONCURRENT = 6;
  let activeDownloads = 0;
  const loadQueue = [];

  let loadedCount = 0;
  let isReady = false;
  let currentFrame = 0;
  let targetFrame = 0;
  let lastDrawnFrame = -1;
  let rafId = null;
  let activeView = null;
  let returnFocus = null;
  let scrollTicking = false;
  let cachedMaxScroll = 0;

  // Format frame URL with zero-padding (e.g. frames/frame_0001.jpg)
  function getFrameUrl(index) {
    const padded = String(index + 1).padStart(4, '0');
    return `${FRAME_DIR}/frame_${padded}.jpg`;
  }

  // --- 1. JIT Continuous Frame Streaming Pipeline (Zero Stalls on Scroll) ---
  function requestFrameLoad(index, highPriority = false) {
    if (index < 0 || index >= TOTAL_FRAMES) return;
    if (frameStatus[index] !== 0) return;

    if (highPriority) {
      loadQueue.unshift(index);
    } else {
      loadQueue.push(index);
    }
    processQueue();
  }

  function prioritizeAround(targetIdx) {
    const radius = 12;
    for (let r = 0; r <= radius; r++) {
      const forward = targetIdx + r;
      const backward = targetIdx - r;
      if (forward < TOTAL_FRAMES && frameStatus[forward] === 0) {
        requestFrameLoad(forward, true);
      }
      if (backward >= 0 && frameStatus[backward] === 0) {
        requestFrameLoad(backward, true);
      }
    }
  }

  function processQueue() {
    while (activeDownloads < MAX_CONCURRENT && loadQueue.length > 0) {
      const idx = loadQueue.shift();
      if (frameStatus[idx] !== 0) continue;

      frameStatus[idx] = 1;
      activeDownloads++;

      const img = new Image();
      img.src = getFrameUrl(idx);

      const onDone = () => {
        images[idx] = img;
        frameStatus[idx] = 2;
        loadedCount++;
        activeDownloads--;

        if (loader && !loader.classList.contains('loaded')) {
          updateLoaderProgress();
        }

        if (idx === 0 && lastDrawnFrame === -1) {
          resizeCanvas();
          drawFrame(0);
        }

        const currentRound = Math.round(currentFrame);
        if (Math.abs(currentRound - idx) <= 2) {
          requestRender();
        }

        setTimeout(processQueue, 0);
      };

      if ('decode' in img) {
        img.decode().then(onDone).catch(onDone);
      } else {
        img.onload = onDone;
        img.onerror = () => {
          frameStatus[idx] = -1;
          activeDownloads--;
          setTimeout(processQueue, 0);
        };
      }
    }
  }

  function updateLoaderProgress() {
    const percent = Math.min(100, Math.floor((loadedCount / 16) * 100));
    if (loaderBar) loaderBar.style.width = `${percent}%`;
    if (loaderPercent) loaderPercent.textContent = `${percent}%`;
    if (loaderCount) loaderCount.textContent = `${loadedCount} / ${TOTAL_FRAMES}`;
  }

  function dismissLoader() {
    if (loader && !loader.classList.contains('loaded')) {
      loader.classList.add('loaded');
      setTimeout(() => {
        if (loader) loader.style.display = 'none';
      }, 350);
    }
  }

  function preloadImages() {
    // Stage 1: Load initial fast buffer (frames 0 to 15) with high priority
    for (let i = 0; i < 16; i++) {
      requestFrameLoad(i, true);
    }

    // Stage 2: Queue keyframes across entire sequence (every 4th frame)
    for (let i = 16; i < TOTAL_FRAMES; i += 4) {
      requestFrameLoad(i, false);
    }

    // Stage 3: Queue all remaining intermediate frames
    for (let i = 16; i < TOTAL_FRAMES; i++) {
      if (i % 4 !== 0) {
        requestFrameLoad(i, false);
      }
    }

    // Reveal stage quickly once initial buffer is ready
    const checkInitialBuffer = () => {
      if (images[0] && loadedCount >= 4) {
        dismissLoader();
        requestRender();
      } else {
        setTimeout(checkInitialBuffer, 30);
      }
    };
    checkInitialBuffer();
  }

  // Radiate outward from targetIdx: ±1, ±2, ±3... to find the closest loaded frame instantly
  function findClosestLoadedFrame(targetIdx) {
    if (images[targetIdx] && images[targetIdx].complete && images[targetIdx].naturalWidth > 0) {
      return images[targetIdx];
    }
    for (let offset = 1; offset < TOTAL_FRAMES; offset++) {
      const forward = targetIdx + offset;
      const backward = targetIdx - offset;
      if (forward < TOTAL_FRAMES && images[forward] && images[forward].complete && images[forward].naturalWidth > 0) {
        return images[forward];
      }
      if (backward >= 0 && images[backward] && images[backward].complete && images[backward].naturalWidth > 0) {
        return images[backward];
      }
    }
    return images[0] || null;
  }

  // --- 2. Mobile Hero Layout Lock Engine ---
  function applyMobileHeroLock() {
    const isMobile = window.innerWidth <= 768;
    const canvasEl = document.getElementById('animation-canvas');
    const visualEl = document.querySelector('.hero-right-visual');
    const haloEl = document.querySelector('.halo-portal-container');
    const orbitEl = document.querySelector('.experience-orbit');

    if (isMobile) {
      if (canvasEl) {
        canvasEl.style.setProperty('position', 'absolute', 'important');
        canvasEl.style.setProperty('top', '50%', 'important');
        canvasEl.style.setProperty('left', '50%', 'important');
        canvasEl.style.setProperty('transform', 'translate(-50%, -50%)', 'important');
        canvasEl.style.setProperty('margin', '0px', 'important');
        canvasEl.style.setProperty('width', '190px', 'important');
        canvasEl.style.setProperty('height', '190px', 'important');
        canvasEl.style.setProperty('aspect-ratio', '1 / 1', 'important');
        canvasEl.style.setProperty('border-radius', '50%', 'important');
        canvasEl.style.setProperty('object-fit', 'cover', 'important');
        canvasEl.style.setProperty('clip-path', 'none', 'important');
        canvasEl.style.setProperty('border', 'none', 'important');
        canvasEl.style.setProperty('box-shadow', 'none', 'important');
        canvasEl.style.setProperty('z-index', '2', 'important');
        canvasEl.style.setProperty('display', 'block', 'important');
      }
      if (visualEl) {
        visualEl.style.setProperty('order', '1', 'important');
        visualEl.style.setProperty('position', 'relative', 'important');
        visualEl.style.setProperty('width', '290px', 'important');
        visualEl.style.setProperty('height', '290px', 'important');
        visualEl.style.setProperty('aspect-ratio', '1 / 1', 'important');
        visualEl.style.setProperty('margin', '0 auto', 'important');
        visualEl.style.setProperty('display', 'block', 'important');
        visualEl.style.setProperty('overflow', 'visible', 'important');
        visualEl.style.setProperty('z-index', '2', 'important');
        visualEl.style.setProperty('pointer-events', 'auto', 'important');
        visualEl.style.setProperty('touch-action', 'none', 'important');
      }
      if (haloEl) {
        haloEl.style.setProperty('position', 'absolute', 'important');
        haloEl.style.setProperty('top', '50%', 'important');
        haloEl.style.setProperty('left', '50%', 'important');
        haloEl.style.setProperty('transform', 'translate(-50%, -50%)', 'important');
        haloEl.style.setProperty('width', '230px', 'important');
        haloEl.style.setProperty('height', '230px', 'important');
        haloEl.style.setProperty('aspect-ratio', '1 / 1', 'important');
        haloEl.style.setProperty('border-radius', '50%', 'important');
        haloEl.style.setProperty('pointer-events', 'none', 'important');
        haloEl.style.setProperty('z-index', '3', 'important');
        haloEl.style.setProperty('margin', '0 auto', 'important');
      }
      if (orbitEl) {
        orbitEl.style.setProperty('position', 'absolute', 'important');
        orbitEl.style.setProperty('top', '50%', 'important');
        orbitEl.style.setProperty('left', '50%', 'important');
        orbitEl.style.setProperty('width', '290px', 'important');
        orbitEl.style.setProperty('height', '290px', 'important');
        orbitEl.style.setProperty('aspect-ratio', '1 / 1', 'important');
        orbitEl.style.setProperty('border-radius', '50%', 'important');
        orbitEl.style.setProperty('z-index', '4', 'important');
        orbitEl.style.setProperty('pointer-events', 'none', 'important');
      }
    }
  }

  // --- 2. High-Performance Canvas Rendering Engine ---
  function resizeCanvas() {
    if (!canvas || !ctx) return;
    applyMobileHeroLock();
    const isMobile = window.innerWidth <= 768;

    let displayWidth, displayHeight;
    // Deliver crisp high-DPI (up to 2x / 4K) clarity
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (isMobile) {
      displayWidth = 190;
      displayHeight = 190;
    } else {
      displayWidth = window.innerWidth;
      displayHeight = window.innerHeight;
    }

    const targetW = Math.round(displayWidth * dpr);
    const targetH = Math.round(displayHeight * dpr);

    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
      lastDrawnFrame = -1;
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    updateMaxScroll();

    const frameIdx = Math.round(currentFrame);
    if (images[frameIdx] || findClosestLoadedFrame(frameIdx)) {
      drawFrame(frameIdx);
    }
  }

  function drawFrame(frameIndex) {
    if (!canvas || !ctx) return;
    const clampedIndex = Math.max(0, Math.min(TOTAL_FRAMES - 1, frameIndex));
    const img = findClosestLoadedFrame(clampedIndex);

    if (!img) return;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const cw = canvas.width;
    const ch = canvas.height;
    const iw = img.naturalWidth || 1280;
    const ih = img.naturalHeight || 720;

    const isMobile = window.innerWidth <= 768;

    if (isMobile || Math.abs(cw - ch) < 15) {
      // Mobile 1:1 circle portal: dead-center the animated face & portrait inside the circular frame
      // Subject head center coordinates in 1280x720 video:
      // focusX = iw * 0.495 (approx 634px)
      // focusY = ih * 0.375 (approx 270px)
      const focusX = iw * 0.495;
      const focusY = ih * 0.375;
      // Crop a square region of 68% of image height around the head
      const cropSize = ih * 0.68;
      let sx = focusX - cropSize / 2;
      let sy = focusY - cropSize / 2;
      const sw = cropSize;
      const sh = cropSize;

      sx = Math.max(0, Math.min(iw - sw, sx));
      sy = Math.max(0, Math.min(ih - sh, sy));

      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);
    } else {
      // Desktop widescreen / full-screen mode: aspect-ratio cover-fitting
      const scale = Math.max(cw / iw, ch / ih);
      const nw = iw * scale;
      const nh = ih * scale;
      const ox = (cw - nw) / 2;
      const oy = (ch - nh) / 2;

      ctx.drawImage(img, ox, oy, nw, nh);
    }

    lastDrawnFrame = clampedIndex;
    updateScrollBars(clampedIndex);
  }

  function updateScrollBars(frameIndex) {
    const progress = frameIndex / (TOTAL_FRAMES - 1);
    const progressPercent = `${(progress * 100).toFixed(1)}%`;

    if (progressLine) progressLine.style.width = progressPercent;
    if (bottomScrubBar) bottomScrubBar.style.width = progressPercent;
    if (experienceOrbit) experienceOrbit.style.setProperty('--orbit-angle', `${(progress * 360).toFixed(1)}deg`);
  }

  function updateActiveNavLink(activeSection = null) {
    [...navLinks, ...mobileLinks].forEach(link => {
      const isTarget = link.getAttribute('data-section') === activeSection;
      link.classList.toggle('active', isTarget);
      const dot = link.querySelector('.active-dot');
      if (isTarget && !dot && link.classList.contains('nav-link')) {
        const newDot = document.createElement('span');
        newDot.className = 'active-dot';
        link.appendChild(newDot);
      } else if (!isTarget && dot) {
        dot.remove();
      }
    });
  }

  // --- 3. Ultra-Smooth On-Demand RAF Animation & Scroll Scrubbing ---
  function scrubFrames(delta) {
    const newTarget = Math.max(0, Math.min(TOTAL_FRAMES - 1, targetFrame + delta));
    if (Math.abs(newTarget - targetFrame) > 0.01) {
      targetFrame = newTarget;
      prioritizeAround(Math.round(targetFrame));
      requestRender();
    }
  }

  function render() {
    const delta = targetFrame - currentFrame;
    if (Math.abs(delta) > 0.01) {
      currentFrame += delta * LERP_FACTOR;
      const frameToDraw = Math.round(currentFrame);
      if (frameToDraw !== lastDrawnFrame) {
        drawFrame(frameToDraw);
      }
      rafId = requestAnimationFrame(render);
    } else {
      currentFrame = targetFrame;
      const frameToDraw = Math.round(currentFrame);
      if (frameToDraw !== lastDrawnFrame) {
        drawFrame(frameToDraw);
      }
      rafId = null; // Idle: 0% CPU consumption
    }
  }

  function requestRender() {
    if (!rafId) {
      rafId = requestAnimationFrame(render);
    }
  }

  function updateMaxScroll() {
    const docEl = document.documentElement;
    cachedMaxScroll = Math.max(1, (docEl.scrollHeight || document.body.scrollHeight || 1) - window.innerHeight);
  }

  // Zero-Reflow Throttled Scroll Listener
  function handleScroll() {
    if (scrollTicking) return;
    scrollTicking = true;

    requestAnimationFrame(() => {
      const isMobile = window.innerWidth <= 768;
      if (isMobile) {
        if (cachedMaxScroll <= 0) updateMaxScroll();
        const scrollFraction = Math.min(1, Math.max(0, window.scrollY / cachedMaxScroll));
        const newTarget = Math.min(TOTAL_FRAMES - 1, Math.floor(scrollFraction * TOTAL_FRAMES));
        if (Math.abs(newTarget - targetFrame) > 0.01) {
          targetFrame = newTarget;
          prioritizeAround(Math.round(targetFrame));
          requestRender();
        }
      }
      scrollTicking = false;
    });
  }

  window.addEventListener('scroll', handleScroll, { passive: true });

  // Desktop Mouse Wheel Listener: Normalized for trackpads & stepped mouse wheels
  window.addEventListener('wheel', event => {
    if (activeView) return;
    const isMobile = window.innerWidth <= 768;
    if (!isMobile) {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
      const rawDelta = event.deltaY * unit;
      // Precision normalization: stepped notched mice jump ~100px, trackpads produce ~2-15px
      const scaledDelta = Math.abs(rawDelta) >= 50 ? rawDelta * 0.045 : rawDelta * 0.07;
      scrubFrames(scaledDelta);
    }
  }, { passive: false });

  // Touch Interactions: Direct 120Hz/60Hz Tactile Scrubbing on Mobile
  let lastTouchX = null;
  let lastTouchY = null;
  let isCanvasTouch = false;

  window.addEventListener('touchstart', event => {
    if (activeView || !event.touches.length) return;
    lastTouchX = event.touches[0].clientX;
    lastTouchY = event.touches[0].clientY;

    const target = event.target;
    const canvasEl = document.getElementById('animation-canvas');
    const visualEl = document.querySelector('.hero-right-visual');
    isCanvasTouch = Boolean(
      (canvasEl && canvasEl.contains(target)) ||
      (visualEl && visualEl.contains(target)) ||
      target.closest('.hero-right-visual') ||
      target.closest('#animation-canvas')
    );
  }, { passive: true });

  window.addEventListener('touchmove', event => {
    if (activeView || lastTouchY === null || !event.touches.length) return;
    const currentX = event.touches[0].clientX;
    const currentY = event.touches[0].clientY;
    const deltaY = lastTouchY - currentY;
    const deltaX = lastTouchX - currentX;

    if (isCanvasTouch) {
      // Direct thumb interaction on the portrait: fluid 3D spin with zero scroll collision
      if (event.cancelable) event.preventDefault();
      scrubFrames(deltaY * 0.42 + deltaX * 0.3);
      lastTouchX = currentX;
      lastTouchY = currentY;
      return;
    }

    const isMobile = window.innerWidth <= 768;
    if (!isMobile) {
      if (event.cancelable) event.preventDefault();
      scrubFrames(deltaY * 0.25);
    } else {
      // On mobile background: smooth scrubbing with natural vertical glide
      scrubFrames(deltaY * 0.24);
    }

    lastTouchX = currentX;
    lastTouchY = currentY;
  }, { passive: false });

  window.addEventListener('touchend', () => {
    lastTouchX = null;
    lastTouchY = null;
    isCanvasTouch = false;
  }, { passive: true });

  window.addEventListener('touchcancel', () => {
    lastTouchX = null;
    lastTouchY = null;
    isCanvasTouch = false;
  }, { passive: true });

  window.addEventListener('resize', () => {
    resizeCanvas();
  }, { passive: true });

  // --- UI Views & Interactions ---
  function setExperienceFilter(filter) {
    experienceFilters.forEach(button => {
      const selected = button.dataset.experienceFilter === filter;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });

    experienceCards.forEach(card => {
      card.hidden = filter !== 'all' && card.dataset.experienceCategory !== filter;
    });
  }

  experienceFilters.forEach(button => {
    button.addEventListener('click', () => setExperienceFilter(button.dataset.experienceFilter));
  });

  if (archiveToggle && archivePanel) {
    archiveToggle.addEventListener('click', () => {
      const expanded = archiveToggle.getAttribute('aria-expanded') === 'true';
      archiveToggle.setAttribute('aria-expanded', String(!expanded));
      archivePanel.hidden = expanded;
    });
  }

  function openView(viewId, trigger) {
    const panel = [...viewPanels].find(view => view.id === viewId);
    if (!panel || activeView) return;

    returnFocus = trigger || document.activeElement;
    activeView = panel;
    panel.hidden = false;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-hidden', 'false');
    panel.setAttribute('tabindex', '-1');
    panel.scrollTop = 0;

    document.documentElement.classList.add('view-open');
    document.body.classList.add('view-open');
    document.documentElement.classList.remove('stage-locked');
    document.body.classList.remove('stage-locked');
    document.body.style.position = 'fixed';
    document.body.style.top = '0';
    document.body.style.width = '100%';
    stageOnlyElements.forEach(element => { element.inert = true; });
    if (mobileDrawer) mobileDrawer.classList.remove('open');
    if (menuToggle) menuToggle.setAttribute('aria-expanded', 'false');

    if (viewClose) {
      panel.appendChild(viewClose);
      viewClose.hidden = false;
      viewClose.focus({ preventScroll: true });
    }
    updateActiveNavLink(viewId);
    void panel.offsetWidth;
    panel.classList.add('is-open');
  }

  function closeView() {
    if (!activeView) return;

    const panel = activeView;
    let finished = false;
    activeView = null;
    panel.classList.remove('is-open');
    panel.setAttribute('aria-hidden', 'true');
    updateActiveNavLink();

    const finishClose = () => {
      if (finished) return;
      finished = true;
      panel.hidden = true;
      document.documentElement.classList.remove('view-open');
      document.body.classList.remove('view-open');
      document.body.style.removeProperty('position');
      document.body.style.removeProperty('top');
      document.body.style.removeProperty('width');
      stageOnlyElements.forEach(element => { element.inert = false; });
      if (portfolioContainer && viewClose) {
        portfolioContainer.appendChild(viewClose);
        viewClose.hidden = true;
      }
      document.documentElement.classList.add('stage-locked');
      document.body.classList.add('stage-locked');
      updateMaxScroll();

      const focusTarget = returnFocus && !returnFocus.closest('.mobile-nav-drawer') ? returnFocus : menuToggle;
      returnFocus = null;
      if (focusTarget && focusTarget.isConnected) focusTarget.focus({ preventScroll: true });
    };

    panel.addEventListener('transitionend', event => {
      if (event.target === panel && event.propertyName === 'opacity') finishClose();
    });
    setTimeout(finishClose, 360);
  }

  function showResumeToast() {
    const toast = document.createElement('div');
    toast.className = 'resume-toast';
    toast.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#ff6a3d" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="7 10 12 15 17 10"></polyline>
          <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
        <span>Downloading Imran Khan's Resume...</span>
      </div>
    `;
    toast.style.cssText = `
      position: fixed;
      bottom: 30px;
      left: 50%;
      transform: translateX(-50%) translateY(20px);
      background: rgba(22, 17, 15, 0.95);
      border: 1px solid rgba(255, 106, 61, 0.4);
      box-shadow: 0 10px 30px rgba(0,0,0,0.6), 0 0 20px rgba(255,87,34,0.3);
      color: #ffffff;
      padding: 14px 24px;
      border-radius: 9999px;
      font-size: 0.85rem;
      font-weight: 600;
      z-index: 600;
      opacity: 0;
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    `;
    document.body.appendChild(toast);
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(-50%) translateY(0)';
    });
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(10px)';
      setTimeout(() => toast.remove(), 400);
    }, 3000);
  }

  // --- 3D Floating Badge Tilt Effect ---
  function initTiltEffects() {
    tiltBadges.forEach(badge => {
      badge.addEventListener('mousemove', (e) => {
        const isMobile = window.innerWidth <= 768;
        if (isMobile) return;
        const rect = badge.getBoundingClientRect();
        const x = e.clientX - rect.left - rect.width / 2;
        const y = e.clientY - rect.top - rect.height / 2;
        badge.style.transform = `perspective(500px) rotateX(${-y * 0.1}deg) rotateY(${x * 0.1}deg) scale(1.04)`;
      });

      badge.addEventListener('mouseleave', () => {
        const isMobile = window.innerWidth <= 768;
        if (isMobile) return;
        badge.style.transform = '';
      });
    });
  }

  // Resume action
  if (btnDownloadResume) btnDownloadResume.addEventListener('click', showResumeToast);

  viewTriggers.forEach(trigger => {
    trigger.addEventListener('click', event => {
      event.preventDefault();
      openView(trigger.dataset.viewTarget, trigger);
    });
  });

  if (viewClose) viewClose.addEventListener('click', closeView);
  document.querySelectorAll('[data-close-view]').forEach(trigger => {
    trigger.addEventListener('click', event => {
      event.preventDefault();
      closeView();
    });
  });

  if (contactForm) {
    contactForm.addEventListener('submit', event => {
      event.preventDefault();
      const fields = new FormData(contactForm);
      const name = fields.get('name').toString().trim();
      const email = fields.get('email').toString().trim();
      const message = fields.get('message').toString().trim();
      const subject = encodeURIComponent(`Portfolio inquiry from ${name}`);
      const body = encodeURIComponent(`${message}\n\nFrom: ${name}\nEmail: ${email}`);
      window.location.href = `mailto:s.engrimrantareen@gmail.com?subject=${subject}&body=${body}`;
    });
  }

  // Mobile drawer
  if (menuToggle && mobileDrawer) {
    menuToggle.addEventListener('click', () => {
      mobileDrawer.classList.toggle('open');
      menuToggle.setAttribute('aria-expanded', String(mobileDrawer.classList.contains('open')));
    });
  }
  if (drawerClose && mobileDrawer && menuToggle) {
    drawerClose.addEventListener('click', () => {
      mobileDrawer.classList.remove('open');
      menuToggle.setAttribute('aria-expanded', 'false');
    });
  }

  // Keyboard accessibility
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeView();
      if (mobileDrawer) mobileDrawer.classList.remove('open');
      if (menuToggle) menuToggle.setAttribute('aria-expanded', 'false');
    } else if (e.key === 'Tab' && activeView) {
      const focusable = [...activeView.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) {
        e.preventDefault();
        if (viewClose) viewClose.focus();
      } else if (e.shiftKey && document.activeElement === focusable[0]) {
        e.preventDefault();
        focusable[focusable.length - 1].focus();
      } else if (!e.shiftKey && document.activeElement === focusable[focusable.length - 1]) {
        e.preventDefault();
        focusable[0].focus();
      }
    }
  });

  // --- Initialize ---
  window.addEventListener('DOMContentLoaded', () => {
    applyMobileHeroLock();
    resizeCanvas();
    preloadImages();
    initTiltEffects();
  });

  window.addEventListener('load', () => {
    applyMobileHeroLock();
    resizeCanvas();
    updateMaxScroll();
  });

  window.addEventListener('orientationchange', () => {
    applyMobileHeroLock();
    resizeCanvas();
    updateMaxScroll();
  });

})();

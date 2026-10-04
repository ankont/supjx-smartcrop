/**
 * SuperSoftJx SmartCrop - Editor Controller
 * Version 1.0.0-beta1
 *
 * Implements universal, non-destructive image framing inside a flexible modal overlay:
 * - Universal integration into native Joomla <joomla-field-media> (.input-group adjacent button)
 * - Directly encodes and parses crop & zoom parameters in #joomlaImage:// query strings
 * - Works on Articles (intro/fulltext), Categories, and Custom Fields of type media (com_fields)
 * - Standalone modal support (works seamlessly with OR without Bootstrap 5 JS)
 * - Fixed aspect ratio viewport (4:3) with customizable preview width
 * - Smooth drag/pan and zoom controls (100% to 300%)
 * - Empty background strictly prevented (100% viewport coverage guaranteed)
 * - Backward compatible with existing article JSON metadata storage
 */

class SmartCropModalController {
    constructor(modalElement) {
        this.modalEl = modalElement;
        this.profile = this.modalEl.dataset.profile || 'intro';
        this.targetFieldName = this.modalEl.dataset.targetField || 'image_intro';
        this.ratioW = parseFloat(this.modalEl.dataset.ratioW) || 4;
        this.ratioH = parseFloat(this.modalEl.dataset.ratioH) || 3;
        this.targetRatio = this.ratioW / this.ratioH;
        this.siteRoot = this.modalEl.dataset.siteRoot || '';
        this.basePath = this.modalEl.dataset.basePath || '';

        // Dynamic active field references
        this.currentInput = null;
        this.currentMediaWrapper = null;
        this.currentCropBtn = null;

        // Legacy parent widget elements (if present on page)
        this.widgetEl = document.querySelector(`[data-smartcrop-widget][data-profile="${this.profile}"]`);
        this.openBtn = this.widgetEl ? this.widgetEl.querySelector('.smartcrop-open-modal-btn, [data-smartcrop-open-modal-btn]') : null;
        this.input = this.widgetEl ? this.widgetEl.querySelector('[data-smartcrop-input]') : null;
        this.badge = this.widgetEl ? this.widgetEl.querySelector('[data-smartcrop-badge]') : null;
        this.clearBtn = this.widgetEl ? this.widgetEl.querySelector('[data-smartcrop-clear-btn]') : null;

        // Modal internal elements
        this.viewport = this.modalEl.querySelector('[data-smartcrop-viewport]');
        this.img = this.modalEl.querySelector('[data-smartcrop-image]');
        this.slider = this.modalEl.querySelector('[data-smartcrop-zoom-slider]');
        this.zoomValueLabel = this.modalEl.querySelector('[data-smartcrop-zoom-value]');
        this.btnZoomIn = this.modalEl.querySelector('[data-smartcrop-zoom-in]');
        this.btnZoomOut = this.modalEl.querySelector('[data-smartcrop-zoom-out]');
        this.presetBtns = this.modalEl.querySelectorAll('[data-smartcrop-zoom-preset]');
        this.btnReset = this.modalEl.querySelector('[data-smartcrop-reset]');
        this.btnApply = this.modalEl.querySelector('[data-smartcrop-apply-btn]');
        this.btnRemove = this.modalEl.querySelector('[data-smartcrop-remove-btn]');
        this.btnSelectMedia = this.modalEl.querySelector('[data-smartcrop-select-media]');
        this.emptyState = this.modalEl.querySelector('[data-smartcrop-empty-state]');
        this.toolbar = this.modalEl.querySelector('[data-smartcrop-toolbar]');
        this.panHint = this.modalEl.querySelector('[data-smartcrop-pan-hint]');
        this.liveCoordsEl = this.modalEl.querySelector('[data-smartcrop-live-coords]');

        // Stored framing profile if present
        this.storedProfile = null;
        try {
            if (this.modalEl.dataset.storedProfile) {
                this.storedProfile = JSON.parse(this.modalEl.dataset.storedProfile);
            }
        } catch (e) {
            this.storedProfile = null;
        }

        // Active image state
        this.activeSource = this.modalEl.dataset.activeSource || '';
        this.activeUrl = this.modalEl.dataset.activeUrl || '';

        // Framing state
        this.posX = 0;
        this.posY = 0;
        this.zoom = 1.0;
        this.minScale = 1.0;
        this.currentScale = 1.0;
        this.isLoaded = false;
        this.isDragging = false;
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.dragInitialX = 0;
        this.dragInitialY = 0;
        this._triedFallback = false;

        this.init();
    }

    init() {
        this.bindEvents();
        this.bindTargetFieldListeners();
    }

    bindEvents() {
        // Direct click on Open Modal button (legacy widget support)
        if (this.openBtn) {
            this.openBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.openModal();
            });
        }

        // Cancel / Dismiss buttons
        this.modalEl.querySelectorAll('[data-bs-dismiss="modal"], .btn-close, [data-smartcrop-cancel]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                this.closeModal();
            });
        });

        // Click on background overlay outside modal dialog closes modal
        this.modalEl.addEventListener('click', (e) => {
            if (e.target === this.modalEl) {
                this.closeModal();
            }
        });

        // Escape key closes modal
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen()) {
                this.closeModal();
            }
        });

        // Fallback for Bootstrap events if Bootstrap JS is active
        this.modalEl.addEventListener('shown.bs.modal', () => {
            this.onModalOpened();
        });
        this.modalEl.addEventListener('hidden.bs.modal', () => {
            this.closeModal();
        });

        // Pointer dragging
        if (this.viewport) {
            this.viewport.addEventListener('pointerdown', (e) => this.onPointerDown(e));
            window.addEventListener('pointermove', (e) => this.onPointerMove(e));
            window.addEventListener('pointerup', (e) => this.onPointerUp(e));
            window.addEventListener('pointercancel', (e) => this.onPointerUp(e));
            this.viewport.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
        }

        // Zoom Slider & buttons
        if (this.slider) {
            this.slider.addEventListener('input', (e) => {
                this.setZoom(parseFloat(e.target.value));
            });
        }

        if (this.btnZoomIn) {
            this.btnZoomIn.addEventListener('click', (e) => {
                e.preventDefault();
                this.setZoom(Math.min(3.0, this.zoom + 0.15));
            });
        }

        if (this.btnZoomOut) {
            this.btnZoomOut.addEventListener('click', (e) => {
                e.preventDefault();
                this.setZoom(Math.max(1.0, this.zoom - 0.15));
            });
        }

        if (this.presetBtns) {
            this.presetBtns.forEach((btn) => {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    const targetZoom = parseFloat(btn.dataset.smartcropZoomPreset) || 1.0;
                    this.setZoom(targetZoom);
                });
            });
        }

        if (this.btnReset) {
            this.btnReset.addEventListener('click', (e) => {
                e.preventDefault();
                this.resetFraming();
            });
        }

        if (this.btnApply) {
            this.btnApply.addEventListener('click', (e) => {
                e.preventDefault();
                this.applyFramingToField();
            });
        }

        if (this.btnRemove) {
            this.btnRemove.addEventListener('click', (e) => {
                e.preventDefault();
                this.clearCrop();
            });
        }

        if (this.btnSelectMedia) {
            this.btnSelectMedia.addEventListener('click', (e) => {
                e.preventDefault();
                this.openMediaPicker();
            });
        }

        // Clear button on legacy widget
        if (this.clearBtn) {
            this.clearBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.clearCrop();
            });
        }
    }

    attachToMediaField(input, mediaWrapper, cropBtn, profileName) {
        this.currentInput = input;
        this.currentMediaWrapper = mediaWrapper || input?.closest('joomla-field-media') || input?.closest('.field-media-wrapper');
        this.currentCropBtn = cropBtn;
        this.profile = profileName || this.profile || 'intro';
        this.targetFieldName = input?.name || input?.id || this.targetFieldName;
        this.widgetEl = document.querySelector(`[data-smartcrop-widget][data-profile="${this.profile}"]`);

        // Check if input has crop in its URL or stored value
        const val = input ? input.value.trim() : '';
        const parsed = this.extractCropFromValue(val);
        if (parsed) {
            this.storedProfile = parsed;
        } else if (this.widgetEl) {
            const hidden = this.widgetEl.querySelector('[data-smartcrop-input]');
            if (hidden && hidden.value) {
                try {
                    this.storedProfile = JSON.parse(hidden.value);
                } catch (e) {
                    this.storedProfile = null;
                }
            } else {
                this.storedProfile = null;
            }
        } else {
            this.storedProfile = null;
        }

        const norm = this.normalizeSource(val);
        this.activeSource = norm;
        this.activeUrl = norm ? this.toUrl(norm) : '';
        this.modalEl.dataset.activeSource = this.activeSource;
        this.modalEl.dataset.activeUrl = this.activeUrl;
    }

    isOpen() {
        return this.modalEl.classList.contains('smartcrop-modal-visible')
            || this.modalEl.classList.contains('show');
    }

    openModal() {
        if (this.modalEl.parentNode !== document.body) {
            document.body.appendChild(this.modalEl);
        }

        this.modalEl.classList.add('show', 'smartcrop-modal-visible');
        this.modalEl.style.display = 'flex';
        this.modalEl.style.zIndex = '2147483640';
        this.modalEl.removeAttribute('aria-hidden');
        this.modalEl.setAttribute('aria-modal', 'true');
        document.body.classList.add('modal-open');

        try {
            if (window.bootstrap?.Modal) {
                const instance = window.bootstrap.Modal.getInstance(this.modalEl);
                if (!instance) {
                    new window.bootstrap.Modal(this.modalEl);
                }
            }
        } catch (err) {}

        requestAnimationFrame(() => {
            this.onModalOpened();
        });
    }

    closeModal() {
        this.modalEl.classList.remove('show', 'smartcrop-modal-visible');
        this.modalEl.style.display = 'none';
        this.modalEl.setAttribute('aria-hidden', 'true');
        this.modalEl.removeAttribute('aria-modal');
        document.body.classList.remove('modal-open');

        try {
            if (window.bootstrap?.Modal) {
                const instance = window.bootstrap.Modal.getInstance(this.modalEl);
                instance?.hide();
            }
        } catch (err) {}
    }

    findTargetMediaField() {
        if (this.currentInput) {
            const mediaWrapper = this.currentMediaWrapper || this.currentInput.closest('joomla-field-media') || this.currentInput.closest('.field-media-wrapper');
            const previewImg = mediaWrapper ? mediaWrapper.querySelector('img.media-preview, .preview_img img, img') : null;
            const selectButton = mediaWrapper ? mediaWrapper.querySelector('.button-select, button[data-action="select"], button.btn-success') : null;
            return { input: this.currentInput, mediaWrapper, previewImg, selectButton };
        }

        const form = this.widgetEl?.closest('form') || document;
        const targetName = this.targetFieldName;

        let input = form.querySelector(`input[name="jform[images][${targetName}]"]`)
            || form.querySelector(`input[id="jform_images_${targetName}"]`)
            || form.querySelector(`input[name$="[${targetName}]"]`)
            || document.querySelector(`input[name="jform[images][${targetName}]"]`)
            || document.querySelector(`input[id="jform_images_${targetName}"]`)
            || document.querySelector(`input[name$="[${targetName}]"]`);

        let mediaWrapper = null;
        if (input) {
            mediaWrapper = input.closest('joomla-field-media') || input.closest('.field-media-wrapper');
        }

        if (!mediaWrapper && this.widgetEl) {
            const container = this.widgetEl.closest('fieldset, .options-form, .smartbrowser-editor-image-row, .tab-pane, form') || document;
            const wrappers = container.querySelectorAll('joomla-field-media');
            if (wrappers.length > 0) {
                const idx = (this.profile === 'fulltext') ? Math.min(1, wrappers.length - 1) : 0;
                mediaWrapper = wrappers[idx];
                if (!input) {
                    input = mediaWrapper.querySelector('.field-media-input, input[type="text"]');
                }
            }
        }

        let selectButton = null;
        if (mediaWrapper) {
            selectButton = mediaWrapper.querySelector('.button-select, button[data-action="select"], button.btn-success');
        }

        let previewImg = null;
        if (mediaWrapper) {
            previewImg = mediaWrapper.querySelector('img.media-preview, .preview_img img, img');
        }

        return { input, mediaWrapper, previewImg, selectButton };
    }

    bindTargetFieldListeners() {
        const { input, mediaWrapper } = this.findTargetMediaField();
        if (input) {
            input.addEventListener('change', () => this.syncFromTargetField());
            input.addEventListener('input', () => this.syncFromTargetField());
        }

        if (mediaWrapper && window.MutationObserver) {
            try {
                const observer = new MutationObserver(() => this.syncFromTargetField());
                observer.observe(mediaWrapper, { attributes: true, childList: true, subtree: true });
            } catch (err) {}
        }
    }

    syncFromTargetField() {
        const { input, previewImg } = this.findTargetMediaField();
        if (!input) return;

        const raw = input.value.trim();
        const norm = this.normalizeSource(raw);

        if (norm !== this.activeSource) {
            this.activeSource = norm;
            let newUrl = (previewImg && previewImg.src && !previewImg.src.endsWith('/#') && !previewImg.src.includes('data:image/svg+xml'))
                ? previewImg.src
                : (norm ? this.toUrl(norm) : '');
            this.activeUrl = newUrl;

            this.modalEl.dataset.activeSource = this.activeSource;
            this.modalEl.dataset.activeUrl = this.activeUrl;

            if (!norm) {
                this.clearCrop();
                this.showEmptyState();
            } else if (this.isOpen()) {
                this.loadImage(this.activeUrl, this.activeSource);
            }
        }
    }

    onModalOpened() {
        const { input, previewImg, mediaWrapper } = this.findTargetMediaField();

        let rawValue = input ? input.value.trim() : '';
        let detectedSource = rawValue ? this.normalizeSource(rawValue) : '';

        // If field has crop in its URL, prioritize it
        const parsedCrop = this.extractCropFromValue(rawValue);
        if (parsedCrop) {
            this.storedProfile = parsedCrop;
        }

        const sourceToUse = detectedSource || this.activeSource || this.modalEl.dataset.activeSource || '';
        let urlToUse = '';

        if (previewImg && previewImg.src && !previewImg.src.endsWith('/#') && !previewImg.src.includes('data:image/svg+xml')) {
            const previewNorm = this.normalizeSource(previewImg.src);
            if (!detectedSource || previewNorm.includes(detectedSource) || detectedSource.includes(previewNorm)) {
                urlToUse = previewImg.src;
            }
        }

        if (!urlToUse && this.modalEl.dataset.activeUrl && (!sourceToUse || this.modalEl.dataset.activeSource === sourceToUse)) {
            urlToUse = this.modalEl.dataset.activeUrl;
        }

        if (!urlToUse && sourceToUse) {
            const basePath = mediaWrapper?.getAttribute('base-path');
            if (basePath) {
                const cleanBase = basePath.replace(/\/index\.php\/?$/i, '/').replace(/\/+$/, '');
                urlToUse = cleanBase + '/' + sourceToUse.replace(/^\/+/, '');
            } else {
                urlToUse = this.toUrl(sourceToUse);
            }
        }

        if (sourceToUse && urlToUse) {
            this.loadImage(urlToUse, sourceToUse);
        } else {
            this.showEmptyState();
        }
    }

    loadImage(url, source) {
        if (!url) {
            this.showEmptyState();
            return;
        }

        this.activeUrl = url;
        this.activeSource = source;
        this._triedFallback = false;

        this.img.onload = () => {
            this.isLoaded = true;
            this.hideEmptyState();

            if (this.storedProfile && this.storedProfile.crop) {
                this.loadStoredCrop(this.storedProfile);
            } else {
                this.resetFraming();
            }
        };

        this.img.onerror = () => {
            if (!this._triedFallback && this.activeSource) {
                this._triedFallback = true;
                const fallbackUrl = this.toUrl(this.activeSource);
                if (fallbackUrl && fallbackUrl !== this.img.src) {
                    this.img.src = fallbackUrl;
                    return;
                }
            }
            this.showEmptyState();
        };

        this.img.src = url;
    }

    showEmptyState() {
        this.isLoaded = false;
        if (this.emptyState) this.emptyState.classList.remove('d-none');
        if (this.img) this.img.classList.add('d-none');
        if (this.toolbar) this.toolbar.classList.add('d-none');
        if (this.panHint) this.panHint.classList.add('d-none');
    }

    hideEmptyState() {
        if (this.emptyState) this.emptyState.classList.add('d-none');
        if (this.img) this.img.classList.remove('d-none');
        if (this.toolbar) this.toolbar.classList.remove('d-none');
        if (this.panHint) this.panHint.classList.remove('d-none');
    }

    calculateMetrics() {
        if (!this.isLoaded || !this.img.naturalWidth || !this.img.naturalHeight) {
            return null;
        }

        const nw = this.img.naturalWidth;
        const nh = this.img.naturalHeight;
        const vw = this.viewport.clientWidth;
        const vh = this.viewport.clientHeight;

        if (vw <= 0 || vh <= 0) return null;

        const scaleX = vw / nw;
        const scaleY = vh / nh;
        this.minScale = Math.max(scaleX, scaleY);
        this.currentScale = this.minScale * this.zoom;

        const renderW = nw * this.currentScale;
        const renderH = nh * this.currentScale;

        const minX = vw - renderW;
        const maxX = 0;
        const minY = vh - renderH;
        const maxY = 0;

        if (isNaN(this.posX)) this.posX = 0;
        if (isNaN(this.posY)) this.posY = 0;

        this.posX = Math.min(maxX, Math.max(minX, this.posX));
        this.posY = Math.min(maxY, Math.max(minY, this.posY));

        return { vw, vh, nw, nh, renderW, renderH, minX, maxX, minY, maxY };
    }

    applyTransform() {
        const metrics = this.calculateMetrics();
        if (!metrics) return;

        this.img.style.setProperty('width', `${metrics.nw * this.currentScale}px`, 'important');
        this.img.style.setProperty('height', `${metrics.nh * this.currentScale}px`, 'important');
        this.img.style.setProperty('max-width', 'none', 'important');
        this.img.style.setProperty('max-height', 'none', 'important');
        this.img.style.setProperty('transform', `translate3d(${this.posX}px, ${this.posY}px, 0)`, 'important');

        if (this.slider) {
            this.slider.value = this.zoom.toFixed(2);
        }

        if (this.zoomValueLabel) {
            this.zoomValueLabel.textContent = `${Math.round(this.zoom * 100)}%`;
        }

        if (this.presetBtns) {
            this.presetBtns.forEach((btn) => {
                const presetVal = parseFloat(btn.dataset.smartcropZoomPreset);
                if (Math.abs(presetVal - this.zoom) < 0.05) {
                    btn.classList.add('is-active', 'btn-primary');
                    btn.classList.remove('btn-outline-secondary');
                } else {
                    btn.classList.remove('is-active', 'btn-primary');
                    btn.classList.add('btn-outline-secondary');
                }
            });
        }

        this.updateLiveCoordinates(metrics);
    }

    updateLiveCoordinates(metrics) {
        if (!this.liveCoordsEl || !metrics) return;

        const visibleNaturalW = metrics.vw / this.currentScale;
        const visibleNaturalH = metrics.vh / this.currentScale;
        const visibleNaturalX = -this.posX / this.currentScale;
        const visibleNaturalY = -this.posY / this.currentScale;

        const normX = Math.max(0, Math.min(1, visibleNaturalX / metrics.nw));
        const normY = Math.max(0, Math.min(1, visibleNaturalY / metrics.nh));
        const normW = Math.max(0.0001, Math.min(1 - normX, visibleNaturalW / metrics.nw));
        const normH = Math.max(0.0001, Math.min(1 - normY, visibleNaturalH / metrics.nh));

        const pctX = Math.round(normX * 100);
        const pctY = Math.round(normY * 100);
        const pctW = Math.round(normW * 100);
        const pctH = Math.round(normH * 100);

        this.liveCoordsEl.textContent = `X: ${pctX}% | Y: ${pctY}% | ${pctW}% × ${pctH}%`;
    }

    resetFraming() {
        this.zoom = 1.0;
        const metrics = this.calculateMetrics();
        if (!metrics) return;

        this.posX = (metrics.vw - metrics.renderW) / 2;
        this.posY = (metrics.vh - metrics.renderH) / 2;
        this.applyTransform();
    }

    loadStoredCrop(profile) {
        const crop = profile.crop;
        const nw = this.img.naturalWidth;
        const nh = this.img.naturalHeight;
        const vw = this.viewport.clientWidth;
        if (!crop || !nw || !nh || !vw) {
            this.resetFraming();
            return;
        }

        const visibleNaturalW = crop.width * nw;
        if (visibleNaturalW <= 0) {
            this.resetFraming();
            return;
        }

        const targetScale = vw / visibleNaturalW;
        this.zoom = 1.0;
        this.calculateMetrics();

        this.zoom = Math.max(1.0, Math.min(3.0, targetScale / this.minScale));
        this.currentScale = this.minScale * this.zoom;

        this.posX = -(crop.x * nw) * this.currentScale;
        this.posY = -(crop.y * nh) * this.currentScale;

        this.applyTransform();
    }

    setZoom(val) {
        if (!this.isLoaded) return;
        const oldZoom = this.zoom;
        this.zoom = Math.max(1.0, Math.min(3.0, val));

        this.hidePanHint();

        const metrics = this.calculateMetrics();
        if (metrics) {
            const centerX = metrics.vw / 2;
            const centerY = metrics.vh / 2;
            const factor = this.zoom / oldZoom;
            this.posX = centerX - (centerX - this.posX) * factor;
            this.posY = centerY - (centerY - this.posY) * factor;
        }

        this.applyTransform();
    }

    hidePanHint() {
        if (this.panHint && !this.panHint.classList.contains('is-hidden')) {
            this.panHint.classList.add('is-hidden');
        }
    }

    onPointerDown(e) {
        if (!this.isLoaded || e.button !== 0) return;

        this.isDragging = true;
        this.viewport.classList.add('is-dragging');
        this.hidePanHint();

        try {
            this.viewport.setPointerCapture(e.pointerId);
        } catch (err) {}

        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
        this.dragInitialX = this.posX;
        this.dragInitialY = this.posY;

        e.preventDefault();
    }

    onPointerMove(e) {
        if (!this.isDragging) return;

        const dx = e.clientX - this.dragStartX;
        const dy = e.clientY - this.dragStartY;

        this.posX = this.dragInitialX + dx;
        this.posY = this.dragInitialY + dy;

        this.applyTransform();
    }

    onPointerUp(e) {
        if (!this.isDragging) return;

        this.isDragging = false;
        this.viewport.classList.remove('is-dragging');
        try {
            this.viewport.releasePointerCapture(e.pointerId);
        } catch (err) {}
    }

    onWheel(e) {
        if (!this.isLoaded) return;

        e.preventDefault();
        this.hidePanHint();
        const delta = e.deltaY < 0 ? 0.08 : -0.08;
        this.setZoom(this.zoom + delta);
    }

    applyFramingToField() {
        if (!this.isLoaded) return;

        const metrics = this.calculateMetrics();
        if (!metrics) return;

        const visibleNaturalW = metrics.vw / this.currentScale;
        const visibleNaturalH = metrics.vh / this.currentScale;
        const visibleNaturalX = -this.posX / this.currentScale;
        const visibleNaturalY = -this.posY / this.currentScale;

        const normX = Math.max(0, Math.min(1, visibleNaturalX / metrics.nw));
        const normY = Math.max(0, Math.min(1, visibleNaturalY / metrics.nh));
        const normW = Math.max(0.0001, Math.min(1 - normX, visibleNaturalW / metrics.nw));
        const normH = Math.max(0.0001, Math.min(1 - normY, visibleNaturalH / metrics.nh));

        const round4 = (num) => Math.round(num * 10000) / 10000;
        const round2 = (num) => Math.round(num * 100) / 100;

        const profilePayload = {
            source: this.activeSource,
            ratio: {
                width: this.ratioW,
                height: this.ratioH
            },
            crop: {
                x: round4(normX),
                y: round4(normY),
                width: round4(normW),
                height: round4(normH)
            },
            zoom: round2(this.zoom),
            source_dimensions: {
                width: metrics.nw,
                height: metrics.nh
            }
        };

        this.storedProfile = profilePayload;

        // 1. Update media input (stores in #joomlaImage://...&crop=...)
        const { input } = this.findTargetMediaField();
        const targetInput = this.currentInput || input;

        if (targetInput) {
            const currentVal = targetInput.value.trim();
            const updatedUri = this.updateUriWithCrop(
                currentVal,
                round4(normX),
                round4(normY),
                round4(normW),
                round4(normH),
                round2(this.zoom),
                this.ratioW,
                this.ratioH
            );
            targetInput.value = updatedUri;
            targetInput.dispatchEvent(new Event('change', { bubbles: true }));
            targetInput.dispatchEvent(new Event('input', { bubbles: true }));
        }

        // 2. Update crop button state
        const cropBtn = this.currentCropBtn || targetInput?.closest('.input-group')?.querySelector('.smartcrop-crop-btn');
        if (cropBtn) {
            cropBtn.className = 'btn btn-success smartcrop-crop-btn';
            cropBtn.innerHTML = `<span class="icon-crop" aria-hidden="true"></span> <span>✓ ${this.ratioW}:${this.ratioH}</span>`;
            cropBtn.title = `Κάδρο ${this.ratioW}:${this.ratioH} ενεργό (κάντε κλικ για επεξεργασία)`;
        }

        // 3. Backward compatibility: update legacy hidden form input if present
        if (this.input) {
            this.input.value = JSON.stringify(profilePayload);
            this.input.dispatchEvent(new Event('change', { bubbles: true }));
        }

        if (this.badge) {
            const activeText = (window.Joomla && Joomla.Text && Joomla.Text.sprintf)
                ? Joomla.Text.sprintf('PLG_CONTENT_SMARTCROP_STATUS_ACTIVE', this.ratioW, this.ratioH)
                : `✓ Κάδρο ${this.ratioW}:${this.ratioH}`;
            this.badge.textContent = activeText;
            this.badge.className = 'smartcrop-badge badge bg-success';
        }

        if (this.clearBtn) {
            this.clearBtn.classList.remove('d-none');
        }

        this.closeModal();
    }

    clearCrop() {
        const { input } = this.findTargetMediaField();
        const targetInput = this.currentInput || input;

        if (targetInput) {
            const currentVal = targetInput.value.trim();
            const clearedUri = this.removeCropFromUri(currentVal);
            targetInput.value = clearedUri;
            targetInput.dispatchEvent(new Event('change', { bubbles: true }));
            targetInput.dispatchEvent(new Event('input', { bubbles: true }));
        }

        const cropBtn = this.currentCropBtn || targetInput?.closest('.input-group')?.querySelector('.smartcrop-crop-btn');
        if (cropBtn) {
            cropBtn.className = 'btn btn-outline-primary smartcrop-crop-btn';
            cropBtn.innerHTML = '<span class="icon-crop" aria-hidden="true"></span> <span>Κάδρο</span>';
            cropBtn.title = `Ορισμός κάδρου ${this.ratioW}:${this.ratioH}`;
        }

        if (this.input) {
            this.input.value = '';
            this.input.dispatchEvent(new Event('change', { bubbles: true }));
        }

        this.storedProfile = null;

        if (this.badge) {
            const inactiveText = (window.Joomla && Joomla.Text && Joomla.Text._)
                ? Joomla.Text._('PLG_CONTENT_SMARTCROP_STATUS_INACTIVE')
                : 'Χωρίς κάδρο';
            this.badge.textContent = inactiveText;
            this.badge.className = 'smartcrop-badge badge bg-light text-muted border';
        }

        if (this.clearBtn) {
            this.clearBtn.classList.add('d-none');
        }

        this.closeModal();
    }

    updateUriWithCrop(val, x, y, w, h, zoom, rw, rh) {
        val = String(val || '').trim();
        if (!val) return '';

        const cropStr = `${x},${y},${w},${h}`;
        const ratioStr = `${rw}:${rh}`;
        const zoomStr = zoom.toFixed(2);

        if (val.includes('#')) {
            const parts = val.split('#');
            const base = parts[0];
            const frag = parts[1] || '';
            const qIdx = frag.indexOf('?');

            let fragPath = frag;
            let query = '';
            if (qIdx !== -1) {
                fragPath = frag.substring(0, qIdx);
                query = frag.substring(qIdx + 1);
            }

            const params = new URLSearchParams(query);
            params.set('crop', cropStr);
            params.set('ratio', ratioStr);
            params.set('zoom', zoomStr);

            return `${base}#${fragPath}?${params.toString()}`;
        }

        const clean = val.replace(/^local-[^/:]+[/:]*/i, 'images/').replace(/^\/+/, '');
        const params = new URLSearchParams();
        params.set('crop', cropStr);
        params.set('ratio', ratioStr);
        params.set('zoom', zoomStr);
        return `${clean}#joomlaImage://local-${clean}?${params.toString()}`;
    }

    removeCropFromUri(val) {
        if (!val || !val.includes('#')) return val;
        const parts = val.split('#');
        const base = parts[0];
        const frag = parts[1] || '';
        const qIdx = frag.indexOf('?');
        if (qIdx === -1) return val;

        const fragPath = frag.substring(0, qIdx);
        const query = frag.substring(qIdx + 1);
        const params = new URLSearchParams(query);
        params.delete('crop');
        params.delete('ratio');
        params.delete('zoom');

        const newQuery = params.toString();
        return newQuery ? `${base}#${fragPath}?${newQuery}` : `${base}#${fragPath}`;
    }

    extractCropFromValue(val) {
        if (!val) return null;
        let s = String(val).trim();

        if (s.includes('#')) {
            const parts = s.split('#');
            if (parts[1]) {
                s = parts[1];
            }
        }

        const qIdx = s.indexOf('?');
        if (qIdx === -1) return null;

        const query = s.substring(qIdx + 1);
        const params = new URLSearchParams(query);
        const cropStr = params.get('crop');
        if (!cropStr) return null;

        const coords = cropStr.split(',').map(Number);
        if (coords.length !== 4 || coords.some(isNaN)) return null;

        const zoom = parseFloat(params.get('zoom')) || 1.0;
        const ratioStr = params.get('ratio') || '4:3';
        const [rw, rh] = ratioStr.split(':').map(Number);

        return {
            crop: {
                x: coords[0],
                y: coords[1],
                width: coords[2],
                height: coords[3]
            },
            zoom: zoom,
            ratio: {
                width: rw || 4,
                height: rh || 3
            }
        };
    }

    openMediaPicker() {
        const { selectButton } = this.findTargetMediaField();

        if (selectButton) {
            this.closeModal();

            let reopened = false;
            const onMediaSelected = () => {
                if (reopened) return;
                reopened = true;
                setTimeout(() => {
                    this.syncFromTargetField();
                    this.openModal();
                }, 250);
            };

            const targetInput = this.currentInput || this.findTargetMediaField().input;
            if (targetInput) {
                targetInput.addEventListener('change', onMediaSelected, { once: true });
                targetInput.addEventListener('input', onMediaSelected, { once: true });
            }

            selectButton.click();
            return;
        }

        const promptText = (window.Joomla && Joomla.Text && Joomla.Text._)
            ? Joomla.Text._('PLG_CONTENT_SMARTCROP_PROMPT_MANUAL_IMAGE')
            : 'Enter image path (e.g. images/sample.jpg):';
        const entered = window.prompt(promptText, this.activeSource || 'images/');
        if (entered && entered.trim() !== '') {
            const clean = this.normalizeSource(entered.trim());
            if (clean) {
                this.activeSource = clean;
                this.activeUrl = this.toUrl(clean);
                this.loadImage(this.activeUrl, clean);
            }
        }
    }

    normalizeSource(val) {
        if (!val) return '';
        let s = String(val).trim();

        if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
            try {
                const parsed = JSON.parse(s);
                if (parsed) {
                    s = parsed.imagefile || parsed.src || parsed.url || (Array.isArray(parsed) ? parsed[0] : s);
                }
            } catch (e) {}
        }

        if (s.includes('#')) {
            const parts = s.split('#');
            const before = parts[0].trim();
            if (before !== '') {
                s = before;
            } else if (parts[1]) {
                let frag = parts[1].trim();
                frag = frag.replace(/^joomlaImage:\/\//i, '');
                frag = frag.replace(/^local-[^/:]+[/:]*/i, 'images/');
                s = frag;
            }
        }

        s = s.replace(/^local-[^/:]+[/:]*/i, 'images/');
        s = s.replace(/\\/g, '/');

        if (!/^(?:https?:)?\/\//i.test(s)) {
            const qIdx = s.indexOf('?');
            if (qIdx !== -1) {
                s = s.substring(0, qIdx);
            }
        }

        return s.replace(/^\/+/, '');
    }

    toUrl(val) {
        const norm = this.normalizeSource(val);
        if (!norm) return '';
        if (/^(?:https?:)?\/\//i.test(norm)) return norm;

        const { mediaWrapper } = this.findTargetMediaField();
        const joomlaBasePath = mediaWrapper?.getAttribute('base-path');
        if (joomlaBasePath) {
            const cleanBase = joomlaBasePath.replace(/\/index\.php\/?$/i, '/').replace(/\/+$/, '');
            return cleanBase + '/' + norm.replace(/^\/+/, '');
        }

        const siteRoot = this.siteRoot || this.modalEl?.dataset?.siteRoot;
        if (siteRoot) {
            const cleanRoot = siteRoot.replace(/\/index\.php\/?$/i, '/').replace(/\/+$/, '');
            return cleanRoot + '/' + norm.replace(/^\/+/, '');
        }

        const joomlaRoot = (window.Joomla && Joomla.getOptions && Joomla.getOptions('system.paths')?.rootFull)
            || (window.Joomla && Joomla.getOptions && Joomla.getOptions('system.paths')?.root);
        if (joomlaRoot) {
            const cleanJoomla = joomlaRoot.replace(/\/index\.php\/?$/i, '/').replace(/\/+$/, '');
            return cleanJoomla + '/' + norm.replace(/^\/+/, '');
        }

        let pathname = window.location.pathname;
        const adminIndex = pathname.indexOf('/administrator');
        let basePath = '';
        if (adminIndex !== -1) {
            basePath = pathname.substring(0, adminIndex);
        } else {
            basePath = pathname.substring(0, pathname.lastIndexOf('/'));
        }
        basePath = basePath.replace(/\/index\.php\/?$/i, '/').replace(/\/+$/, '');

        const origin = window.location.origin;
        const base = (origin + (basePath ? '/' + basePath.replace(/^\/+/, '') : '')).replace(/\/+$/, '');
        return base + '/' + norm.replace(/^\/+/, '');
    }
}

/**
 * Universal Manager: Attaches [ ✂️ Κάδρο ] into .input-group for any <joomla-field-media>
 */
class SmartCropManager {
    static initField(mediaEl) {
        if (!mediaEl || mediaEl._smartcropInitialized) return;

        const input = mediaEl.querySelector('.field-media-input, input[type="text"]');
        const inputGroup = input?.closest('.input-group') || mediaEl.querySelector('.input-group');
        if (!input || !inputGroup) return;

        mediaEl._smartcropInitialized = true;

        let cropBtn = inputGroup.querySelector('.smartcrop-crop-btn');
        if (!cropBtn) {
            cropBtn = document.createElement('button');
            cropBtn.type = 'button';
            cropBtn.className = 'btn btn-outline-primary smartcrop-crop-btn';
            cropBtn.setAttribute('data-smartcrop-crop-btn', '');
            cropBtn.innerHTML = '<span class="icon-crop" aria-hidden="true"></span> <span>Κάδρο</span>';
            cropBtn.title = 'Ορισμός κάδρου 4:3';

            input.insertAdjacentElement('afterend', cropBtn);
        }

        let profile = 'intro';
        const nameOrId = (input.name || input.id || '').toLowerCase();
        if (nameOrId.includes('fulltext') || nameOrId.includes('full_image')) {
            profile = 'fulltext';
        } else if (nameOrId.includes('intro')) {
            profile = 'intro';
        } else {
            profile = 'default';
        }

        const updateBtnState = () => {
            const val = input.value.trim();
            const hasCrop = /[?&]crop=[0-9.,-]+/i.test(val);
            if (hasCrop) {
                cropBtn.className = 'btn btn-success smartcrop-crop-btn';
                cropBtn.innerHTML = '<span class="icon-crop" aria-hidden="true"></span> <span>✓ 4:3</span>';
                cropBtn.title = 'Κάδρο 4:3 ενεργό (κάντε κλικ για επεξεργασία)';
            } else {
                cropBtn.className = 'btn btn-outline-primary smartcrop-crop-btn';
                cropBtn.innerHTML = '<span class="icon-crop" aria-hidden="true"></span> <span>Κάδρο</span>';
                cropBtn.title = 'Ορισμός κάδρου 4:3';
            }
        };

        updateBtnState();

        input.addEventListener('change', updateBtnState);
        input.addEventListener('input', updateBtnState);

        const clearBtn = inputGroup.querySelector('.button-clear, button[data-action="clear"]');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                setTimeout(updateBtnState, 60);
            });
        }

        cropBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const modalEl = SmartCropManager.ensureModal(profile);
            if (!modalEl._smartcropController) {
                modalEl._smartcropController = new SmartCropModalController(modalEl);
            }
            modalEl._smartcropController.attachToMediaField(input, mediaEl, cropBtn, profile);
            modalEl._smartcropController.openModal();
        });
    }

    static ensureModal(profile) {
        let modalEl = document.getElementById(`smartcrop-modal-${profile}`)
            || document.querySelector(`[data-smartcrop-modal][data-profile="${profile}"]`)
            || document.querySelector('[data-smartcrop-modal]');

        if (!modalEl) {
            modalEl = SmartCropManager.buildModalDom(profile);
            document.body.appendChild(modalEl);
        }
        return modalEl;
    }

    static buildModalDom(profile) {
        const div = document.createElement('div');
        div.className = 'modal fade smartcrop-modal';
        div.id = `smartcrop-modal-${profile || 'universal'}`;
        div.tabIndex = -1;
        div.setAttribute('aria-hidden', 'true');
        div.setAttribute('data-smartcrop-modal', '');
        div.setAttribute('data-profile', profile || 'default');
        div.setAttribute('data-ratio-w', '4');
        div.setAttribute('data-ratio-h', '3');
        div.setAttribute('data-max-width', '480');

        div.innerHTML = `
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">
                            <span class="icon-crop" aria-hidden="true"></span>
                            <span>SmartCrop — Κάδρο Εικόνας (4:3)</span>
                        </h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" data-smartcrop-cancel aria-label="Κλείσιμο"></button>
                    </div>
                    <div class="modal-body">
                        <div class="smartcrop-guide-banner">
                            <div class="smartcrop-steps">
                                <span class="smartcrop-guide-step"><span class="badge bg-primary">1</span> <span><strong>Ζουμ:</strong> Μεγεθύνετε για εστίαση.</span></span>
                                <span class="smartcrop-guide-step"><span class="badge bg-primary">2</span> <span><strong>Σύρετε:</strong> Κεντράρετε το θέμα.</span></span>
                                <span class="smartcrop-guide-step"><span class="badge bg-primary">3</span> <span><strong>Εφαρμογή:</strong> Πατήστε Εφαρμογή Κάδρου.</span></span>
                            </div>
                        </div>
                        <div class="smartcrop-viewport-wrapper">
                            <div class="smartcrop-viewport" data-smartcrop-viewport style="aspect-ratio: 4 / 3; max-width: 480px;">
                                <div class="smartcrop-corner tl" aria-hidden="true"></div>
                                <div class="smartcrop-corner tr" aria-hidden="true"></div>
                                <div class="smartcrop-corner bl" aria-hidden="true"></div>
                                <div class="smartcrop-corner br" aria-hidden="true"></div>
                                <div class="smartcrop-viewfinder-badge" aria-hidden="true">📐 4:3 (Σταθερό)</div>
                                <img src="" alt="" class="smartcrop-image d-none" data-smartcrop-image draggable="false" />
                                <div class="smartcrop-grid" aria-hidden="true">
                                    <div class="smartcrop-grid-line v1"></div>
                                    <div class="smartcrop-grid-line v2"></div>
                                    <div class="smartcrop-grid-line h1"></div>
                                    <div class="smartcrop-grid-line h2"></div>
                                </div>
                                <div class="smartcrop-pan-hint d-none" data-smartcrop-pan-hint>🖐️ Σύρετε για μετακίνηση</div>
                                <div class="smartcrop-empty-state" data-smartcrop-empty-state>
                                    <div>
                                        <span class="icon-picture display-4 mb-2 d-block" aria-hidden="true"></span>
                                        <p class="mb-3 small">Δεν έχει επιλεγεί εικόνα στο πεδίο.</p>
                                        <button type="button" class="btn btn-sm btn-primary" data-smartcrop-select-media>
                                            <span class="icon-picture" aria-hidden="true"></span>
                                            <span>Επιλογή εικόνας</span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="smartcrop-toolbar d-flex flex-wrap align-items-center justify-content-between gap-2 mt-3" data-smartcrop-toolbar>
                            <div class="smartcrop-zoom-controls d-flex align-items-center gap-2">
                                <button type="button" class="btn btn-sm btn-outline-secondary" data-smartcrop-zoom-out title="Σμίκρυνση"><span class="icon-minus" aria-hidden="true"></span></button>
                                <input type="range" class="form-range smartcrop-zoom-slider" min="1.0" max="3.0" step="0.01" value="1.0" data-smartcrop-zoom-slider aria-label="Ζουμ" />
                                <button type="button" class="btn btn-sm btn-outline-secondary" data-smartcrop-zoom-in title="Μεγέθυνση"><span class="icon-plus" aria-hidden="true"></span></button>
                                <span class="smartcrop-zoom-value" data-smartcrop-zoom-value>100%</span>
                            </div>
                            <div class="smartcrop-presets" data-smartcrop-presets>
                                <button type="button" class="btn btn-sm btn-primary smartcrop-btn-preset is-active" data-smartcrop-zoom-preset="1.0">100% Fit</button>
                                <button type="button" class="btn btn-sm btn-outline-secondary smartcrop-btn-preset" data-smartcrop-zoom-preset="1.25">125%</button>
                                <button type="button" class="btn btn-sm btn-outline-secondary smartcrop-btn-preset" data-smartcrop-zoom-preset="1.5">150%</button>
                                <button type="button" class="btn btn-sm btn-outline-secondary smartcrop-btn-preset" data-smartcrop-zoom-preset="2.0">200%</button>
                            </div>
                            <div class="smartcrop-live-coords-bar" data-smartcrop-live-coords-bar>
                                <span class="icon-crop" aria-hidden="true"></span>
                                <span data-smartcrop-live-coords>-</span>
                            </div>
                            <button type="button" class="btn btn-sm btn-outline-danger smartcrop-btn-reset ms-auto" data-smartcrop-reset title="Επαναφορά"><span class="icon-loop" aria-hidden="true"></span> <span>Επαναφορά</span></button>
                        </div>
                    </div>
                    <div class="modal-footer d-flex justify-content-between">
                        <button type="button" class="btn btn-sm btn-secondary" data-bs-dismiss="modal" data-smartcrop-cancel>Ακύρωση</button>
                        <div class="d-flex gap-2">
                            <button type="button" class="btn btn-sm btn-outline-danger" data-smartcrop-remove-btn title="Αφαίρεση κάδρου"><span class="icon-trash" aria-hidden="true"></span> <span>Αφαίρεση</span></button>
                            <button type="button" class="btn btn-sm btn-primary" data-smartcrop-apply-btn><span class="icon-check" aria-hidden="true"></span> <span>Εφαρμογή Κάδρου</span></button>
                        </div>
                    </div>
                </div>
            </div>`;
        return div;
    }

    static initAll() {
        document.querySelectorAll('joomla-field-media, .field-media-wrapper').forEach((el) => {
            SmartCropManager.initField(el);
        });
    }
}

// Expose on window globally
if (typeof window !== 'undefined') {
    window.SmartCropModalController = SmartCropModalController;
    window.SmartCropManager = SmartCropManager;

    window.SmartCropOpenModal = window.SmartCropOpenModal || function(profile, event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        const modalEl = SmartCropManager.ensureModal(profile);
        if (!modalEl._smartcropController) {
            modalEl._smartcropController = new SmartCropModalController(modalEl);
        }
        modalEl._smartcropController.openModal();
    };

    window.SmartCropCloseModal = window.SmartCropCloseModal || function(modalEl) {
        if (!modalEl) {
            modalEl = document.querySelector('[data-smartcrop-modal].smartcrop-modal-visible, [data-smartcrop-modal].show');
        }
        if (!modalEl) return;
        modalEl.classList.remove('show', 'smartcrop-modal-visible');
        modalEl.style.display = 'none';
        modalEl.setAttribute('aria-hidden', 'true');
        modalEl.removeAttribute('aria-modal');
        document.body.classList.remove('modal-open');
        if (modalEl._smartcropController) {
            try {
                modalEl._smartcropController.closeModal();
            } catch (e) {}
        }
    };
}

// Auto-initialize all fields and modals
const initSmartCrop = () => {
    document.querySelectorAll('[data-smartcrop-modal]').forEach((modalEl) => {
        if (!modalEl._smartcropController) {
            modalEl._smartcropController = new SmartCropModalController(modalEl);
        }
    });
    SmartCropManager.initAll();
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSmartCrop);
} else {
    initSmartCrop();
}

// Observe dynamic DOM changes (e.g. AJAX-injected dialogs, tabs, SmartBrowser)
if (typeof window !== 'undefined' && window.MutationObserver) {
    try {
        const dynamicObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.addedNodes.length > 0) {
                    initSmartCrop();
                    break;
                }
            }
        });
        dynamicObserver.observe(document.body, { childList: true, subtree: true });
    } catch (err) {}
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SmartCropModalController, SmartCropManager };
}

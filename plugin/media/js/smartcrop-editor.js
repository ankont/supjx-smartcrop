/**
 * SuperSoft SmartCrop - Editor Controller
 * Version 2.0.0
 *
 * Implements universal, non-destructive image framing inside a flexible modal overlay:
 * - Multi-ratio support with customizable semantic labels and interactive viewfinder HUD
 * - Real-time big picture ghost overlay on scissors button hover
 * - Universal integration into native Joomla <joomla-field-media> (.input-group adjacent button)
 * - Programmatic openCustom() API and SmartBrowserPicker.registerPreviewAction() integration
 * - Directly encodes and parses crop & zoom parameters in #joomlaImage:// query strings
 * - Compact, zero-scroll modal interface with actions in header and datalist tick slider
 * - Standalone modal support (works seamlessly with OR without Bootstrap 5 JS)
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

        // Plugin configuration
        this.cfg = SmartCropManager.getConfig();
        this.ratios = this.cfg.ratios || [];
        this.allowCustom = this.cfg.allowCustom !== false;
        this.ratioLabel = this.ratios[0]?.label || 'Πλαίσιο άρθρου';

        // Custom mode state (for SmartBrowser or external callers)
        this.isCustomMode = false;
        this.customOptions = null;

        // Dynamic active field references
        this.currentInput = null;
        this.currentMediaWrapper = null;
        this.currentCropBtn = null;

        // Modal internal elements
        this.viewport = this.modalEl.querySelector('[data-smartcrop-viewport]');
        this.img = this.modalEl.querySelector('[data-smartcrop-image]');
        this.slider = this.modalEl.querySelector('[data-smartcrop-zoom-slider]');
        this.zoomValueLabel = this.modalEl.querySelector('[data-smartcrop-zoom-value]');
        this.btnZoomIn = this.modalEl.querySelector('[data-smartcrop-zoom-in]');
        this.btnZoomOut = this.modalEl.querySelector('[data-smartcrop-zoom-out]');
        this.btnCenter = this.modalEl.querySelector('[data-smartcrop-center]');
        this.presetBtns = this.modalEl.querySelectorAll('[data-smartcrop-zoom-preset]');
        this.btnReset = this.modalEl.querySelector('[data-smartcrop-reset]');
        this.btnApply = this.modalEl.querySelector('[data-smartcrop-apply-btn]');
        this.btnRemove = this.modalEl.querySelector('[data-smartcrop-remove-btn]');
        this.btnSelectMedia = this.modalEl.querySelector('[data-smartcrop-select-media]');
        this.emptyState = this.modalEl.querySelector('[data-smartcrop-empty-state]');
        this.toolbar = this.modalEl.querySelector('[data-smartcrop-toolbar]');
        this.panHint = this.modalEl.querySelector('[data-smartcrop-pan-hint]');
        this.liveCoordsEl = this.modalEl.querySelector('[data-smartcrop-live-coords]');

        // Viewfinder HUD and Header Help elements
        this.ratioBadge = this.modalEl.querySelector('[data-smartcrop-ratio-badge]');
        this.ratioBadgeText = this.modalEl.querySelector('[data-smartcrop-ratio-text]');
        this.ratioDropdown = this.modalEl.querySelector('[data-smartcrop-ratio-dropdown]');
        this.helpBtn = this.modalEl.querySelector('[data-smartcrop-help-btn]');
        this.helpPopover = this.modalEl.querySelector('[data-smartcrop-help-popover]');

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

        // HTML dialog cancel event (e.g. Esc key native handling)
        this.modalEl.addEventListener('cancel', (e) => {
            e.preventDefault();
            this.closeModal();
        });

        // Escape key closes modal (listening on modal document and window)
        const targetDoc = this.modalEl.ownerDocument || document;
        const targetWin = targetDoc.defaultView || window;

        targetDoc.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen()) {
                this.closeModal();
            }
        });
        if (targetDoc !== document) {
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && this.isOpen()) {
                    this.closeModal();
                }
            });
        }

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
            this.viewport.addEventListener('pointermove', (e) => this.onPointerMove(e));
            this.viewport.addEventListener('pointerup', (e) => this.onPointerUp(e));
            this.viewport.addEventListener('pointercancel', (e) => this.onPointerUp(e));
            this.viewport.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });

            targetWin.addEventListener('pointermove', (e) => this.onPointerMove(e));
            targetWin.addEventListener('pointerup', (e) => this.onPointerUp(e));
            targetWin.addEventListener('pointercancel', (e) => this.onPointerUp(e));

            if (targetWin !== window) {
                window.addEventListener('pointermove', (e) => this.onPointerMove(e));
                window.addEventListener('pointerup', (e) => this.onPointerUp(e));
                window.addEventListener('pointercancel', (e) => this.onPointerUp(e));
            }
        }

        // Zoom Slider with magnetic snapping
        if (this.slider) {
            this.isPointerSliding = false;
            const baseSnapPoints = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0];
            const snapThreshold = 0.055; // 5.5% magnetic attraction threshold (stronger snap)

            this.slider.addEventListener('pointerdown', () => {
                this.isPointerSliding = true;
            });
            targetWin.addEventListener('pointerup', () => {
                this.isPointerSliding = false;
            });
            targetWin.addEventListener('pointercancel', () => {
                this.isPointerSliding = false;
            });
            if (targetWin !== window) {
                window.addEventListener('pointerup', () => {
                    this.isPointerSliding = false;
                });
                window.addEventListener('pointercancel', () => {
                    this.isPointerSliding = false;
                });
            }

            this.slider.addEventListener('input', (e) => {
                let val = parseFloat(e.target.value);
                // Magnetic snap applies ONLY to mouse/pointer interaction
                // Keyboard arrow navigation retains smooth 0.01 step precision
                if (this.isPointerSliding && !isNaN(val)) {
                    let snapPoints = [...baseSnapPoints];
                    if (this.isLoaded && this.img.naturalWidth && this.img.naturalHeight && this.viewport) {
                        const vw = this.viewport.clientWidth;
                        const vh = this.viewport.clientHeight;
                        const scaleX = vw / this.img.naturalWidth;
                        const scaleY = vh / this.img.naturalHeight;
                        const maxScale = Math.max(scaleX, scaleY);
                        const minScale = Math.min(scaleX, scaleY);
                        if (maxScale > 0) {
                            const containZoom = Math.round((minScale / maxScale) * 100) / 100;
                            if (containZoom >= 0.05 && containZoom < 0.98) {
                                snapPoints.push(containZoom);
                            }
                        }
                    }

                    for (const p of snapPoints) {
                        if (Math.abs(val - p) <= snapThreshold) {
                            val = p;
                            this.slider.value = String(p);
                            break;
                        }
                    }
                }
                this.setZoom(val);
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
                this.setZoom(Math.max(0.05, this.zoom - 0.15));
            });
        }

        if (this.btnCenter) {
            this.btnCenter.addEventListener('click', (e) => {
                e.preventDefault();
                this.centerImage();
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

        // Viewfinder HUD ratio dropdown toggle
        if (this.ratioBadge) {
            this.ratioBadge.addEventListener('pointerdown', (e) => {
                e.stopPropagation();
            });
            this.ratioBadge.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.toggleRatioDropdown();
            });
        }

        if (this.ratioDropdown) {
            this.ratioDropdown.addEventListener('pointerdown', (e) => {
                e.stopPropagation();
            });
        }

        // Help popover toggle
        if (this.helpBtn) {
            this.helpBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.toggleHelpPopover();
            });
        }

        // Global outside click listener
        const doc = this.modalEl?.ownerDocument || document;
        doc.addEventListener('click', (e) => {
            if (this.ratioDropdown && !this.ratioDropdown.classList.contains('d-none')) {
                if (!e.target.closest('[data-smartcrop-ratio-badge]') && !e.target.closest('[data-smartcrop-ratio-dropdown]')) {
                    this.closeRatioDropdown();
                }
            }
            if (this.helpPopover && !this.helpPopover.classList.contains('d-none')) {
                if (!e.target.closest('[data-smartcrop-help-btn]') && !e.target.closest('[data-smartcrop-help-popover]')) {
                    this.closeHelpPopover();
                }
            }
        });

        // Clear button on legacy widget
        if (this.clearBtn) {
            this.clearBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.clearCrop();
            });
        }
    }

    toggleRatioDropdown() {
        if (!this.ratioDropdown) return;
        if (this.ratioDropdown.classList.contains('d-none')) {
            this.renderRatioDropdown();
            this.positionRatioDropdown();
            this.ratioDropdown.classList.remove('d-none');
        } else {
            this.closeRatioDropdown();
        }
    }

    positionRatioDropdown() {
        if (!this.ratioDropdown || !this.ratioBadge) return;
        const badgeRect = this.ratioBadge.getBoundingClientRect();
        const modalBody = this.modalEl.querySelector('.modal-body') || this.modalEl;
        const modalBodyRect = modalBody.getBoundingClientRect();
        const top = Math.round(badgeRect.bottom - modalBodyRect.top + 6);
        const left = Math.round(Math.max(10, badgeRect.left - modalBodyRect.left));
        this.ratioDropdown.style.top = `${top}px`;
        this.ratioDropdown.style.left = `${left}px`;
    }

    closeRatioDropdown() {
        if (this.ratioDropdown) {
            this.ratioDropdown.classList.add('d-none');
        }
    }

    renderRatioDropdown() {
        if (!this.ratioDropdown) return;
        this.cfg = SmartCropManager.getConfig();
        this.ratios = this.cfg.ratios || [];
        this.allowCustom = this.cfg.allowCustom !== false;

        let html = '';
        this.ratios.forEach((r) => {
            const isCurrent = Math.abs(r.width - this.ratioW) < 0.01 && Math.abs(r.height - this.ratioH) < 0.01;
            html += `
                <button type="button" class="smartcrop-ratio-item ${isCurrent ? 'is-active' : ''}" data-rw="${r.width}" data-rh="${r.height}" data-rlabel="${r.label}">
                    <span class="smartcrop-ratio-check">${isCurrent ? '✓' : ''}</span>
                    <span class="smartcrop-ratio-val">${r.width}:${r.height}</span>
                    <span class="smartcrop-ratio-name">${r.label}</span>
                </button>
            `;
        });

        if (this.allowCustom) {
            html += `
                <div class="smartcrop-ratio-divider"></div>
                <button type="button" class="smartcrop-ratio-item smartcrop-ratio-custom" data-rcustom="1">
                    <span class="smartcrop-ratio-check"></span>
                    <span class="smartcrop-ratio-val">⚙️</span>
                    <span class="smartcrop-ratio-name">Προσαρμοσμένη...</span>
                </button>
            `;
        }

        this.ratioDropdown.innerHTML = html;

        this.ratioDropdown.querySelectorAll('.smartcrop-ratio-item').forEach((item) => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (item.dataset.rcustom) {
                    this.promptCustomRatio();
                } else {
                    const rw = parseFloat(item.dataset.rw);
                    const rh = parseFloat(item.dataset.rh);
                    const rlabel = item.dataset.rlabel || `${rw}:${rh}`;
                    this.setRatio(rw, rh, rlabel, true);
                }
            });
        });
    }

    promptCustomRatio() {
        this.closeRatioDropdown();
        const input = window.prompt('Εισάγετε προσαρμοσμένη αναλογία (π.χ. 16:9, 3:2, 1:1):', `${this.ratioW}:${this.ratioH}`);
        if (!input) return;
        const parts = input.trim().split(/[:/xX-]/);
        if (parts.length === 2) {
            const w = parseFloat(parts[0]);
            const h = parseFloat(parts[1]);
            if (!isNaN(w) && !isNaN(h) && w > 0 && h > 0) {
                this.setRatio(w, h, 'Προσαρμοσμένη', true);
            }
        }
    }

    setRatio(rw, rh, label, updateTransform = true) {
        this.ratioW = rw;
        this.ratioH = rh;
        this.ratioLabel = label || `${rw}:${rh}`;
        this.targetRatio = rw / rh;

        if (this.viewport) {
            this.viewport.style.aspectRatio = `${rw} / ${rh}`;
        }
        if (this.ratioBadgeText) {
            this.ratioBadgeText.textContent = `📐 ${rw}:${rh} (${this.ratioLabel})`;
        }
        this.closeRatioDropdown();

        if (updateTransform && this.isLoaded) {
            const metrics = this.calculateMetrics();
            if (metrics) {
                this.posX = Math.min(metrics.maxX, Math.max(metrics.minX, this.posX));
                this.posY = Math.min(metrics.maxY, Math.max(metrics.minY, this.posY));
            }
            this.applyTransform();
        }
    }

    toggleHelpPopover() {
        if (!this.helpPopover) return;
        this.helpPopover.classList.toggle('d-none');
    }

    closeHelpPopover() {
        if (this.helpPopover) {
            this.helpPopover.classList.add('d-none');
        }
    }

    attachToMediaField(input, mediaWrapper, cropBtn, profileName) {
        this.isCustomMode = false;
        this.customOptions = null;
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

        // Resolve ratio from crop or fallback to default
        let activeRatioW = this.ratios[0]?.width || 4;
        let activeRatioH = this.ratios[0]?.height || 3;
        let activeLabel = this.ratios[0]?.label || 'Πλαίσιο άρθρου';

        if (parsed && parsed.ratio) {
            activeRatioW = parsed.ratio.width;
            activeRatioH = parsed.ratio.height;
            const match = this.ratios.find((r) => Math.abs(r.width - activeRatioW) < 0.01 && Math.abs(r.height - activeRatioH) < 0.01);
            if (match) {
                activeLabel = match.label;
            } else {
                activeLabel = `${activeRatioW}:${activeRatioH}`;
            }
        }

        this.setRatio(activeRatioW, activeRatioH, activeLabel, false);

        // Show/hide remove button based on active crop
        if (this.btnRemove) {
            if (parsed && parsed.crop) {
                this.btnRemove.classList.remove('d-none');
            } else {
                this.btnRemove.classList.add('d-none');
            }
        }

        const norm = this.normalizeSource(val);
        this.activeSource = norm;
        this.activeUrl = norm ? this.toUrl(norm) : '';
        this.modalEl.dataset.activeSource = this.activeSource;
        this.modalEl.dataset.activeUrl = this.activeUrl;
    }

    attachCustom(options = {}) {
        this.isCustomMode = true;
        this.customOptions = options;
        this.currentInput = null;
        this.currentMediaWrapper = null;
        this.currentCropBtn = null;
        this.profile = options.profile || 'universal';
        this.widgetEl = null;

        // Extract crop from options
        let parsed = null;
        if (options.crop) {
            if (typeof options.crop === 'object') {
                parsed = {
                    crop: {
                        x: Number(options.crop.x) || 0,
                        y: Number(options.crop.y) || 0,
                        width: Number(options.crop.width) || 1,
                        height: Number(options.crop.height) || 1
                    },
                    zoom: Number(options.crop.zoom) || 1.0,
                    ratio: options.crop.ratio || null
                };
            } else if (typeof options.crop === 'string') {
                parsed = this.extractCropFromValue(options.crop);
            }
        }
        this.storedProfile = parsed;

        // Resolve ratio from crop, options, or default
        let activeRatioW = this.ratios[0]?.width || 4;
        let activeRatioH = this.ratios[0]?.height || 3;
        let activeLabel = this.ratios[0]?.label || 'Πλαίσιο άρθρου';

        if (parsed && parsed.ratio) {
            activeRatioW = parsed.ratio.width || activeRatioW;
            activeRatioH = parsed.ratio.height || activeRatioH;
            const match = this.ratios.find((r) => Math.abs(r.width - activeRatioW) < 0.01 && Math.abs(r.height - activeRatioH) < 0.01);
            activeLabel = match ? match.label : `${activeRatioW}:${activeRatioH}`;
        } else if (options.ratio) {
            if (typeof options.ratio === 'object') {
                activeRatioW = Number(options.ratio.width || options.ratio.w) || activeRatioW;
                activeRatioH = Number(options.ratio.height || options.ratio.h) || activeRatioH;
                activeLabel = options.ratio.label || `${activeRatioW}:${activeRatioH}`;
            } else if (typeof options.ratio === 'string' && /[:/xX_]/.test(options.ratio)) {
                const parts = options.ratio.replace(/[xX/_]/g, ':').split(':');
                activeRatioW = parseFloat(parts[0]) || activeRatioW;
                activeRatioH = parseFloat(parts[1]) || activeRatioH;
                activeLabel = `${activeRatioW}:${activeRatioH}`;
            }
        }

        this.setRatio(activeRatioW, activeRatioH, activeLabel, false);

        // Show/hide remove button based on active crop
        if (this.btnRemove) {
            if (parsed && parsed.crop) {
                this.btnRemove.classList.remove('d-none');
            } else {
                this.btnRemove.classList.add('d-none');
            }
        }

        const sourceVal = options.source || options.imageUrl || '';
        this.activeSource = sourceVal;
        this.activeUrl = options.imageUrl || (sourceVal ? this.toUrl(sourceVal) : '');
        this.modalEl.dataset.activeSource = this.activeSource;
        this.modalEl.dataset.activeUrl = this.activeUrl;
    }

    isOpen() {
        return this.modalEl.classList.contains('smartcrop-modal-visible')
            || this.modalEl.classList.contains('show')
            || (this.modalEl.tagName === 'DIALOG' && this.modalEl.open);
    }

    openModal() {
        const doc = this.modalEl.ownerDocument || document;
        const targetBody = doc.body || document.body;
        if (targetBody && this.modalEl.parentNode !== targetBody) {
            targetBody.appendChild(this.modalEl);
        }

        this.modalEl.classList.add('show', 'smartcrop-modal-visible');
        this.modalEl.style.display = 'flex';
        this.modalEl.style.zIndex = '2147483640';
        this.modalEl.removeAttribute('aria-hidden');
        this.modalEl.setAttribute('aria-modal', 'true');
        targetBody?.classList.add('modal-open');

        // Promote to Browser Top Layer if HTML Dialog element is supported
        if (typeof this.modalEl.showModal === 'function') {
            try {
                if (!this.modalEl.open) {
                    this.modalEl.showModal();
                }
            } catch (err) {}
        }

        const win = doc.defaultView || window;
        if (this._boundTargetWin !== win) {
            this._boundTargetWin = win;
            win.addEventListener('pointermove', (e) => this.onPointerMove(e));
            win.addEventListener('pointerup', (e) => this.onPointerUp(e));
            win.addEventListener('pointercancel', (e) => this.onPointerUp(e));
        }

        try {
            if (win.bootstrap?.Modal) {
                const instance = win.bootstrap.Modal.getInstance(this.modalEl);
                if (!instance) {
                    new win.bootstrap.Modal(this.modalEl);
                }
            }
        } catch (err) {}

        requestAnimationFrame(() => {
            this.onModalOpened();
        });
    }

    closeModal() {
        this.closeRatioDropdown();
        this.closeHelpPopover();
        this.modalEl.classList.remove('show', 'smartcrop-modal-visible');
        this.modalEl.style.display = 'none';
        this.modalEl.setAttribute('aria-hidden', 'true');
        this.modalEl.removeAttribute('aria-modal');
        const doc = this.modalEl.ownerDocument || document;
        (doc.body || document.body)?.classList.remove('modal-open');

        if (typeof this.modalEl.close === 'function') {
            try {
                if (this.modalEl.open) {
                    this.modalEl.close();
                }
            } catch (err) {}
        }

        try {
            const win = doc.defaultView || window;
            if (win.bootstrap?.Modal) {
                const instance = win.bootstrap.Modal.getInstance(this.modalEl);
                instance?.hide();
            }
        } catch (err) {}

        if (doc.activeElement && typeof doc.activeElement.blur === 'function') {
            try { doc.activeElement.blur(); } catch (e) {}
        }
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
        if (this.isCustomMode) {
            if (this.activeUrl || this.activeSource) {
                this.loadImage(this.activeUrl, this.activeSource);
            } else {
                this.showEmptyState();
            }
            return;
        }

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

        const minX = Math.min(0, vw - renderW);
        const maxX = Math.max(0, vw - renderW);
        const minY = Math.min(0, vh - renderH);
        const maxY = Math.max(0, vh - renderH);

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

        let normX = visibleNaturalX / metrics.nw;
        let normY = visibleNaturalY / metrics.nh;
        let normW = visibleNaturalW / metrics.nw;
        let normH = visibleNaturalH / metrics.nh;

        if (normW <= 1.0001 && normX >= -0.0001) {
            normX = Math.max(0, Math.min(1, normX));
            normW = Math.max(0.0001, Math.min(1 - normX, normW));
        } else {
            normW = Math.max(0.0001, Math.min(25.0, normW));
            normX = Math.max(-25.0, Math.min(1.0, normX));
        }

        if (normH <= 1.0001 && normY >= -0.0001) {
            normY = Math.max(0, Math.min(1, normY));
            normH = Math.max(0.0001, Math.min(1 - normY, normH));
        } else {
            normH = Math.max(0.0001, Math.min(25.0, normH));
            normY = Math.max(-25.0, Math.min(1.0, normY));
        }

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

        this.zoom = Math.max(0.05, Math.min(3.0, targetScale / this.minScale));
        this.currentScale = this.minScale * this.zoom;

        this.posX = -(crop.x * nw) * this.currentScale;
        this.posY = -(crop.y * nh) * this.currentScale;

        this.applyTransform();
    }

    setZoom(val) {
        if (!this.isLoaded) return;
        const oldZoom = this.zoom;
        let minAllowed = 0.05;
        if (this.img.naturalWidth && this.img.naturalHeight && this.minScale > 0) {
            const maxNat = Math.max(this.img.naturalWidth, this.img.naturalHeight);
            minAllowed = Math.max(0.05, Math.min(1.0, 20 / (this.minScale * maxNat)));
        }
        this.zoom = Math.max(minAllowed, Math.min(3.0, val));

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

    centerImage() {
        if (!this.isLoaded) return;
        const metrics = this.calculateMetrics();
        if (!metrics) return;

        this.posX = (metrics.vw - metrics.renderW) / 2;
        this.posY = (metrics.vh - metrics.renderH) / 2;
        this.applyTransform();
    }

    hidePanHint() {
        if (this.panHint && !this.panHint.classList.contains('is-hidden')) {
            this.panHint.classList.add('is-hidden');
        }
    }

    onPointerDown(e) {
        if (!this.isLoaded || e.button !== 0) return;
        if (e.target.closest('[data-smartcrop-ratio-badge], [data-smartcrop-ratio-dropdown], button, a, input, select')) {
            return;
        }

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

        let normX = visibleNaturalX / metrics.nw;
        let normY = visibleNaturalY / metrics.nh;
        let normW = visibleNaturalW / metrics.nw;
        let normH = visibleNaturalH / metrics.nh;

        if (normW <= 1.0001 && normX >= -0.0001) {
            normX = Math.max(0, Math.min(1, normX));
            normW = Math.max(0.0001, Math.min(1 - normX, normW));
        } else {
            normW = Math.max(0.0001, Math.min(25.0, normW));
            normX = Math.max(-25.0, Math.min(1.0, normX));
        }

        if (normH <= 1.0001 && normY >= -0.0001) {
            normY = Math.max(0, Math.min(1, normY));
            normH = Math.max(0.0001, Math.min(1 - normY, normH));
        } else {
            normH = Math.max(0.0001, Math.min(25.0, normH));
            normY = Math.max(-25.0, Math.min(1.0, normY));
        }

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

        if (this.isCustomMode) {
            const effectiveSource = this.activeSource || this.customOptions?.source || this.activeUrl || '';
            const cropResult = {
                crop: profilePayload.crop,
                zoom: profilePayload.zoom,
                ratio: {
                    width: this.ratioW,
                    height: this.ratioH,
                    value: round4(this.ratioW / this.ratioH),
                    label: this.ratioLabel || `${this.ratioW}:${this.ratioH}`
                },
                sourceDimensions: profilePayload.source_dimensions,
                uri: effectiveSource ? this.updateUriWithCrop(
                    effectiveSource,
                    round4(normX),
                    round4(normY),
                    round4(normW),
                    round4(normH),
                    round2(this.zoom),
                    this.ratioW,
                    this.ratioH
                ) : '',
                css: {
                    transform: `translate3d(${this.posX}px, ${this.posY}px, 0)`,
                    scale: round2(this.zoom),
                    styleVars: {
                        '--sc-crop-x': `${round2(normX * 100)}%`,
                        '--sc-crop-y': `${round2(normY * 100)}%`,
                        '--sc-crop-w': `${round2(normW * 100)}%`,
                        '--sc-crop-h': `${round2(normH * 100)}%`,
                        '--sc-zoom': String(round2(this.zoom))
                    }
                }
            };

            if (typeof this.customOptions?.onApply === 'function') {
                try {
                    this.customOptions.onApply(cropResult);
                } catch (err) {
                    console.error('[SmartCrop] Error in custom onApply:', err);
                }
            } else {
                const previewTarget = this.customOptions?.previewElement || this.customOptions?.targetElement;
                if (previewTarget) {
                    SmartCropManager.applyFramingToElement(previewTarget, cropResult, this.activeUrl);
                }
            }

            this.closeModal();
            return;
        }

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

            const mediaWrapper = targetInput.closest('joomla-field-media') || this.currentMediaWrapper;

            // Synchronize <joomla-field-media> internal state so core validateValue never reverts it
            if (mediaWrapper) {
                mediaWrapper.validatedUrl = updatedUri;
                if (mediaWrapper.inputElement) {
                    mediaWrapper.inputElement.value = updatedUri;
                }
            }

            // Update input value and DOM attributes
            targetInput.value = updatedUri;
            targetInput.defaultValue = updatedUri;
            targetInput.setAttribute('value', updatedUri);

            // Mark field valid on media wrapper if available
            if (mediaWrapper && typeof mediaWrapper.markValid === 'function') {
                mediaWrapper.markValid();
            }

            // Update preview if available
            if (mediaWrapper && typeof mediaWrapper.updatePreview === 'function') {
                try { mediaWrapper.updatePreview(); } catch (e) {}
            }

            // Scroll input to right so user visibly sees crop parameters in textbox
            try {
                targetInput.scrollLeft = targetInput.scrollWidth;
            } catch (e) {}

            // Dispatch events so form and custom element register the change
            targetInput.dispatchEvent(new Event('input', { bubbles: true }));
            targetInput.dispatchEvent(new Event('change', { bubbles: true }));
            if (mediaWrapper) {
                mediaWrapper.dispatchEvent(new CustomEvent('change', {
                    detail: { value: updatedUri },
                    bubbles: true
                }));
            }

            // Immediately apply visual crop framing to image preview
            SmartCropManager.updateFieldPreview(mediaWrapper, targetInput);
        }

        this.closeModal();
    }

    clearCrop() {
        if (this.isCustomMode) {
            if (typeof this.customOptions?.onRemove === 'function') {
                try {
                    this.customOptions.onRemove();
                } catch (err) {}
            }

            const previewTarget = this.customOptions?.previewElement || this.customOptions?.targetElement;
            if (previewTarget) {
                SmartCropManager.clearFramingFromElement(previewTarget);
            }

            this.storedProfile = null;
            this.closeModal();
            return;
        }

        const { input } = this.findTargetMediaField();
        const targetInput = this.currentInput || input;

        if (targetInput) {
            const currentVal = targetInput.value.trim();
            const clearedUri = this.removeCropFromUri(currentVal);

            const mediaWrapper = targetInput.closest('joomla-field-media') || this.currentMediaWrapper;
            if (mediaWrapper) {
                mediaWrapper.validatedUrl = clearedUri;
                if (mediaWrapper.inputElement) {
                    mediaWrapper.inputElement.value = clearedUri;
                }
            }

            targetInput.value = clearedUri;
            targetInput.defaultValue = clearedUri;
            targetInput.setAttribute('value', clearedUri);

            if (mediaWrapper && typeof mediaWrapper.markValid === 'function') {
                mediaWrapper.markValid();
            }

            try {
                targetInput.scrollLeft = 0;
            } catch (e) {}

            targetInput.dispatchEvent(new Event('input', { bubbles: true }));
            targetInput.dispatchEvent(new Event('change', { bubbles: true }));
            if (mediaWrapper) {
                mediaWrapper.dispatchEvent(new CustomEvent('change', {
                    detail: { value: clearedUri },
                    bubbles: true
                }));
            }
        }

        const mediaWrapper = targetInput?.closest('joomla-field-media') || this.currentMediaWrapper;
        if (mediaWrapper && typeof mediaWrapper.updatePreview === 'function') {
            try { mediaWrapper.updatePreview(); } catch (e) {}
        }
        SmartCropManager.updateFieldPreview(mediaWrapper, targetInput);

        this.storedProfile = null;
        this.closeModal();
    }

    updateUriWithCrop(val, x, y, w, h, zoom, rw, rh) {
        val = String(val || '').trim();
        if (!val) return '';

        const cropStr = `${x}-${y}-${w}-${h}`;
        const ratioStr = `${rw}x${rh}`;
        const zoomStr = Number(zoom).toFixed(2);

        let base = val;
        let fragPath = '';
        let queryParams = {};

        if (val.includes('#')) {
            const parts = val.split('#');
            base = parts[0];
            const frag = parts[1] || '';
            const qIdx = frag.indexOf('?');

            if (qIdx !== -1) {
                fragPath = frag.substring(0, qIdx);
                const query = frag.substring(qIdx + 1);
                query.split('&').forEach((pair) => {
                    if (!pair) return;
                    const [k, v] = pair.split('=');
                    const dk = decodeURIComponent(k);
                    if (dk) {
                        queryParams[dk] = v ? decodeURIComponent(v) : '';
                    }
                });
            } else {
                fragPath = frag;
            }
        } else {
            let clean = val;
            try {
                if (/^https?:\/\//i.test(clean)) {
                    const u = new URL(clean);
                    clean = u.pathname;
                }
            } catch (e) {}
            clean = clean.replace(/^\/+/, '');
            const imgIdx = clean.indexOf('images/');
            if (imgIdx !== -1) {
                clean = clean.substring(imgIdx);
            }
            clean = clean.replace(/^local-[^/:]+[/:]*/i, 'images/').replace(/^\/+/, '');
            base = clean;
            fragPath = `joomlaImage://local-${clean}`;
        }

        if (/^https?:\/\//i.test(base)) {
            try {
                const u = new URL(base);
                let p = u.pathname.replace(/^\/+/, '');
                const imgIdx = p.indexOf('images/');
                if (imgIdx !== -1) {
                    base = p.substring(imgIdx);
                }
            } catch (e) {}
        }

        queryParams.crop = cropStr;
        queryParams.ratio = ratioStr;
        queryParams.zoom = zoomStr;

        const qs = Object.entries(queryParams)
            .map(([k, v]) => `${k}=${v}`)
            .join('&');

        return `${base}#${fragPath}?${qs}`;
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

        const queryParams = {};
        query.split('&').forEach((pair) => {
            if (!pair) return;
            const [k, v] = pair.split('=');
            const dk = decodeURIComponent(k);
            if (dk && dk !== 'crop' && dk !== 'ratio' && dk !== 'zoom') {
                queryParams[dk] = v ? decodeURIComponent(v) : '';
            }
        });

        const qs = Object.entries(queryParams)
            .map(([k, v]) => `${k}=${v}`)
            .join('&');

        return qs ? `${base}#${fragPath}?${qs}` : `${base}#${fragPath}`;
    }

    extractCropFromValue(val) {
        return SmartCropManager.extractCropFromValue(val);
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
        return SmartCropManager.normalizeSource(val);
    }

    toUrl(val) {
        const { mediaWrapper } = this.findTargetMediaField();
        return SmartCropManager.resolveImageUrl(val, this.currentMediaWrapper || mediaWrapper, this.siteRoot || this.modalEl?.dataset?.siteRoot);
    }
}

/**
 * Universal Manager: Attaches [ ✂️ ] into .input-group and frames media previews for any <joomla-field-media>
 */
class SmartCropManager {
    static normalizeSource(val) {
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

        s = s.replace(/\\/g, '/');
        s = s.replace(/^file:(?:com_media\/[^:]+:)?/i, '');
        s = s.replace(/^local-[^/:]+[/:]*/i, 'images/');

        if (/^(?:https?:)?\/\//i.test(s)) {
            try {
                const dummyOrigin = (typeof window !== 'undefined' && window.location?.origin) ? window.location.origin : 'http://localhost';
                const parsedUrl = new URL(s, dummyOrigin);
                const curOrigin = (typeof window !== 'undefined' && window.location?.origin) ? window.location.origin : '';
                if (!curOrigin || parsedUrl.origin === curOrigin || parsedUrl.hostname === 'localhost' || (typeof window !== 'undefined' && parsedUrl.hostname === window.location?.hostname)) {
                    s = parsedUrl.pathname;
                }
            } catch (e) {
                s = s.replace(/^(?:https?:)?\/\/[^\/]+/i, '');
            }
        }

        const qIdx = s.indexOf('?');
        if (qIdx !== -1) {
            s = s.substring(0, qIdx);
        }

        try {
            s = decodeURIComponent(s);
        } catch (e) {}

        s = s.replace(/^\/+/, '');

        // Canonicalize Joomla images folder if present
        const imgPos = s.indexOf('images/');
        if (imgPos !== -1) {
            s = s.substring(imgPos);
        }

        return s;
    }

    static resolveImageUrl(val, wrapper, fallbackSiteRoot) {
        const norm = SmartCropManager.normalizeSource(val);
        if (!norm) return '';
        if (/^(?:https?:)?\/\//i.test(norm)) return norm;

        const mediaWrapper = wrapper?.tagName === 'JOOMLA-FIELD-MEDIA' ? wrapper : wrapper?.closest?.('joomla-field-media') || wrapper;
        const joomlaBasePath = mediaWrapper?.getAttribute?.('base-path');
        if (joomlaBasePath) {
            const cleanBase = joomlaBasePath.replace(/\/index\.php\/?$/i, '/').replace(/\/+$/, '');
            return cleanBase + '/' + norm.replace(/^\/+/, '');
        }

        const siteRoot = fallbackSiteRoot;
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

    /**
     * Resolves an image thumbnail URL for any SmartBrowser resource or context.
     * Prioritizes resolved/effective images and thumbnail overrides before indigenous resource images.
     */
    static resolveResourceThumbnailUrl(context, visual) {
        if (!context) return '';
        if (context.imageUrl) {
            return SmartCropManager.resolveImageUrl(context.imageUrl, visual) || context.imageUrl;
        }

        const res = context.resource || {};
        const values = (typeof context.getValues === 'function' ? context.getValues() : (context.values || context.usage || context.selection?.usage)) || {};
        const resolvedImg = context.resolvedImage || res.effectiveThumbnailResource || null;

        const isImageLikeAddr = (addr) => {
            if (!addr || typeof addr !== 'string') return false;
            const beforeQ = addr.split(/[?#]/)[0] || '';
            return addr.includes('#joomlaImage://')
                || /^file:/i.test(addr)
                || (!beforeQ.includes(':') && (beforeQ.includes('/') || beforeQ.includes('.')));
        };

        let overrideUrl = '';
        const rawOverride = values?.['visual.thumbnailOverride'] || values?.['ext.selectionAddress']?.compounds?.['visual.thumbnailOverride'];
        if (typeof rawOverride === 'string' && isImageLikeAddr(rawOverride)) {
            overrideUrl = rawOverride;
        } else if (rawOverride && typeof rawOverride === 'object') {
            const cand = rawOverride.image || rawOverride.url || rawOverride.id || '';
            if (isImageLikeAddr(cand)) overrideUrl = cand;
        }

        const resolvedImgUrl = resolvedImg
            ? (resolvedImg.image || resolvedImg.thumbnail || resolvedImg.metadata?.image || resolvedImg.metadata?.thumbnail || resolvedImg.metadata?.url || resolvedImg.url || (resolvedImg.type === 'image' ? resolvedImg.id : '') || '')
            : '';

        const primaryImgEl = (typeof context.getImageElement === 'function' ? context.getImageElement() : null) || context.imageElement;
        const primaryImgSrc = primaryImgEl ? (primaryImgEl.currentSrc || primaryImgEl.src || primaryImgEl.getAttribute?.('src') || '') : '';

        // 1. Prioritize resolvedImage / effectiveThumbnail / thumbnailOverride / imageAddress / primary DOM img before indigenous thumbnail
        let url = resolvedImgUrl
            || res.effectiveThumbnail
            || overrideUrl
            || (isImageLikeAddr(context.imageAddress) ? context.imageAddress : '')
            || primaryImgSrc
            || res.thumbnail
            || res.metadata?.thumbnail
            || res.metadata?.poster
            || res.image
            || res.metadata?.image
            || (res.type === 'image' ? (res.metadata?.url || res.url || (typeof context.getAddress === 'function' ? context.getAddress() : '') || res.id) : '');

        // 2. Check indigenous article images JSON if present
        if (!url && res.images) {
            try {
                const imgs = typeof res.images === 'string' ? JSON.parse(res.images) : res.images;
                url = imgs?.image_intro || imgs?.image_fulltext || '';
            } catch (e) {}
        }

        // 3. If SmartBrowser Media Value formatter is available
        if (!url && typeof window !== 'undefined' && window.SmartBrowserMediaValue?.format && context.resource) {
            try {
                url = window.SmartBrowserMediaValue.format(res, 'url');
            } catch (e) {}
        }

        // 4. Fallback: check DOM in visual surface for rendered resource-visual-image
        if (!url && visual) {
            const domImg = visual.querySelector('img[data-sb-primary-image], img.resource-visual-image, img:not(.smartcrop-preview-ghost):not(.smartcrop-cropped-preview)');
            if (domImg) {
                url = domImg.currentSrc || domImg.src || domImg.getAttribute('src') || '';
            }
        }

        if (typeof url === 'string') {
            url = SmartCropManager.normalizeSource(url) || url.split('#')[0].split('?')[0].trim();
        }

        if (!url) return '';
        return SmartCropManager.resolveImageUrl(url, visual) || url;
    }

    static extractCropFromValue(val) {
        if (!val) return null;
        if (typeof val === 'object') {
            return val.crop ? val : null;
        }
        const rawStr = String(val).trim();
        if (!rawStr) return null;

        if ((rawStr.startsWith('{') && rawStr.endsWith('}')) || (rawStr.startsWith('[') && rawStr.endsWith(']'))) {
            try {
                const parsed = JSON.parse(rawStr);
                if (parsed && typeof parsed === 'object') return parsed;
            } catch (e) {}
        }

        let s = rawStr;
        if (s.includes('#')) {
            const parts = s.split('#');
            if (parts[1] && parts[1].includes('?')) {
                s = parts[1];
            }
        }

        const qIdx = s.indexOf('?');
        if (qIdx === -1) return null;

        const query = s.substring(qIdx + 1);
        const queryParams = {};
        query.split('&').forEach((pair) => {
            if (!pair) return;
            const eqIdx = pair.indexOf('=');
            const k = eqIdx !== -1 ? pair.substring(0, eqIdx) : pair;
            const v = eqIdx !== -1 ? pair.substring(eqIdx + 1) : '';
            const dk = decodeURIComponent(k);
            if (dk) {
                queryParams[dk] = v ? decodeURIComponent(v) : '';
            }
        });

        let alias = null;
        if (typeof queryParams.smartcrop === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(queryParams.smartcrop)) {
            alias = queryParams.smartcrop;
        } else if (typeof queryParams.crop === 'string' && queryParams.crop !== 'original' && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(queryParams.crop)) {
            alias = queryParams.crop;
        }

        const cropStr = (alias ? (queryParams[`${alias}.coords`] || queryParams[`${alias}_coords`]) : null)
            || queryParams.crop
            || queryParams.coords
            || queryParams['sc.coords']
            || queryParams['sc_coords']
            || queryParams['c.coords']
            || queryParams['c_coords'];

        if (!cropStr || cropStr === 'original') return null;

        const normalizedCropStr = String(cropStr).trim().replace(/(\d)-/g, '$1,');
        const coords = normalizedCropStr.split(/[,_~]+/).map(Number);
        if (coords.length !== 4 || coords.some(isNaN)) return null;

        const zoomRaw = (alias ? (queryParams[`${alias}.zoom`] || queryParams[`${alias}_zoom`]) : null)
            || queryParams.zoom
            || queryParams['sc.zoom']
            || queryParams['sc_zoom']
            || queryParams['c.zoom']
            || queryParams['c_zoom'];
        const zoom = parseFloat(zoomRaw) || 1.0;

        const ratioStr = (alias ? (queryParams[`${alias}.ratio`] || queryParams[`${alias}_ratio`]) : null)
            || queryParams.ratio
            || queryParams['sc.ratio']
            || queryParams['sc_ratio']
            || queryParams['c.ratio']
            || queryParams['c_ratio']
            || '4:3';
        const [rw, rh] = String(ratioStr).replace(/[xX/_]/g, ':').split(':').map((n) => parseFloat(n.trim()));

        let source = (alias ? (queryParams[`${alias}.src`] || queryParams[`${alias}_src`] || queryParams[`${alias}.source`]) : null)
            || queryParams.source
            || queryParams.src
            || queryParams['sc.src']
            || queryParams['sc_src']
            || queryParams['c.src']
            || queryParams['c_src']
            || '';

        if (!source) {
            const beforeQuery = rawStr.split(/[?#]/)[0] || '';
            const isImageUri = rawStr.includes('#joomlaImage://')
                || /^file:/i.test(rawStr)
                || (beforeQuery !== '' && !beforeQuery.startsWith('{') && !beforeQuery.includes('=') && !beforeQuery.includes(':') && (beforeQuery.includes('/') || beforeQuery.includes('.')));
            if (isImageUri) {
                const normCandidate = SmartCropManager.normalizeSource(rawStr);
                if (normCandidate && !normCandidate.includes(':')) {
                    source = normCandidate;
                }
            }
        }

        const result = {
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
        if (source) {
            result.source = SmartCropManager.normalizeSource(source) || source;
        }
        return result;
    }

    static getContainerDimensions(container) {
        if (!container) {
            return { height: 160, width: 336 };
        }

        let availH = 0;
        let availW = 0;

        // 1. Try actual clientHeight / clientWidth of the preview container
        if (container.clientHeight > 0) {
            const cs = window.getComputedStyle(container);
            const pt = parseFloat(cs.paddingTop) || 0;
            const pb = parseFloat(cs.paddingBottom) || 0;
            const pl = parseFloat(cs.paddingLeft) || 0;
            const pr = parseFloat(cs.paddingRight) || 0;
            availH = container.clientHeight - pt - pb;
            availW = container.clientWidth - pl - pr;
        }

        // 2. Try joomla-field-media preview-height / preview-width attributes if present
        if (availH <= 30) {
            const jfm = container.closest('joomla-field-media');
            const attrH = parseInt(jfm?.getAttribute('preview-height'), 10);
            const attrW = parseInt(jfm?.getAttribute('preview-width'), 10);
            if (attrH && attrH > 30) availH = attrH;
            if (attrW && attrW > 30) availW = attrW;
        }

        // 3. Try computed style height / width
        if (availH <= 30) {
            const cs = window.getComputedStyle(container);
            const h = parseFloat(cs.height) || 0;
            const pt = parseFloat(cs.paddingTop) || 0;
            const pb = parseFloat(cs.paddingBottom) || 0;
            if (h > 30) {
                availH = (cs.boxSizing === 'border-box') ? (h - pt - pb) : h;
            }
        }
        if (availW <= 30) {
            const cs = window.getComputedStyle(container);
            const w = parseFloat(cs.width) || 0;
            const pl = parseFloat(cs.paddingLeft) || 0;
            const pr = parseFloat(cs.paddingRight) || 0;
            if (w > 30) {
                availW = (cs.boxSizing === 'border-box') ? (w - pl - pr) : w;
            }
        }

        // 4. Fallback if container is hidden in inactive tab or not yet styled
        if (availH <= 30) availH = 160;
        if (availW <= 30) availW = 336;

        return {
            height: Math.max(40, Math.round(availH)),
            width: Math.max(40, Math.round(availW))
        };
    }

    static updateFieldPreview(mediaWrapper, input, cropBtn) {
        try {
            if (!mediaWrapper && !input) return;

        const wrapper = mediaWrapper || input?.closest('joomla-field-media, .field-media-wrapper, .control-group, .form-group');
        const previewContainer = wrapper?.querySelector('.field-media-preview')
            || wrapper?.closest?.('.control-group, .form-group')?.querySelector('.field-media-preview')
            || input?.closest?.('.control-group, .form-group')?.querySelector('.field-media-preview');

        if (!previewContainer) return;

        const img = previewContainer.querySelector('img:not(.smartcrop-preview-ghost)');
        const previewEmpty = previewContainer.querySelector('.preview_empty');
        const previewImg = previewContainer.querySelector('.preview_img');

        const val = input ? input.value.trim() : '';

        // 1. If no value or image is empty
        if (!val) {
            if (previewEmpty) {
                previewEmpty.style.setProperty('display', 'block', 'important');
            }
            if (previewImg) {
                previewImg.style.setProperty('display', 'none', 'important');
            }
            if (img) {
                img.style.setProperty('display', 'none', 'important');
            }
            const ghost = previewContainer.querySelector('.smartcrop-preview-ghost');
            if (ghost) {
                ghost.remove();
            }
            const frame = previewContainer.querySelector('.smartcrop-preview-frame');
            if (frame && img && frame.contains(img)) {
                const badge = frame.querySelector('.smartcrop-preview-badge');
                if (badge) badge.remove();
                frame.replaceWith(img);
            } else if (frame) {
                frame.remove();
            }
            previewContainer.classList.remove('is-revealing-ghost');
            return;
        }

        // 2. Value is present: resolve proper image URL from the field value
        const resolvedUrl = SmartCropManager.resolveImageUrl(val, wrapper);

        // Ensure preview image element exists
        if (!img) {
            img = document.createElement('img');
            img.className = 'media-preview';
            img.alt = '';
            const targetContainer = previewImg || previewContainer;
            targetContainer.appendChild(img);
        }

        // Synchronize img.src with the resolved URL if currently invalid (e.g. "/" on new empty form) or pointing elsewhere
        if (resolvedUrl) {
            const currentSrcAttr = img.getAttribute('src') || '';
            const cleanCurrent = (img.currentSrc || img.src || '').split('#')[0].replace(/\/+$/, '');
            const cleanTarget = resolvedUrl.split('#')[0].replace(/\/+$/, '');
            if (!img.src || currentSrcAttr === '/' || currentSrcAttr === '' || cleanCurrent !== cleanTarget) {
                img.src = resolvedUrl;
            }
        }

        // Hide empty label, show image container
        if (previewEmpty) {
            previewEmpty.style.setProperty('display', 'none', 'important');
        }
        if (previewImg) {
            previewImg.style.setProperty('display', 'contents', 'important');
        }
        img.style.removeProperty('display');

        // Remove any legacy crop button from input-group if present
        const inputGroupBtn = wrapper?.querySelector('.smartcrop-crop-btn');
        if (inputGroupBtn) {
            inputGroupBtn.remove();
        }

        // Determine profile
        let profile = 'intro';
        const nameOrId = (input?.name || input?.id || '').toLowerCase();
        if (nameOrId.includes('fulltext') || nameOrId.includes('full_image')) {
            profile = 'fulltext';
        } else if (nameOrId.includes('intro')) {
            profile = 'intro';
        } else {
            profile = 'default';
        }

        // Ensure frame wraps img
        let frame = previewContainer.querySelector('.smartcrop-preview-frame');
        if (!frame) {
            frame = document.createElement('div');
            frame.className = 'smartcrop-preview-frame';
            img.parentNode.insertBefore(frame, img);
            frame.appendChild(img);
        }

        // Ensure inner clip container wraps img (so img is strictly clipped to crop box)
        let clip = frame.querySelector('.smartcrop-preview-clip');
        if (!clip) {
            clip = document.createElement('div');
            clip.className = 'smartcrop-preview-clip';
            frame.insertBefore(clip, img);
            clip.appendChild(img);
        } else if (!clip.contains(img)) {
            clip.appendChild(img);
        }

        // Ensure ghost image layer exists inside frame (behind clip)
        let ghost = frame.querySelector('.smartcrop-preview-ghost');
        if (!ghost) {
            ghost = document.createElement('img');
            ghost.className = 'smartcrop-preview-ghost';
            ghost.alt = '';
            ghost.setAttribute('aria-hidden', 'true');
            frame.insertBefore(ghost, clip);
        }

        // Clean up any legacy ghost in previewContainer from earlier attempt
        const oldContainerGhost = previewContainer.querySelector(':scope > .smartcrop-preview-ghost');
        if (oldContainerGhost) {
            oldContainerGhost.remove();
        }

        // Clean up any legacy static badge
        const legacyBadge = frame.querySelector('.smartcrop-preview-badge');
        if (legacyBadge) {
            legacyBadge.remove();
        }

        // Ensure preview overlay button exists inside frame
        let previewBtn = frame.querySelector('.smartcrop-preview-btn');
        if (!previewBtn) {
            previewBtn = document.createElement('button');
            previewBtn.type = 'button';
            previewBtn.className = 'smartcrop-preview-btn';
            previewBtn.setAttribute('data-smartcrop-preview-btn', '');
            frame.appendChild(previewBtn);
        }

        // Frame itself is NOT a link
        frame.onclick = null;

        // Hover over scissors button reveals big picture ghost behind crop frame
        previewBtn.onmouseenter = () => {
            if (frame.classList.contains('is-cropped')) {
                frame.classList.add('is-revealing-ghost');
                previewContainer.classList.add('is-revealing-ghost');
            }
        };
        previewBtn.onmouseleave = () => {
            frame.classList.remove('is-revealing-ghost');
            previewContainer.classList.remove('is-revealing-ghost');
        };
        previewBtn.onfocus = () => {
            if (frame.classList.contains('is-cropped')) {
                frame.classList.add('is-revealing-ghost');
                previewContainer.classList.add('is-revealing-ghost');
            }
        };
        previewBtn.onblur = () => {
            frame.classList.remove('is-revealing-ghost');
            previewContainer.classList.remove('is-revealing-ghost');
        };

        // Overlay button click opens modal
        previewBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const modalEl = SmartCropManager.ensureModal(profile);
            if (!modalEl._smartcropController) {
                modalEl._smartcropController = new SmartCropModalController(modalEl);
            }
            modalEl._smartcropController.attachToMediaField(input, mediaWrapper, previewBtn, profile);
            modalEl._smartcropController.openModal();
        };

        // Observe previewContainer resizing (tab switches, responsive changes, custom dimensions)
        if (typeof ResizeObserver !== 'undefined' && !previewContainer._smartcropResizeObserver) {
            let lastH = 0;
            let lastW = 0;
            const ro = new ResizeObserver(() => {
                const dims = SmartCropManager.getContainerDimensions(previewContainer);
                if (Math.abs(dims.height - lastH) > 2 || Math.abs(dims.width - lastW) > 2) {
                    lastH = dims.height;
                    lastW = dims.width;
                    SmartCropManager.updateFieldPreview(wrapper, input);
                }
            });
            ro.observe(previewContainer);
            previewContainer._smartcropResizeObserver = ro;
        }

        const dims = SmartCropManager.getContainerDimensions(previewContainer);
        const availH = dims.height;
        const availW = dims.width;

        const parsed = SmartCropManager.extractCropFromValue(val);

        if (parsed && parsed.crop) {
            const { crop, ratio } = parsed;
            const rw = ratio?.width || 4;
            const rh = ratio?.height || 3;
            const cropAspect = rw / rh;

            const rawSrc = resolvedUrl || img.currentSrc || img.src || (input ? input.value : '') || '';
            const cleanSrc = resolvedUrl || rawSrc.split('#')[0].trim();

            if (ghost) {
                ghost.style.removeProperty('display');
                if (cleanSrc && ghost.src !== cleanSrc) {
                    ghost.src = cleanSrc;
                }
            }

            let targetH = availH;
            let targetW = Math.round(availH * cropAspect);
            if (targetW > availW) {
                targetW = availW;
                targetH = Math.round(availW / cropAspect);
            }

            frame.classList.add('is-cropped');
            frame.style.setProperty('height', `${targetH}px`, 'important');
            frame.style.setProperty('width', `${targetW}px`, 'important');
            frame.style.setProperty('max-height', '100%', 'important');
            frame.style.setProperty('max-width', '100%', 'important');
            frame.style.aspectRatio = `${rw} / ${rh}`;
            frame.title = '';

            previewBtn.className = 'smartcrop-preview-btn is-cropped';
            previewBtn.title = `Επεξεργασία κάδρου (${rw}:${rh}) — Hover για ολόκληρη εικόνα`;
            previewBtn.setAttribute('aria-label', `Επεξεργασία κάδρου (${rw}:${rh})`);
            previewBtn.innerHTML = `<span class="icon-scissors" aria-hidden="true"></span> <span>${rw}:${rh}</span>`;

            // Calculate percentage styles
            let normX = Number(crop.x) || 0;
            let normY = Number(crop.y) || 0;
            let normW = Number(crop.width) || 1;
            let normH = Number(crop.height) || 1;

            if (normW <= 1.0001 && normX >= -0.0001) {
                normX = Math.max(0, Math.min(1, normX));
                normW = Math.max(0.0001, Math.min(1 - normX, normW));
            } else {
                normW = Math.max(0.0001, Math.min(25.0, normW));
                normX = Math.max(-25.0, Math.min(1.0, normX));
            }

            if (normH <= 1.0001 && normY >= -0.0001) {
                normY = Math.max(0, Math.min(1, normY));
                normH = Math.max(0.0001, Math.min(1 - normY, normH));
            } else {
                normH = Math.max(0.0001, Math.min(25.0, normH));
                normY = Math.max(-25.0, Math.min(1.0, normY));
            }

            const scaleX = 1.0 / normW;
            const scaleY = 1.0 / normH;

            const widthPct  = (scaleX * 100.0).toFixed(4);
            const heightPct = (scaleY * 100.0).toFixed(4);
            const leftPct   = (-(normX / normW) * 100.0).toFixed(4);
            const topPct    = (-(normY / normH) * 100.0).toFixed(4);

            img.style.setProperty('position', 'absolute', 'important');
            img.style.setProperty('left', `${leftPct}%`, 'important');
            img.style.setProperty('top', `${topPct}%`, 'important');
            img.style.setProperty('width', `${widthPct}%`, 'important');
            img.style.setProperty('height', `${heightPct}%`, 'important');
            img.style.setProperty('max-width', 'none', 'important');
            img.style.setProperty('max-height', 'none', 'important');
            img.style.setProperty('display', 'block', 'important');
            img.style.setProperty('object-fit', 'fill', 'important');
            img.style.setProperty('pointer-events', 'none', 'important');

            // Ghost image: EXACT SAME coordinates, scale, and positioning behind clip
            if (ghost) {
                if (cleanSrc && ghost.src !== cleanSrc) {
                    ghost.src = cleanSrc;
                }
                ghost.style.removeProperty('display');
                ghost.style.setProperty('position', 'absolute', 'important');
                ghost.style.setProperty('left', `${leftPct}%`, 'important');
                ghost.style.setProperty('top', `${topPct}%`, 'important');
                ghost.style.setProperty('width', `${widthPct}%`, 'important');
                ghost.style.setProperty('height', `${heightPct}%`, 'important');
                ghost.style.setProperty('max-width', 'none', 'important');
                ghost.style.setProperty('max-height', 'none', 'important');
                ghost.style.setProperty('display', 'block', 'important');
                ghost.style.setProperty('object-fit', 'fill', 'important');
                ghost.style.setProperty('pointer-events', 'none', 'important');
            }
        } else {
            // Un-cropped state: natural image display, button visible
            frame.classList.remove('is-cropped');
            frame.classList.remove('is-revealing-ghost');
            previewContainer.classList.remove('is-revealing-ghost');
            if (ghost) {
                ghost.style.setProperty('display', 'none', 'important');
            }
            frame.style.removeProperty('aspect-ratio');
            frame.title = '';

            previewBtn.className = 'smartcrop-preview-btn';
            previewBtn.title = 'Ορισμός κάδρου (4:3)';
            previewBtn.setAttribute('aria-label', 'Ορισμός κάδρου (4:3)');
            previewBtn.innerHTML = '<span class="icon-scissors" aria-hidden="true"></span> <span>4:3</span>';

            // Clean up crop positioning styles
            img.style.removeProperty('position');
            img.style.removeProperty('left');
            img.style.removeProperty('top');
            img.style.removeProperty('pointer-events');
            img.style.removeProperty('transform');
            img.style.removeProperty('aspect-ratio');

            const nw = img.naturalWidth;
            const nh = img.naturalHeight;

            if (nw > 0 && nh > 0) {
                const natAspect = nw / nh;
                let targetH = availH;
                let targetW = Math.round(availH * natAspect);
                if (targetW > availW) {
                    targetW = availW;
                    targetH = Math.round(availW / natAspect);
                }

                frame.style.setProperty('height', `${targetH}px`, 'important');
                frame.style.setProperty('width', `${targetW}px`, 'important');
                frame.style.setProperty('max-height', '100%', 'important');
                frame.style.setProperty('max-width', '100%', 'important');

                img.style.setProperty('display', 'block', 'important');
                img.style.setProperty('width', '100%', 'important');
                img.style.setProperty('height', '100%', 'important');
                img.style.setProperty('max-width', '100%', 'important');
                img.style.setProperty('max-height', '100%', 'important');
                img.style.setProperty('object-fit', 'contain', 'important');
                img.style.setProperty('margin', 'auto', 'important');
                img.style.setProperty('align-self', 'center', 'important');
            } else {
                frame.style.setProperty('height', `${availH}px`, 'important');
                frame.style.setProperty('width', 'auto', 'important');
                frame.style.setProperty('max-height', '100%', 'important');
                frame.style.setProperty('max-width', '100%', 'important');

                img.style.setProperty('display', 'block', 'important');
                img.style.setProperty('height', '100%', 'important');
                img.style.setProperty('width', 'auto', 'important');
                img.style.setProperty('max-width', '100%', 'important');
                img.style.setProperty('max-height', '100%', 'important');
                img.style.setProperty('object-fit', 'contain', 'important');
                img.style.setProperty('margin', 'auto', 'important');
                img.style.setProperty('align-self', 'center', 'important');
            }
        }

        if (!img.complete) {
            img.addEventListener('load', () => {
                SmartCropManager.updateFieldPreview(mediaWrapper, input);
            }, { once: true });
        }
        } catch (err) {
            // Silently suppress preview update errors
        }
    }

    static initField(mediaEl) {
        if (!mediaEl || mediaEl._smartcropInitialized) return;

        const input = (mediaEl.tagName === 'INPUT' ? mediaEl : null)
                   || mediaEl.querySelector('.field-media-input, input[type="text"]');
        const inputGroup = input?.closest('.input-group') || mediaEl.querySelector('.input-group') || mediaEl;
        if (!input || !inputGroup) return;

        const mediaWrapper = mediaEl.tagName === 'JOOMLA-FIELD-MEDIA' ? mediaEl : mediaEl.closest('joomla-field-media') || mediaEl;

        // Remove any legacy crop button inside input-group so textbox gets full width
        const cropBtnExisting = inputGroup.querySelector('.smartcrop-crop-btn');
        if (cropBtnExisting) {
            cropBtnExisting.remove();
        }

        mediaEl._smartcropInitialized = true;

        if (mediaWrapper && !mediaWrapper._smartcropPatched) {
            mediaWrapper._smartcropPatched = true;
            const origValidate = mediaWrapper.validateValue;
            mediaWrapper.validateValue = async function(event) {
                const val = event?.target?.value || '';
                // If value has crop metadata, protect it from being stripped by core
                if (val.includes('crop=')) {
                    this.validatedUrl = val;
                    if (typeof this.markValid === 'function') {
                        this.markValid();
                    }
                    return;
                }
                if (origValidate) {
                    return origValidate.call(this, event);
                }
            };
        }

        if (mediaWrapper && !mediaWrapper._smartcropPreviewPatched) {
            mediaWrapper._smartcropPreviewPatched = true;
            const origUpdatePreview = mediaWrapper.updatePreview;
            mediaWrapper.updatePreview = function() {
                if (origUpdatePreview) {
                    origUpdatePreview.call(this);
                }
                SmartCropManager.updateFieldPreview(mediaWrapper, input);
            };
        }

        const onValueUpdate = () => {
            SmartCropManager.updateFieldPreview(mediaWrapper, input);
        };

        onValueUpdate();

        input.addEventListener('change', onValueUpdate);
        input.addEventListener('input', onValueUpdate);
        if (mediaWrapper && mediaWrapper !== input) {
            mediaWrapper.addEventListener('change', onValueUpdate);
        }

        const clearBtn = inputGroup.querySelector('.button-clear, button[data-action="clear"]');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                setTimeout(onValueUpdate, 60);
            });
        }
    }

    static getConfig() {
        let cfg = null;
        try {
            if (typeof Joomla !== 'undefined' && Joomla.getOptions) {
                cfg = Joomla.getOptions('plg_content_smartcrop');
            }
        } catch (e) {}

        if (!cfg || !cfg.ratios || !cfg.ratios.length) {
            cfg = {
                ratios: [
                    { label: 'Πλαίσιο άρθρου', width: 4, height: 3 },
                    { label: 'Hero Banner', width: 16, height: 9 },
                    { label: 'Τετράγωνο', width: 1, height: 1 }
                ],
                allowCustom: true,
                previewMaxWidth: 480
            };
        }
        return cfg;
    }

    static ensureStylesInDocument(targetDoc) {
        if (!targetDoc || !targetDoc.head) return;
        if (targetDoc.querySelector('link[href*="smartcrop-editor.css"], style[data-smartcrop-styles]')) {
            return;
        }
        const parentLink = document.querySelector('link[href*="smartcrop-editor.css"]');
        if (parentLink) {
            const link = targetDoc.createElement('link');
            link.rel = 'stylesheet';
            link.href = parentLink.href;
            targetDoc.head.appendChild(link);
            return;
        }
        const joomlaRoot = (window.Joomla && Joomla.getOptions && Joomla.getOptions('system.paths')?.rootFull)
            || (window.Joomla && Joomla.getOptions && Joomla.getOptions('system.paths')?.root) || '';
        const cleanRoot = joomlaRoot.replace(/\/index\.php\/?$/i, '/').replace(/\/+$/, '');
        const link = targetDoc.createElement('link');
        link.rel = 'stylesheet';
        link.href = `${cleanRoot}/media/plg_content_smartcrop/css/smartcrop-editor.css?v=2.0.0`;
        targetDoc.head.appendChild(link);
    }

    static ensureModal(profile, targetDoc = null) {
        const doc = targetDoc || (typeof document !== 'undefined' ? document : null);
        if (!doc) return null;
        let modalEl = doc.getElementById(`smartcrop-modal-${profile}`)
            || doc.querySelector(`[data-smartcrop-modal][data-profile="${profile}"]`)
            || doc.querySelector('[data-smartcrop-modal]');

        // Upgrade legacy DIV element to HTML Dialog element if needed
        if (modalEl && modalEl.tagName !== 'DIALOG') {
            modalEl.remove();
            modalEl = null;
        }

        if (!modalEl) {
            modalEl = SmartCropManager.buildModalDom(profile, doc);
            (doc.body || doc.documentElement).appendChild(modalEl);
        }
        return modalEl;
    }

    static buildModalDom(profile, targetDoc = null) {
        const doc = targetDoc || (typeof document !== 'undefined' ? document : null);
        const cfg = SmartCropManager.getConfig();
        const firstRatio = cfg.ratios?.[0] || { width: 4, height: 3, label: 'Πλαίσιο άρθρου' };
        const maxWidth = cfg.previewMaxWidth || 480;

        const div = doc.createElement('dialog');
        div.className = 'modal fade smartcrop-modal';
        div.id = `smartcrop-modal-${profile || 'universal'}`;
        div.tabIndex = -1;
        div.setAttribute('aria-hidden', 'true');
        div.setAttribute('data-smartcrop-modal', '');
        div.setAttribute('data-profile', profile || 'default');
        div.setAttribute('data-ratio-w', String(firstRatio.width));
        div.setAttribute('data-ratio-h', String(firstRatio.height));
        div.setAttribute('data-max-width', String(maxWidth));

        div.innerHTML = `
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header smartcrop-modal-header">
                        <div class="smartcrop-header-left">
                            <button type="button" class="btn btn-sm smartcrop-btn-cancel" data-bs-dismiss="modal" data-smartcrop-cancel title="Ακύρωση">
                                <span class="icon-times" aria-hidden="true"></span> <span>Ακύρωση</span>
                            </button>
                        </div>

                        <div class="smartcrop-header-center">
                            <span class="smartcrop-modal-title">Κάδρο Εικόνας</span>
                            <div class="smartcrop-help-wrapper">
                                <button type="button" class="smartcrop-help-btn" data-smartcrop-help-btn title="Οδηγίες χρήσης" aria-label="Οδηγίες">
                                    <span class="icon-info-circle" aria-hidden="true"></span>
                                </button>
                                <div class="smartcrop-help-popover d-none" data-smartcrop-help-popover>
                                    <div class="smartcrop-help-popover-title">Οδηγός Καδραρίσματος (3 Βήματα)</div>
                                    <ol class="mb-0 ps-3 small">
                                        <li><strong>Ζουμ:</strong> Μεγεθύνετε (π.χ. 125% ή 150%) για εστίαση.</li>
                                        <li><strong>Σύρετε:</strong> Κάντε κλικ και σύρετε για να κεντράρετε το θέμα.</li>
                                        <li><strong>Εφαρμογή:</strong> Πατήστε Εφαρμογή.</li>
                                    </ol>
                                </div>
                            </div>
                        </div>

                        <div class="smartcrop-header-right">
                            <button type="button" class="btn btn-sm smartcrop-btn-remove d-none" data-smartcrop-remove-btn title="Αφαίρεση κάδρου">
                                <span class="icon-trash" aria-hidden="true"></span> <span>Αφαίρεση</span>
                            </button>
                            <button type="button" class="btn btn-sm smartcrop-btn-apply" data-smartcrop-apply-btn title="Εφαρμογή κάδρου">
                                <span class="icon-check" aria-hidden="true"></span> <span>Εφαρμογή</span>
                            </button>
                        </div>
                    </div>

                    <div class="modal-body position-relative">
                        <div class="smartcrop-viewport-wrapper">
                            <div class="smartcrop-viewport" data-smartcrop-viewport style="aspect-ratio: ${firstRatio.width} / ${firstRatio.height}; max-width: ${maxWidth}px;">
                                <div class="smartcrop-corner tl" aria-hidden="true"></div>
                                <div class="smartcrop-corner tr" aria-hidden="true"></div>
                                <div class="smartcrop-corner bl" aria-hidden="true"></div>
                                <div class="smartcrop-corner br" aria-hidden="true"></div>
                                
                                <button type="button" class="smartcrop-viewfinder-badge" data-smartcrop-ratio-badge title="Κλικ για αλλαγή αναλογίας" aria-label="Αλλαγή αναλογίας">
                                    <span data-smartcrop-ratio-text>📐 ${firstRatio.width}:${firstRatio.height} (${firstRatio.label})</span>
                                    <span class="smartcrop-caret" aria-hidden="true">▾</span>
                                </button>

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

                        <div class="smartcrop-ratio-dropdown d-none" data-smartcrop-ratio-dropdown></div>

                        <div class="smartcrop-toolbar d-flex align-items-center justify-content-between gap-2 mt-2 px-1" data-smartcrop-toolbar>
                            <div class="smartcrop-zoom-controls d-flex align-items-center gap-2 flex-grow-1">
                                <button type="button" class="btn btn-sm btn-outline-secondary p-1" style="width: 28px; height: 28px; line-height: 1;" data-smartcrop-zoom-out title="Σμίκρυνση"><span class="icon-minus" aria-hidden="true"></span></button>
                                <div class="position-relative flex-grow-1">
                                    <input type="range" class="form-range smartcrop-zoom-slider mb-0" min="0.05" max="3.0" step="0.01" value="1.0" list="smartcrop-zoom-ticks" data-smartcrop-zoom-slider aria-label="Ζουμ" />
                                    <datalist id="smartcrop-zoom-ticks">
                                        <option value="0.25" label="25%"></option>
                                        <option value="0.5" label="50%"></option>
                                        <option value="0.75" label="75%"></option>
                                        <option value="1.0" label="100%"></option>
                                        <option value="1.25" label="125%"></option>
                                        <option value="1.5" label="150%"></option>
                                        <option value="2.0" label="200%"></option>
                                        <option value="3.0" label="300%"></option>
                                    </datalist>
                                </div>
                                <button type="button" class="btn btn-sm btn-outline-secondary p-1" style="width: 28px; height: 28px; line-height: 1;" data-smartcrop-zoom-in title="Μεγέθυνση"><span class="icon-plus" aria-hidden="true"></span></button>
                                <span class="smartcrop-zoom-value badge bg-secondary-subtle text-body border" data-smartcrop-zoom-value style="min-width: 48px; text-align: center;">100%</span>
                                <button type="button" class="btn btn-sm btn-outline-secondary p-1 smartcrop-btn-center" data-smartcrop-center title="Κεντράρισμα εικόνας" aria-label="Κεντράρισμα εικόνας" style="width: 28px; height: 28px; line-height: 1;">
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align: middle;">
                                        <circle cx="12" cy="12" r="7"></circle>
                                        <line x1="12" y1="1" x2="12" y2="5"></line>
                                        <line x1="12" y1="19" x2="12" y2="23"></line>
                                        <line x1="1" y1="12" x2="5" y2="12"></line>
                                        <line x1="19" y1="12" x2="23" y2="12"></line>
                                        <circle cx="12" cy="12" r="1.5" fill="currentColor"></circle>
                                    </svg>
                                </button>
                            </div>

                            <div class="d-flex align-items-center gap-2">
                                <button type="button" class="btn btn-sm btn-outline-secondary smartcrop-btn-reset" data-smartcrop-reset title="Επαναφορά"><span class="icon-loop" aria-hidden="true"></span> <span>Επαναφορά</span></button>
                            </div>
                        </div>

                        <div class="smartcrop-live-coords-discreet d-flex justify-content-end mt-1 px-1" data-smartcrop-live-coords-bar>
                            <small class="text-muted font-monospace" style="font-size: 0.72rem;" data-smartcrop-live-coords>-</small>
                        </div>
                    </div>
                </div>
            </div>`;
        return div;
    }

    static openCustom(options = {}) {
        const profile = options.profile || 'universal';
        const targetDoc = options.document
            || options.previewElement?.ownerDocument
            || options.targetElement?.ownerDocument
            || (typeof document !== 'undefined' ? document : null);
        SmartCropManager.ensureStylesInDocument(targetDoc);
        const modalEl = SmartCropManager.ensureModal(profile, targetDoc);
        if (!modalEl._smartcropController) {
            modalEl._smartcropController = new SmartCropModalController(modalEl);
        }
        modalEl._smartcropController.attachCustom(options);
        modalEl._smartcropController.openModal();
        return modalEl._smartcropController;
    }

    static applyFramingToElement(container, cropResult, imageUrl) {
        if (!container) return;
        // Do NOT apply custom framing to native Joomla media fields that are already managed by updateFieldPreview
        if (container.closest?.('.sb-native-preview-host, .field-media-preview, joomla-field-media') ||
            container.querySelector?.('.smartcrop-preview-frame, .smartcrop-preview-clip')) {
            return;
        }

        const visual = container.classList?.contains('resource-lightweight-visual')
            ? container
            : container.querySelector?.('.resource-lightweight-visual');
        if (visual) {
            return SmartCropManager.applySmartBrowserVisualFraming(visual, cropResult, imageUrl);
        }

        const img = container.tagName === 'IMG' ? container : container.querySelector('img:not(.smartcrop-preview-ghost)');
        if (!img) return;

        const crop = cropResult?.crop || cropResult;
        if (!crop) return;

        let normX = Number(crop.x) || 0;
        let normY = Number(crop.y) || 0;
        let normW = Number(crop.width) || 1;
        let normH = Number(crop.height) || 1;

        if (normW <= 1.0001 && normX >= -0.0001) {
            normX = Math.max(0, Math.min(1, normX));
            normW = Math.max(0.0001, Math.min(1 - normX, normW));
        } else {
            normW = Math.max(0.0001, Math.min(25.0, normW));
            normX = Math.max(-25.0, Math.min(1.0, normX));
        }

        if (normH <= 1.0001 && normY >= -0.0001) {
            normY = Math.max(0, Math.min(1, normY));
            normH = Math.max(0.0001, Math.min(1 - normY, normH));
        } else {
            normH = Math.max(0.0001, Math.min(25.0, normH));
            normY = Math.max(-25.0, Math.min(1.0, normY));
        }

        const scaleX = 1.0 / normW;
        const scaleY = 1.0 / normH;

        const widthPct  = (scaleX * 100.0).toFixed(4);
        const heightPct = (scaleY * 100.0).toFixed(4);
        const leftPct   = (-(normX / normW) * 100.0).toFixed(4);
        const topPct    = (-(normY / normH) * 100.0).toFixed(4);

        const visualBox = container.tagName === 'IMG' ? container.parentElement : container;
        visualBox.classList.add('smartcrop-preview-frame', 'is-cropped');
        visualBox.style.setProperty('position', 'relative', 'important');
        visualBox.style.setProperty('overflow', 'hidden', 'important');

        const cleanSrc = imageUrl || img.currentSrc || img.src || '';

        // Ensure ghost image layer exists behind cropped image
        let ghost = visualBox.querySelector('.smartcrop-preview-ghost');
        if (!ghost) {
            ghost = document.createElement('img');
            ghost.className = 'smartcrop-preview-ghost';
            ghost.alt = '';
            ghost.setAttribute('aria-hidden', 'true');
            visualBox.insertBefore(ghost, img);
        }
        if (cleanSrc && ghost.src !== cleanSrc) {
            ghost.src = cleanSrc;
        }

        // Apply positioning to active image
        img.style.setProperty('position', 'absolute', 'important');
        img.style.setProperty('left', `${leftPct}%`, 'important');
        img.style.setProperty('top', `${topPct}%`, 'important');
        img.style.setProperty('width', `${widthPct}%`, 'important');
        img.style.setProperty('height', `${heightPct}%`, 'important');
        img.style.setProperty('max-width', 'none', 'important');
        img.style.setProperty('max-height', 'none', 'important');
        img.style.setProperty('display', 'block', 'important');
        img.style.setProperty('object-fit', 'fill', 'important');
        img.style.setProperty('pointer-events', 'none', 'important');

        // Apply identical positioning to ghost layer behind it
        ghost.style.removeProperty('display');
        ghost.style.setProperty('position', 'absolute', 'important');
        ghost.style.setProperty('left', `${leftPct}%`, 'important');
        ghost.style.setProperty('top', `${topPct}%`, 'important');
        ghost.style.setProperty('width', `${widthPct}%`, 'important');
        ghost.style.setProperty('height', `${heightPct}%`, 'important');
        ghost.style.setProperty('max-width', 'none', 'important');
        ghost.style.setProperty('max-height', 'none', 'important');
        ghost.style.setProperty('display', 'block', 'important');
        ghost.style.setProperty('object-fit', 'fill', 'important');
        ghost.style.setProperty('pointer-events', 'none', 'important');

        // Bind hover preview to adjacent crop buttons (e.g. SmartBrowser preview action button)
        const parentArea = visualBox.closest('.resource-lightweight-area, .sb-selected-panel, .resource-info-panel, .control-group') || visualBox.parentElement;
        if (parentArea) {
            const actionBtns = parentArea.querySelectorAll('button[title*="SmartCrop"], button[aria-label*="SmartCrop"], [data-action="smartcrop.crop"], .smartcrop-preview-btn');
            actionBtns.forEach((btn) => {
                if (!btn._smartcropHoverBound) {
                    btn._smartcropHoverBound = true;
                    btn.addEventListener('mouseenter', () => {
                        visualBox.classList.add('is-revealing-ghost');
                        parentArea.classList.add('is-revealing-ghost');
                    });
                    btn.addEventListener('mouseleave', () => {
                        visualBox.classList.remove('is-revealing-ghost');
                        parentArea.classList.remove('is-revealing-ghost');
                    });
                }
            });
        }
    }

    static clearFramingFromElement(container) {
        if (!container) return;
        const visual = container.classList?.contains('resource-lightweight-visual')
            ? container
            : container.querySelector?.('.resource-lightweight-visual');
        if (visual) {
            return SmartCropManager.clearSmartBrowserVisualFraming(visual);
        }

        const visualBox = container.tagName === 'IMG' ? container.parentElement : container;
        visualBox.classList.remove('is-cropped', 'is-revealing-ghost');
        visualBox.style.removeProperty('overflow');

        const ghost = visualBox.querySelector('.smartcrop-preview-ghost');
        if (ghost) {
            ghost.style.setProperty('display', 'none', 'important');
        }

        const img = visualBox.querySelector('img:not(.smartcrop-preview-ghost)');
        if (img) {
            img.style.removeProperty('position');
            img.style.removeProperty('left');
            img.style.removeProperty('top');
            img.style.removeProperty('width');
            img.style.removeProperty('height');
            img.style.removeProperty('max-width');
            img.style.removeProperty('max-height');
            img.style.removeProperty('object-fit');
            img.style.removeProperty('pointer-events');
        }
    }

    static appendCropToJoomlaUri(val, ...args) {
        val = String(val || '').trim();
        if (!val) return '';
        if (args.length === 0) return val;

        let x = 0, y = 0, w = 1, h = 1, zoom = 1.0, rw = 4, rh = 3;
        if (typeof args[0] === 'object' && args[0] !== null) {
            const cropResult = args[0];
            const crop = cropResult.crop || cropResult;
            x = Number(crop.x) || 0;
            y = Number(crop.y) || 0;
            w = Number(crop.width) || 1;
            h = Number(crop.height) || 1;
            zoom = Number(cropResult.zoom) || 1.0;
            if (cropResult.ratio && typeof cropResult.ratio === 'object') {
                rw = cropResult.ratio.width || 4;
                rh = cropResult.ratio.height || 3;
            } else if (typeof cropResult.ratio === 'string' && /[:/xX_]/.test(cropResult.ratio)) {
                const parts = cropResult.ratio.replace(/[xX/_]/g, ':').split(':');
                rw = parseFloat(parts[0]) || 4;
                rh = parseFloat(parts[1]) || 3;
            }
        } else {
            x = Number(args[0]) || 0;
            y = Number(args[1]) || 0;
            w = Number(args[2]) || 1;
            h = Number(args[3]) || 1;
            zoom = args[4] != null ? Number(args[4]) : 1.0;
            rw = args[5] != null ? Number(args[5]) : 4;
            rh = args[6] != null ? Number(args[6]) : 3;
        }

        return SmartCropModalController.prototype.updateUriWithCrop.call(
            null,
            val,
            Number(x.toFixed(4)),
            Number(y.toFixed(4)),
            Number(w.toFixed(4)),
            Number(h.toFixed(4)),
            Number(zoom.toFixed(2)),
            rw,
            rh
        );
    }

    static cleanCropFromJoomlaUri(val) {
        val = String(val || '').trim();
        if (!val) return '';
        return SmartCropModalController.prototype.removeCropFromUri.call(null, val);
    }

    /**
     * Public resolver for frontend consumers to obtain crop presentation calculations
     * for a final rendered image given extension metadata (ext.smartcrop.crop, usage dictionary, or JSON).
     *
     * Adheres to the exact coordinate normalization, clamping, and zoom conventions used by the editor.
     * Verifies that the crop metadata matches the target image's canonical identity.
     * If the image was changed (e.g. Intro Image changed on an article), the crop is recognized
     * as stale and null is returned, preventing the old crop from being applied to the new image.
     *
     * @param   {string|object} finalImage    The final resolved image being rendered (path or URL)
     * @param   {object|string} cropMetadata  Metadata from ext.smartcrop.crop, parent usage dictionary, or JSON string
     * @returns {object|null} Presentation dictionary, or null if no crop / invalid / source mismatch
     */
    static resolveCropPresentation(finalImage, cropMetadata) {
        if (!finalImage || !cropMetadata) return null;

        const normFinal = SmartCropManager.normalizeSource(finalImage);
        if (!normFinal) return null;

        let payload = cropMetadata;
        if (typeof payload === 'string') {
            payload = payload.trim();
            if (payload.startsWith('{') || payload.startsWith('[')) {
                try { payload = JSON.parse(payload); } catch (e) {}
            } else if (payload.includes('#') || payload.includes('?')) {
                let qStr = '';
                const hashPos = payload.indexOf('#');
                if (hashPos !== -1) {
                    const frag = payload.substring(hashPos + 1);
                    const qPos = frag.indexOf('?');
                    if (qPos !== -1) qStr = frag.substring(qPos + 1);
                }
                if (!qStr) {
                    const qPos = payload.indexOf('?');
                    if (qPos !== -1) qStr = payload.substring(qPos + 1);
                }
                if (qStr) {
                    const qp = {};
                    qStr.split('&').forEach(pair => {
                        if (!pair) return;
                        const [k, v] = pair.split('=');
                        qp[decodeURIComponent(k)] = v ? decodeURIComponent(v) : '';
                    });
                    payload = qp;
                }
            }
        }

        if (!payload || typeof payload !== 'object') return null;

        // Unwrap nested metadata keys
        if (payload['ext.smartcrop.crop'] && typeof payload['ext.smartcrop.crop'] === 'object') {
            payload = payload['ext.smartcrop.crop'];
        } else if (payload['ext.smartcrop.crop'] && typeof payload['ext.smartcrop.crop'] === 'string') {
            try { payload = JSON.parse(payload['ext.smartcrop.crop']); } catch (e) {}
        } else if (payload['smartcrop.crop'] && typeof payload['smartcrop.crop'] === 'object') {
            payload = payload['smartcrop.crop'];
        } else if (payload?.usage?.['ext.smartcrop.crop']) {
            payload = payload.usage['ext.smartcrop.crop'];
        }

        // Resolve potential compound alias (e.g. smartcrop=sc or crop=c with .coords, .ratio, .src, .zoom)
        let alias = null;
        if (typeof payload.smartcrop === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(payload.smartcrop)) {
            alias = payload.smartcrop;
        } else if (typeof payload.crop === 'string' && payload.crop !== 'original' && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(payload.crop)) {
            alias = payload.crop;
        }

        let cropRaw = null;
        if (alias) {
            cropRaw = payload[`${alias}.coords`] || payload[`${alias}_coords`];
        }
        if (!cropRaw) {
            cropRaw = payload.crop || payload.coords || payload['sc.coords'] || payload['sc_coords'] || payload['c.coords'] || payload['c_coords'];
        }

        if (typeof cropRaw === 'string') {
            const normalizedCropRaw = cropRaw.trim().replace(/(\d)-/g, '$1,');
            const coords = normalizedCropRaw.split(/[,_~]+/).map(Number);
            if (coords.length === 4 && !coords.some(isNaN)) {
                cropRaw = { x: coords[0], y: coords[1], width: coords[2], height: coords[3] };
            }
        }

        if (!cropRaw || typeof cropRaw !== 'object' || cropRaw.width == null || cropRaw.height == null) {
            return null;
        }

        // Source Identity Matching
        let expectedSource = '';
        if (alias) {
            expectedSource = payload[`${alias}.src`] || payload[`${alias}_src`] || payload[`${alias}.source`];
        }
        if (!expectedSource) {
            expectedSource = payload.source || payload.src || payload['sc.src'] || payload['sc_src'] || payload['c.src'] || payload['c_src'] || '';
        }
        if (!expectedSource && typeof cropMetadata === 'string') {
            const trimmedMeta = cropMetadata.trim();
            const beforeQuery = trimmedMeta.split(/[?#]/)[0] || '';
            const isImageUri = trimmedMeta.includes('#joomlaImage://')
                || /^file:/i.test(trimmedMeta)
                || (beforeQuery !== '' && !beforeQuery.startsWith('{') && !beforeQuery.includes('=') && !beforeQuery.includes(':') && (beforeQuery.includes('/') || beforeQuery.includes('.')));
            if (isImageUri) {
                const uriCandidateSource = SmartCropManager.normalizeSource(trimmedMeta);
                if (uriCandidateSource && !uriCandidateSource.includes(':')) {
                    expectedSource = uriCandidateSource;
                }
            }
        }

        if (expectedSource && typeof expectedSource === 'string' && expectedSource.trim() !== '') {
            const normExpected = SmartCropManager.normalizeSource(expectedSource);
            if (normExpected && normFinal !== normExpected) {
                // Source mismatch: image was changed or overridden!
                return null;
            }
        }

        // Extract Ratio
        let rw = 4;
        let rh = 3;
        let ratioRaw = alias ? (payload[`${alias}.ratio`] || payload[`${alias}_ratio`]) : null;
        if (!ratioRaw) {
            ratioRaw = payload.ratio || payload['sc.ratio'] || payload['sc_ratio'] || payload['c.ratio'] || payload['c_ratio'];
        }

        if (ratioRaw && typeof ratioRaw === 'object' && ratioRaw.width && ratioRaw.height) {
            rw = Number(ratioRaw.width) || 4;
            rh = Number(ratioRaw.height) || 3;
        } else if (typeof ratioRaw === 'string' && /[:/xX_]/.test(ratioRaw)) {
            const parts = ratioRaw.replace(/[xX/_]/g, ':').split(':');
            rw = parseFloat(parts[0]) || 4;
            rh = parseFloat(parts[1]) || 3;
        } else if (typeof ratioRaw === 'number' && ratioRaw > 0) {
            if (Math.abs(ratioRaw - 16 / 9) < 0.05) { rw = 16; rh = 9; }
            else if (Math.abs(ratioRaw - 4 / 3) < 0.05) { rw = 4; rh = 3; }
            else if (Math.abs(ratioRaw - 1) < 0.05) { rw = 1; rh = 1; }
            else if (Math.abs(ratioRaw - 3 / 2) < 0.05) { rw = 3; rh = 2; }
            else { rw = Math.round(ratioRaw * 100); rh = 100; }
        }

        // Extract Zoom
        let zoom = 1.0;
        let zoomRaw = alias ? (payload[`${alias}.zoom`] || payload[`${alias}_zoom`]) : null;
        if (!zoomRaw) {
            zoomRaw = payload.zoom || payload['sc.zoom'] || payload['sc_zoom'] || payload['c.zoom'] || payload['c_zoom'];
        }
        if (zoomRaw != null && !isNaN(zoomRaw)) {
            zoom = Math.max(0.05, Math.min(5.0, Number(zoomRaw)));
        }

        // Coordinate Normalization & Clamping (identical to editor)
        let normX = Number(cropRaw.x) || 0;
        let normY = Number(cropRaw.y) || 0;
        let normW = Number(cropRaw.width) || 1;
        let normH = Number(cropRaw.height) || 1;

        if (normW <= 1.0001 && normX >= -0.0001) {
            normX = Math.max(0, Math.min(1, normX));
            normW = Math.max(0.0001, Math.min(1 - normX, normW));
        } else {
            normW = Math.max(0.0001, Math.min(25.0, normW));
            normX = Math.max(-25.0, Math.min(1.0, normX));
        }

        if (normH <= 1.0001 && normY >= -0.0001) {
            normY = Math.max(0, Math.min(1, normY));
            normH = Math.max(0.0001, Math.min(1 - normY, normH));
        } else {
            normH = Math.max(0.0001, Math.min(25.0, normH));
            normY = Math.max(-25.0, Math.min(1.0, normY));
        }

        const scaleX = 1.0 / normW;
        const scaleY = 1.0 / normH;
        const widthPct  = parseFloat((scaleX * 100.0).toFixed(4));
        const heightPct = parseFloat((scaleY * 100.0).toFixed(4));
        const leftPct   = parseFloat((-(normX / normW) * 100.0).toFixed(4));
        const topPct    = parseFloat((-(normY / normH) * 100.0).toFixed(4));

        let focalX = parseFloat(((normX + normW / 2) * 100.0).toFixed(2));
        let focalY = parseFloat(((normY + normH / 2) * 100.0).toFixed(2));
        focalX = Math.max(0, Math.min(100, focalX));
        focalY = Math.max(0, Math.min(100, focalY));
        zoom = parseFloat(zoom.toFixed(3));

        const aspectRatioCss = `${rw} / ${rh}`;
        const ratioLabel     = `${rw}:${rh}`;

        const containerStyle = `position: relative; overflow: hidden; aspect-ratio: ${aspectRatioCss};`;
        const imageStyle     = `position: absolute !important; left: ${leftPct}% !important; top: ${topPct}% !important; width: ${widthPct}% !important; height: ${heightPct}% !important; right: auto !important; bottom: auto !important; max-width: none !important; max-height: none !important; object-fit: fill !important; transform: none !important; display: block !important;`;
        const cssVariables   = `--smartcrop-ratio: ${aspectRatioCss}; --smartcrop-left: ${leftPct}%; --smartcrop-top: ${topPct}%; --smartcrop-width: ${widthPct}%; --smartcrop-height: ${heightPct}%; --smartcrop-zoom: ${zoom}; --smartcrop-focal-x: ${focalX}%; --smartcrop-focal-y: ${focalY}%;`;

        const styleVars = {
            '--smartcrop-ratio': aspectRatioCss,
            '--smartcrop-left': `${leftPct}%`,
            '--smartcrop-top': `${topPct}%`,
            '--smartcrop-width': `${widthPct}%`,
            '--smartcrop-height': `${heightPct}%`,
            '--smartcrop-zoom': String(zoom),
            '--smartcrop-focal-x': `${focalX}%`,
            '--smartcrop-focal-y': `${focalY}%`,
        };

        return {
            is_cropped: true,
            crop: { x: normX, y: normY, width: normW, height: normH },
            ratio: {
                width: rw,
                height: rh,
                aspect_ratio: aspectRatioCss,
                decimal: parseFloat((rw / rh).toFixed(4)),
                label: ratioLabel,
            },
            zoom: zoom,
            focal: { x: focalX, y: focalY },
            values: {
                scale_x: parseFloat(scaleX.toFixed(4)),
                scale_y: parseFloat(scaleY.toFixed(4)),
                width_pct: widthPct,
                height_pct: heightPct,
                left_pct: leftPct,
                top_pct: topPct,
            },
            styles: {
                container: containerStyle,
                image: imageStyle,
                css_variables: cssVariables,
            },
            style_vars: styleVars,
            source: normFinal,
            image_url: SmartCropManager.resolveImageUrl(finalImage) || finalImage,
        };
    }

    static isCropApplicable(finalImage, cropMetadata) {
        return SmartCropManager.resolveCropPresentation(finalImage, cropMetadata) !== null;
    }

    static registerSelectionAddressCodec() {
        if (typeof window === 'undefined') return;
        if (SmartCropManager._selectionAddressRegistered) return;
        const api = window.SmartBrowser?.SelectionAddress;
        if (!api || typeof api.registerCodec !== 'function' || typeof api.registerProperty !== 'function') return;

        try {
            api.registerCodec('smartcrop', {
                encode(value) {
                    if (!value || typeof value !== 'object') return [];
                    const parts = [];
                    const crop = value.crop || value.coords;
                    if (crop) {
                        if (typeof crop === 'object') {
                            const x = Number(crop.x) || 0;
                            const y = Number(crop.y) || 0;
                            const w = Number(crop.width) || 1;
                            const h = Number(crop.height) || 1;
                            parts.push(['coords', `${x.toFixed(4)}-${y.toFixed(4)}-${w.toFixed(4)}-${h.toFixed(4)}`]);
                        } else {
                            parts.push(['coords', String(crop).trim().replace(/(\d),/g, '$1-')]);
                        }
                    }
                    const ratio = value.ratio;
                    if (ratio) {
                        if (typeof ratio === 'object' && ratio.width && ratio.height) {
                            parts.push(['ratio', `${ratio.width}x${ratio.height}`]);
                        } else {
                            parts.push(['ratio', String(ratio).trim().replace(/[:/]/g, 'x')]);
                        }
                    }
                    const zoom = Number(value.zoom);
                    if (zoom && Math.abs(zoom - 1.0) > 0.001) {
                        parts.push(['zoom', zoom.toFixed(2)]);
                    }
                    const src = value.source || value.src;
                    if (src) {
                        parts.push(['src', SmartCropManager.normalizeSource(src)]);
                    }
                    if (!parts.length) {
                        parts.push(['coords', 'original']);
                    }
                    return parts;
                },
                decode(parts) {
                    const map = Object.fromEntries(parts);
                    let crop = null;
                    if (map.coords && map.coords !== 'original') {
                        const normalizedCoords = String(map.coords).trim().replace(/(\d)-/g, '$1,');
                        const coords = normalizedCoords.split(/[,_~]+/).map(Number);
                        if (coords.length === 4 && !coords.some(isNaN)) {
                            crop = { x: coords[0], y: coords[1], width: coords[2], height: coords[3] };
                        }
                    }
                    let ratio = null;
                    if (map.ratio && /[:/xX_]/.test(String(map.ratio))) {
                        const rParts = String(map.ratio).replace(/[xX/_]/g, ':').split(':').map(Number);
                        if (rParts.length === 2 && !rParts.some(isNaN)) {
                            ratio = { width: rParts[0], height: rParts[1], label: `${rParts[0]}:${rParts[1]}` };
                        }
                    }
                    let src = '';
                    if (map.src) {
                        try {
                            src = decodeURIComponent(map.src);
                        } catch (e) {
                            src = map.src;
                        }
                    }
                    return {
                        value: {
                            source: src,
                            crop: crop || map.coords || '',
                            ratio: ratio || map.ratio || '',
                            zoom: map.zoom ? parseFloat(map.zoom) : 1.0
                        }
                    };
                }
            });

            api.registerProperty({
                key: 'ext.smartcrop.crop',
                type: 'object',
                editor: 'none',
                address: { name: 'smartcrop', codec: 'smartcrop', alias: 'sc' }
            });

            SmartCropManager._selectionAddressRegistered = true;
        } catch (e) {
            console.warn('[SmartCrop] registerSelectionAddressCodec error:', e);
            SmartCropManager._selectionAddressRegistered = true;
        }
    }

    static getActiveCrop(context, targetImageUrl = null) {
        if (!context) return null;

        const res = context.resource || {};
        const values = (typeof context.getValues === 'function' ? context.getValues() : (context.values || context.usage || context.selection?.usage)) || {};
        const allMeta = (typeof context.getMetadata === 'function' ? context.getMetadata() : (context.metadata || context.selection?.metadata)) || {};
        const resolvedImg = context.resolvedImage || res.effectiveThumbnailResource || null;
        const primaryImg = (typeof context.getImageElement === 'function' ? context.getImageElement() : null) || context.imageElement;
        const domSrc = primaryImg ? (primaryImg.getAttribute?.('src') || primaryImg.src || '') : '';

        const imgUrl = targetImageUrl || context.imageUrl || SmartCropManager.resolveResourceThumbnailUrl(context);

        let explicitlyCleared = false;
        if (typeof context.getMetadata === 'function') {
            const directMeta = context.getMetadata('smartcrop.crop');
            if (directMeta === null || directMeta === false) {
                explicitlyCleared = true;
            }
        }
        if (!explicitlyCleared && allMeta && typeof allMeta === 'object') {
            if (('smartcrop.crop' in allMeta && (allMeta['smartcrop.crop'] === null || allMeta['smartcrop.crop'] === false))
                || ('ext.smartcrop.crop' in allMeta && (allMeta['ext.smartcrop.crop'] === null || allMeta['ext.smartcrop.crop'] === false))) {
                explicitlyCleared = true;
            }
        }
        if (!explicitlyCleared && values && typeof values === 'object') {
            if (('smartcrop.crop' in values && (values['smartcrop.crop'] === null || values['smartcrop.crop'] === false))
                || ('ext.smartcrop.crop' in values && (values['ext.smartcrop.crop'] === null || values['ext.smartcrop.crop'] === false))) {
                explicitlyCleared = true;
            }
        }

        const compounds = values?.['ext.selectionAddress']?.compounds || {};
        const rawThumbOverride = values?.['visual.thumbnailOverride'] || compounds['visual.thumbnailOverride'];
        let overrideImage = '';
        if (typeof rawThumbOverride === 'string') {
            overrideImage = rawThumbOverride.trim();
        } else if (rawThumbOverride && typeof rawThumbOverride === 'object') {
            overrideImage = String(rawThumbOverride.image || rawThumbOverride.url || rawThumbOverride.id || '').trim();
        }
        let hasThumbnailOverride = Boolean(overrideImage);

        let imagesData = null;
        if (res.images) {
            try {
                imagesData = typeof res.images === 'string' ? JSON.parse(res.images) : res.images;
            } catch (e) {}
        }

        const indigenousSource = String(
            res.image
            || res.metadata?.image
            || imagesData?.image_intro
            || imagesData?.image_fulltext
            || (!hasThumbnailOverride ? (res.thumbnail || res.metadata?.thumbnail || res.metadata?.poster || res.metadata?.url || res.url || (res.type === 'image' ? res.id : '')) : '')
            || ''
        ).trim();

        if (!hasThumbnailOverride && indigenousSource && imgUrl) {
            const normIndig = SmartCropManager.normalizeSource(indigenousSource);
            const normTarget = SmartCropManager.normalizeSource(imgUrl);
            if (normIndig && normTarget && normIndig !== normTarget) {
                hasThumbnailOverride = true;
            }
        }

        const hasUriCropParams = (val) => typeof val === 'string' && (val.includes('crop=') || val.includes('.coords=') || val.includes('_coords='));

        const acceptCandidate = (rawCand, fallbackSource = '') => {
            if (!rawCand) return null;
            let candObj = rawCand;
            if (typeof candObj === 'string') {
                const trimmed = candObj.trim();
                if (!trimmed) return null;
                if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                    try { candObj = JSON.parse(trimmed); } catch (e) { return null; }
                } else if (hasUriCropParams(trimmed)) {
                    candObj = SmartCropManager.extractCropFromValue(trimmed);
                } else {
                    return null;
                }
            }
            if (!candObj || typeof candObj !== 'object') return null;

            // Unwrap nested usage/extension keys if needed
            if (candObj['ext.smartcrop.crop'] && typeof candObj['ext.smartcrop.crop'] === 'object') {
                candObj = candObj['ext.smartcrop.crop'];
            } else if (candObj['smartcrop.crop'] && typeof candObj['smartcrop.crop'] === 'object') {
                candObj = candObj['smartcrop.crop'];
            }

            const crop = candObj.crop || candObj;
            if (!crop || typeof crop !== 'object' || crop.width == null || crop.height == null) {
                return null;
            }

            let candidateWithSource = candObj;
            if (!candObj.source && !candObj.src && fallbackSource) {
                candidateWithSource = { ...candObj, source: fallbackSource };
            }

            if (imgUrl && !SmartCropManager.isCropMatchingSource(candidateWithSource, imgUrl)) {
                return null;
            }

            return candidateWithSource;
        };

        // 1. Explicit extension metadata (getMetadata / values)
        const directMetaVal = typeof context.getMetadata === 'function' ? context.getMetadata('smartcrop.crop') : null;
        const extCandidates = [
            directMetaVal,
            allMeta?.['smartcrop.crop'],
            allMeta?.['ext.smartcrop.crop'],
            allMeta?.crop,
            values?.['ext.smartcrop.crop'],
            values?.['smartcrop.crop'],
        ];
        for (const cand of extCandidates) {
            const accepted = acceptCandidate(cand);
            if (accepted) return accepted;
        }

        // 2. Direct resolved imageAddress / imageUrl / DOM src containing crop parameters
        for (const uriCand of [context.imageAddress, context.imageUrl, domSrc]) {
            if (hasUriCropParams(uriCand)) {
                const accepted = acceptCandidate(uriCand);
                if (accepted) return accepted;
            }
        }

        // 3. Thumbnail override compounds & values
        const overrideCandidates = [
            compounds['visual.thumbnailOverride'],
            values?.['visual.thumbnailOverride'],
            res.effectiveImageAddress,
        ];
        if (compounds && typeof compounds === 'object') {
            Object.values(compounds).forEach((cv) => {
                if (hasUriCropParams(cv)) overrideCandidates.push(cv);
            });
        }
        for (const ovCand of overrideCandidates) {
            const accepted = acceptCandidate(ovCand);
            if (accepted) return accepted;
        }

        // 4. Selection Address (smartcrop=sc or crop=c)
        const addressCandidates = [
            typeof context.getAddress === 'function' ? context.getAddress() : null,
            typeof context.getSelectionAddress === 'function' ? context.getSelectionAddress() : null,
            context.address,
            context.selection?.address,
            values?.['ext.address'],
        ];
        for (const addrCand of addressCandidates) {
            if (hasUriCropParams(addrCand)) {
                const accepted = acceptCandidate(addrCand);
                if (accepted) return accepted;
            }
        }

        if (explicitlyCleared) {
            return null;
        }

        // 5. Resolved image resource (effectiveThumbnailResource) crop metadata
        if (resolvedImg && typeof resolvedImg === 'object') {
            const resImgSource = String(
                resolvedImg.image
                || resolvedImg.thumbnail
                || resolvedImg.metadata?.image
                || resolvedImg.metadata?.thumbnail
                || resolvedImg.metadata?.url
                || resolvedImg.url
                || (resolvedImg.type === 'image' ? resolvedImg.id : '')
                || ''
            ).trim();

            const resImgCandidates = [
                resolvedImg.imageCrop,
                resolvedImg.metadata?.imageCrop,
                resolvedImg.crop,
                resolvedImg.metadata?.crop,
                resolvedImg.smartcrop,
                resolvedImg.metadata?.smartcrop,
                resolvedImg.image,
                resolvedImg.metadata?.image,
                resolvedImg.thumbnail,
                resolvedImg.metadata?.thumbnail,
            ];
            for (const cand of resImgCandidates) {
                const accepted = acceptCandidate(cand, resImgSource);
                if (accepted) return accepted;
            }
        }

        // 6. Indigenous resource crop metadata (only if matching target image and not overridden by a different image)
        const indigenousCandidates = [
            res.imageCrop,
            res.metadata?.imageCrop,
            res.crop,
            res.metadata?.crop,
            res.smartcrop,
            res.metadata?.smartcrop,
        ];
        for (const cand of indigenousCandidates) {
            if (!cand) continue;
            if (typeof cand === 'object' && !cand.source && !cand.src && !indigenousSource && hasThumbnailOverride) {
                continue;
            }
            const accepted = acceptCandidate(cand, indigenousSource);
            if (accepted) return accepted;
        }

        const indigenousUris = [
            res.image,
            res.metadata?.image,
            imagesData?.image_intro,
            imagesData?.image_fulltext,
        ];
        if (!hasThumbnailOverride) {
            indigenousUris.push(res.thumbnail, res.metadata?.thumbnail, res.id);
        }
        for (const uriCand of indigenousUris) {
            if (hasUriCropParams(uriCand)) {
                const accepted = acceptCandidate(uriCand, indigenousSource);
                if (accepted) return accepted;
            }
        }

        if (imagesData?.smartcrop) {
            try {
                const sc = typeof imagesData.smartcrop === 'string' ? JSON.parse(imagesData.smartcrop) : imagesData.smartcrop;
                const profiles = sc?.profiles || {};
                const prof = profiles.default || profiles.intro || profiles.fulltext || null;
                if (prof) {
                    const accepted = acceptCandidate(prof, prof.source || indigenousSource);
                    if (accepted) return accepted;
                }
            } catch (e) {}
        }

        // 7. Check native media input only if context field is a native image field
        const isNativeImageField = context.fieldElement?.hasAttribute?.('data-sb-article-media') ||
                                   context.fieldElement?.closest?.('[data-sb-native-media], .sb-article-image-field, joomla-field-media');
        if (isNativeImageField) {
            const nativeInp = context.fieldElement?.closest?.('form, body')?.querySelector?.('input[name="jform[images][image_intro]"], input[name="jform[images][image_fulltext]"]');
            if (nativeInp && nativeInp.value && hasUriCropParams(nativeInp.value)) {
                const accepted = acceptCandidate(nativeInp.value);
                if (accepted) return accepted;
            }
        }

        return null;
    }

    static isCropMatchingSource(cropObj, sourceUrl) {
        if (!cropObj || !sourceUrl) return true;
        const activeSource = cropObj?.source || cropObj?.src || '';
        if (!activeSource) return true;
        const normActive = SmartCropManager.normalizeSource(activeSource);
        const normCur = SmartCropManager.normalizeSource(sourceUrl);
        if (normActive && normCur && normActive !== normCur) {
            return false;
        }
        return true;
    }

    static registerSmartBrowserImagePresentation() {
        if (typeof window === 'undefined') return;
        if (window._smartcropSbPresentationRegistered) return;

        const doRegister = () => {
            SmartCropManager.registerSelectionAddressCodec();
            if (!window.SmartBrowserPicker || typeof window.SmartBrowserPicker.registerImagePresentation !== 'function') {
                return false;
            }
            if (window._smartcropSbPresentationRegistered) return true;

            try {
                window.SmartBrowserPicker.registerImagePresentation({
                    id: 'smartcrop.presentation',
                    order: 100,
                    styles: [
                        'aspect-ratio',
                        'position',
                        'left',
                        'top',
                        'width',
                        'height',
                        'max-width',
                        'max-height',
                        'object-fit',
                        'pointer-events'
                    ],
                    applies: (context) => {
                        if (!context || (!context.resource && !context.imageUrl && !context.resolvedImage)) return false;
                        const imgEl = (typeof context.getImageElement === 'function' ? context.getImageElement() : null) || context.imageElement;
                        if (imgEl?.getAttribute?.('data-sb-image-presentation') === 'server') {
                            return false;
                        }
                        const imgUrl = context.imageUrl || SmartCropManager.resolveResourceThumbnailUrl(context);
                        const cropObj = SmartCropManager.getActiveCrop(context, imgUrl);
                        if (!cropObj) return false;
                        const crop = cropObj?.crop || cropObj;
                        if (!crop || typeof crop !== 'object' || !crop.width || !crop.height) {
                            return false;
                        }
                        return SmartCropManager.isCropMatchingSource(cropObj, imgUrl);
                    },
                    hasChanges: (context) => {
                        if (!context || (!context.resource && !context.imageUrl && !context.resolvedImage)) return false;
                        const imgUrl = context.imageUrl || SmartCropManager.resolveResourceThumbnailUrl(context);
                        const cropObj = SmartCropManager.getActiveCrop(context, imgUrl);
                        if (!cropObj) return false;
                        const crop = cropObj?.crop || cropObj;
                        if (!crop || typeof crop !== 'object' || !crop.width || !crop.height) {
                            return false;
                        }
                        return SmartCropManager.isCropMatchingSource(cropObj, imgUrl);
                    },
                    reset: async (context) => {
                        const imgEl = (typeof context?.getImageElement === 'function' ? context.getImageElement() : null) || context?.imageElement;
                        imgEl?.removeAttribute?.('data-sb-image-presentation');

                        if (typeof context.setMetadata === 'function') {
                            try { await context.setMetadata('smartcrop.crop', null); } catch (e) {}
                        } else if (typeof context.setValue === 'function') {
                            try { await context.setValue('ext.smartcrop.crop', null); } catch (e) {}
                        }
                        if (context.resource) {
                            delete context.resource.imageCrop;
                            delete context.resource.crop;
                        }
                        const curUrl = context.imageUrl || SmartCropManager.resolveResourceThumbnailUrl(context);
                        const initialSource = context.getAddress?.() || context.resource?.id || curUrl || '';
                        const isImageResource = context.resource?.type === 'image'
                            || (typeof initialSource === 'string' && (initialSource.includes('#joomlaImage://') || initialSource.startsWith('image/')));

                        if (isImageResource && typeof context.setAddress === 'function') {
                            const currentAddr = context.getAddress?.() || context.resource?.id || '';
                            const cleanJoomlaUri = SmartCropModalController.prototype.removeCropFromUri.call(null, currentAddr)
                                || currentAddr.split('#')[0].split('?')[0];
                            try { await context.setAddress(cleanJoomlaUri); } catch (e) {}
                            SmartCropManager.syncDirectToJoomlaFields(context, { uri: cleanJoomlaUri }, null);
                        } else {
                            SmartCropManager.syncDirectToJoomlaFields(context, null, null);
                        }

                        if (typeof context.notifyPresentationChange === 'function') {
                            try {
                                context.notifyPresentationChange({ reason: 'reset' });
                            } catch (e) {}
                        }
                    },
                    apply: (image, context) => {
                        if (!image || image.getAttribute?.('data-sb-image-presentation') === 'server') {
                            return;
                        }
                        const imgUrl = context?.imageUrl || SmartCropManager.resolveResourceThumbnailUrl(context);
                        const cropObj = SmartCropManager.getActiveCrop(context, imgUrl);
                        const crop = cropObj?.crop || cropObj;
                        if (!crop || !crop.width || !crop.height) return;

                        let rw = 4;
                        let rh = 3;
                        const ratio = cropObj?.ratio;
                        if (ratio && typeof ratio === 'object') {
                            rw = Number(ratio.width) || 4;
                            rh = Number(ratio.height) || 3;
                        } else if (typeof ratio === 'number' && ratio > 0) {
                            if (Math.abs(ratio - 16 / 9) < 0.05) { rw = 16; rh = 9; }
                            else if (Math.abs(ratio - 4 / 3) < 0.05) { rw = 4; rh = 3; }
                            else if (Math.abs(ratio - 1) < 0.05) { rw = 1; rh = 1; }
                            else if (Math.abs(ratio - 3 / 2) < 0.05) { rw = 3; rh = 2; }
                            else { rw = Math.round(ratio * 100); rh = 100; }
                        } else if (typeof ratio === 'string' && /[:/xX_]/.test(ratio)) {
                            const parts = ratio.replace(/[xX/_]/g, ':').split(':');
                            rw = parseFloat(parts[0]) || 4;
                            rh = parseFloat(parts[1]) || 3;
                        }

                        // Normalize coordinates
                        let normX = Number(crop?.x) || 0;
                        let normY = Number(crop?.y) || 0;
                        let normW = Number(crop?.width) || 1;
                        let normH = Number(crop?.height) || 1;

                        if (normW <= 1.0001 && normX >= -0.0001) {
                            normX = Math.max(0, Math.min(1, normX));
                            normW = Math.max(0.0001, Math.min(1 - normX, normW));
                        } else {
                            normW = Math.max(0.0001, Math.min(25.0, normW));
                            normX = Math.max(-25.0, Math.min(1.0, normX));
                        }

                        if (normH <= 1.0001 && normY >= -0.0001) {
                            normY = Math.max(0, Math.min(1, normY));
                            normH = Math.max(0.0001, Math.min(1 - normY, normH));
                        } else {
                            normH = Math.max(0.0001, Math.min(25.0, normH));
                            normY = Math.max(-25.0, Math.min(1.0, normY));
                        }

                        const scaleX = 1.0 / normW;
                        const scaleY = 1.0 / normH;
                        const widthPct  = (scaleX * 100.0).toFixed(4);
                        const heightPct = (scaleY * 100.0).toFixed(4);
                        const leftPct   = (-(normX / normW) * 100.0).toFixed(4);
                        const topPct    = (-(normY / normH) * 100.0).toFixed(4);

                        const aspectVal = `${rw} / ${rh}`;
                        image.style.setProperty('aspect-ratio', aspectVal);
                        image.style.setProperty('position', 'absolute', 'important');
                        image.style.setProperty('left', `${leftPct}%`, 'important');
                        image.style.setProperty('top', `${topPct}%`, 'important');
                        image.style.setProperty('width', `${widthPct}%`, 'important');
                        image.style.setProperty('height', `${heightPct}%`, 'important');
                        image.style.setProperty('max-width', 'none', 'important');
                        image.style.setProperty('max-height', 'none', 'important');
                        image.style.setProperty('object-fit', 'fill', 'important');
                        image.style.setProperty('pointer-events', 'none', 'important');

                        if (typeof context.notifyPresentationChange === 'function') {
                            try {
                                context.notifyPresentationChange({ reason: 'aspect-ratio' });
                            } catch (e) {}
                        }

                        return () => {
                            // Declared styles are automatically restored by SmartBrowser on cleanup
                        };
                    }
                });

                window._smartcropSbPresentationRegistered = true;
                return true;
            } catch (e) {
                console.warn('[SmartCrop] registerImagePresentation error:', e);
                return false;
            }
        };

        if (doRegister()) return;

        let retries = 0;
        const interval = setInterval(() => {
            retries++;
            if (doRegister() || retries > 30) {
                clearInterval(interval);
            }
        }, 100);
    }

    static registerSmartBrowserVisualOverlay() {
        if (typeof window === 'undefined') return;
        if (window._smartcropSbOverlayRegistered) return;

        const doRegister = () => {
            SmartCropManager.registerSelectionAddressCodec();
            if (!window.SmartBrowserPicker || typeof window.SmartBrowserPicker.registerVisualOverlay !== 'function') {
                return false;
            }
            if (window._smartcropSbOverlayRegistered) return true;

            try {
                window.SmartBrowserPicker.registerVisualOverlay({
                    id: 'smartcrop.framing',
                    order: 100,
                    applies: (context) => {
                        if (!context || !context.resource) {
                            return false;
                        }
                        // Never apply overlay when SmartBrowser explicitly declares native preview
                        if (context.nativePreview) {
                            return false;
                        }
                        // Only exclude if genuinely a native article-media field with an attached joomla-field-media
                        if (context.fieldElement?.hasAttribute?.('data-sb-article-media') &&
                            context.fieldElement?.querySelector?.('.sb-native-preview-host > joomla-field-media')) {
                            return false;
                        }
                        if (context.fieldElement?.closest?.('.sb-article-image-field, joomla-field-media')) {
                            return false;
                        }
                        // Support ANY resource that has a resolvable image thumbnail
                        const thumbUrl = SmartCropManager.resolveResourceThumbnailUrl(context);
                        return Boolean(thumbUrl);
                    },
                    mount(layer, context) {
                        SmartCropManager.registerSelectionAddressCodec();
                        let currentContext = context;
                        const visual = layer.closest('.resource-lightweight-visual');
                        const area = visual?.closest('.resource-lightweight-area');
                        const doc = layer.ownerDocument || document;
                        SmartCropManager.ensureStylesInDocument(doc);

                        // Create scissors preview button matching native Joomla media field style
                        const btn = doc.createElement('button');
                        btn.type = 'button';
                        btn.className = 'smartcrop-preview-btn';
                        btn.setAttribute('data-smartcrop-preview-btn', '');

                        let frame = null;
                        let clip = null;
                        let clipImg = null;
                        let ghost = null;
                        let resizeObserver = null;
                        let visualObserver = null;

                        const hasImagePresentation = typeof window.SmartBrowserPicker?.registerImagePresentation === 'function';

                        const updateGhostPosition = () => {
                            if (!ghost) return;
                            const curCtx = currentContext || context;
                            const primaryImg = (typeof curCtx.getImageElement === 'function' ? curCtx.getImageElement() : null)
                                || curCtx.imageElement
                                || visual?.querySelector('img:not(.smartcrop-preview-ghost):not(.smartcrop-cropped-preview)');
                            if (!primaryImg) return;

                            const imgRect = primaryImg.getBoundingClientRect();
                            const layerRect = layer.getBoundingClientRect();
                            if (imgRect.width > 0 && imgRect.height > 0) {
                                ghost.style.setProperty('position', 'absolute', 'important');
                                ghost.style.setProperty('left', `${imgRect.left - layerRect.left}px`, 'important');
                                ghost.style.setProperty('top', `${imgRect.top - layerRect.top}px`, 'important');
                                ghost.style.setProperty('width', `${imgRect.width}px`, 'important');
                                ghost.style.setProperty('height', `${imgRect.height}px`, 'important');
                                ghost.style.setProperty('object-fit', 'fill', 'important');
                                ghost.style.setProperty('pointer-events', 'none', 'important');
                                ghost.style.setProperty('z-index', '0', 'important');
                            }
                        };

                        const getImageUrl = () => {
                            const ctx = currentContext || context;
                            return SmartCropManager.resolveResourceThumbnailUrl(ctx, visual);
                        };

                        const getActiveCrop = () => {
                            const ctx = currentContext || context;
                            return SmartCropManager.getActiveCrop(ctx, getImageUrl());
                        };

                        const syncFraming = () => {
                            const ctx = currentContext || context;
                            let cropObj = getActiveCrop();
                            if (typeof cropObj === 'string' && (cropObj.startsWith('{') || cropObj.includes('crop='))) {
                                try {
                                    cropObj = JSON.parse(cropObj);
                                } catch (e) {
                                    cropObj = SmartCropManager.extractCropFromValue(cropObj);
                                }
                            }
                            const crop = cropObj?.crop || cropObj;
                            let isCropped = !!(crop && typeof crop === 'object' && crop.width && crop.height);
                            const imgUrl = getImageUrl();

                            // Source identity check: verify crop matches current image
                            const activeSource = cropObj?.source || cropObj?.src || '';
                            if (isCropped && activeSource && imgUrl) {
                                const normActive = SmartCropManager.normalizeSource(activeSource);
                                const normCur = SmartCropManager.normalizeSource(imgUrl);
                                if (normActive && normCur && normActive !== normCur) {
                                    // Image has changed! Stale crop does not apply to the new image.
                                    isCropped = false;
                                }
                            }

                            let rw = 4;
                            let rh = 3;
                            const ratio = cropObj?.ratio;
                            if (ratio && typeof ratio === 'object') {
                                rw = ratio.width || 4;
                                rh = ratio.height || 3;
                            } else if (typeof ratio === 'number' && ratio > 0) {
                                if (Math.abs(ratio - 16 / 9) < 0.05) { rw = 16; rh = 9; }
                                else if (Math.abs(ratio - 4 / 3) < 0.05) { rw = 4; rh = 3; }
                                else if (Math.abs(ratio - 1) < 0.05) { rw = 1; rh = 1; }
                                else if (Math.abs(ratio - 3 / 2) < 0.05) { rw = 3; rh = 2; }
                                else { rw = Math.round(ratio * 100); rh = 100; }
                            } else if (typeof ratio === 'string' && /[:/xX_]/.test(ratio)) {
                                const parts = ratio.replace(/[xX/_]/g, ':').split(':');
                                rw = parseFloat(parts[0]) || 4;
                                rh = parseFloat(parts[1]) || 3;
                            }
                            const ratioText = `${rw}:${rh}`;
                            const vueImg = visual?.querySelector('img:not(.smartcrop-preview-ghost):not(.smartcrop-cropped-preview)');

                            btn.disabled = !!ctx.isReadOnly;
                            if (!isCropped && ctx.isReadOnly) {
                                btn.style.setProperty('display', 'none', 'important');
                            } else {
                                btn.style.removeProperty('display');
                            }

                            // Normalize coordinates
                            let normX = Number(crop?.x) || 0;
                            let normY = Number(crop?.y) || 0;
                            let normW = Number(crop?.width) || 1;
                            let normH = Number(crop?.height) || 1;

                            if (normW <= 1.0001 && normX >= -0.0001) {
                                normX = Math.max(0, Math.min(1, normX));
                                normW = Math.max(0.0001, Math.min(1 - normX, normW));
                            } else {
                                normW = Math.max(0.0001, Math.min(25.0, normW));
                                normX = Math.max(-25.0, Math.min(1.0, normX));
                            }

                            if (normH <= 1.0001 && normY >= -0.0001) {
                                normY = Math.max(0, Math.min(1, normY));
                                normH = Math.max(0.0001, Math.min(1 - normY, normH));
                            } else {
                                normH = Math.max(0.0001, Math.min(25.0, normH));
                                normY = Math.max(-25.0, Math.min(1.0, normY));
                            }

                            const scaleX = 1.0 / normW;
                            const scaleY = 1.0 / normH;
                            const widthPct  = (scaleX * 100.0).toFixed(4);
                            const heightPct = (scaleY * 100.0).toFixed(4);
                            const leftPct   = (-(normX / normW) * 100.0).toFixed(4);
                            const topPct    = (-(normY / normH) * 100.0).toFixed(4);

                            const assetImageLayer = visual?.querySelector('.resource-visual-layer.asset-image') || vueImg?.closest('.resource-visual-layer');
                            const assetBaseLayer = visual?.querySelector('.resource-visual-layer.asset-base');
                            const visualContent = visual?.querySelector('.resource-visual-content');
                            const badge = visual?.querySelector('.resource-visual-layer.resource-node-visual-symbol, .resource-visual-layer.style-badge, .resource-visual-layer.asset-identity');

                            if (hasImagePresentation) {
                                if (frame) {
                                    frame.remove();
                                    frame = null;
                                    clip = null;
                                    clipImg = null;
                                }

                                if (isCropped) {
                                    btn.className = 'smartcrop-preview-btn is-cropped selected';
                                    btn.title = ctx.isReadOnly
                                        ? `Κάδρο (${ratioText}) [Μόνο για ανάγνωση] — Hover για ολόκληρη εικόνα`
                                        : `Επεξεργασία κάδρου (${ratioText}) — Hover για ολόκληρη εικόνα`;
                                    btn.setAttribute('aria-label', `Κάδρο (${ratioText})`);
                                    btn.innerHTML = `<span class="icon-scissors fas fa-crop-simple" aria-hidden="true"></span> <span>${ratioText}</span>`;

                                    if (!ghost) {
                                        ghost = doc.createElement('img');
                                        ghost.className = 'smartcrop-preview-ghost';
                                        ghost.alt = '';
                                        ghost.setAttribute('aria-hidden', 'true');
                                        ghost.draggable = false;
                                        layer.appendChild(ghost);
                                    }
                                    if (imgUrl && ghost.src !== imgUrl) {
                                        ghost.src = imgUrl;
                                    }
                                    updateGhostPosition();
                                } else {
                                    btn.className = 'smartcrop-preview-btn';
                                    btn.title = ctx.isReadOnly ? 'Ορισμός κάδρου (4:3) [Μόνο για ανάγνωση]' : 'Ορισμός κάδρου (4:3)';
                                    btn.setAttribute('aria-label', btn.title);
                                    btn.innerHTML = '<span class="icon-scissors fas fa-crop-simple" aria-hidden="true"></span> <span>4:3</span>';

                                    if (ghost) {
                                        ghost.remove();
                                        ghost = null;
                                    }
                                    if (visual) {
                                        visual.classList.remove('is-revealing-ghost');
                                    }
                                    if (area) {
                                        area.classList.remove('is-revealing-ghost');
                                    }
                                    layer.classList.remove('is-expanded-overlay', 'is-revealing-ghost');
                                }
                                return;
                            }

                            if (isCropped) {
                                btn.className = 'smartcrop-preview-btn is-cropped selected';
                                btn.title = ctx.isReadOnly
                                    ? `Κάδρο (${ratioText}) [Μόνο για ανάγνωση] — Hover για ολόκληρη εικόνα`
                                    : `Επεξεργασία κάδρου (${ratioText}) — Hover για ολόκληρη εικόνα`;
                                btn.setAttribute('aria-label', `Κάδρο (${ratioText})`);
                                btn.innerHTML = `<span class="icon-scissors fas fa-crop-simple" aria-hidden="true"></span> <span>${ratioText}</span>`;

                                const cropAspect = rw / rh;

                                if (assetImageLayer && vueImg) {
                                    // Direct styling of native SmartBrowser visual layers: sets percentage variables and crop styles
                                    const cardMax = 92;
                                    let cardW = cardMax;
                                    let cardH = Math.round((cardMax / cropAspect) * 100) / 100;
                                    let cardX = Math.round(((100 - cardW) / 2) * 100) / 100;
                                    let cardY = Math.round(((100 - cardH) / 2) * 100) / 100;
                                    if (cardH > cardMax) {
                                        cardH = cardMax;
                                        cardW = Math.round((cardMax * cropAspect) * 100) / 100;
                                        cardX = Math.round(((100 - cardW) / 2) * 100) / 100;
                                        cardY = Math.round(((100 - cardH) / 2) * 100) / 100;
                                    }

                                    // 1. Set SmartBrowser native layer CSS variables on assetImageLayer
                                    assetImageLayer.classList.add('has-image-crop');
                                    assetImageLayer.style.setProperty('--sb-visual-width', `${cardW}%`, 'important');
                                    assetImageLayer.style.setProperty('--sb-visual-height', `${cardH}%`, 'important');
                                    assetImageLayer.style.setProperty('--sb-visual-x', `${cardX}%`, 'important');
                                    assetImageLayer.style.setProperty('--sb-visual-y', `${cardY}%`, 'important');
                                    assetImageLayer.style.setProperty('--sb-crop-x', `${leftPct}%`, 'important');
                                    assetImageLayer.style.setProperty('--sb-crop-y', `${topPct}%`, 'important');
                                    assetImageLayer.style.setProperty('--sb-crop-width', `${widthPct}%`, 'important');
                                    assetImageLayer.style.setProperty('--sb-crop-height', `${heightPct}%`, 'important');
                                    assetImageLayer.style.setProperty('overflow', 'hidden', 'important');
                                    assetImageLayer.style.setProperty('z-index', '2', 'important');

                                    // 2. Base card (asset-base): shapes background card identically to 4:3
                                    if (assetBaseLayer) {
                                        assetBaseLayer.style.setProperty('--sb-visual-width', `${cardW}%`, 'important');
                                        assetBaseLayer.style.setProperty('--sb-visual-height', `${cardH}%`, 'important');
                                        assetBaseLayer.style.setProperty('--sb-visual-x', `${cardX}%`, 'important');
                                        assetBaseLayer.style.setProperty('--sb-visual-y', `${cardY}%`, 'important');
                                        assetBaseLayer.style.setProperty('z-index', '1', 'important');
                                    }

                                    // 3. Direct crop styles on the <img> element
                                    vueImg.style.setProperty('position', 'absolute', 'important');
                                    vueImg.style.setProperty('left', `${leftPct}%`, 'important');
                                    vueImg.style.setProperty('top', `${topPct}%`, 'important');
                                    vueImg.style.setProperty('width', `${widthPct}%`, 'important');
                                    vueImg.style.setProperty('height', `${heightPct}%`, 'important');
                                    vueImg.style.setProperty('max-width', 'none', 'important');
                                    vueImg.style.setProperty('max-height', 'none', 'important');
                                    vueImg.style.setProperty('object-fit', 'fill', 'important');
                                    vueImg.style.setProperty('opacity', '1', 'important');
                                    vueImg.style.setProperty('pointer-events', 'none', 'important');

                                    // 4. Badge anchoring at bottom-right corner of the cropped card
                                    if (badge) {
                                        const bW = (badge.offsetWidth && visualContent?.offsetWidth)
                                            ? Math.round((badge.offsetWidth / visualContent.offsetWidth) * 100)
                                            : 22;
                                        const bH = (badge.offsetHeight && visualContent?.offsetHeight)
                                            ? Math.round((badge.offsetHeight / visualContent.offsetHeight) * 100)
                                            : 22;
                                        const badgeX = Math.max(0, Math.min(100 - bW, Math.round(cardX + cardW - bW * 0.75)));
                                        const badgeY = Math.max(0, Math.min(100 - bH, Math.round(cardY + cardH - bH * 0.75)));
                                        badge.style.setProperty('--sb-visual-x', `${badgeX}%`, 'important');
                                        badge.style.setProperty('--sb-visual-y', `${badgeY}%`, 'important');
                                        badge.style.setProperty('z-index', '25', 'important');
                                        badge.style.setProperty('pointer-events', 'none', 'important');
                                    }

                                    if (frame) {
                                        frame.remove();
                                        frame = null;
                                        clip = null;
                                        clipImg = null;
                                        if (ghost) {
                                            ghost.remove();
                                            ghost = null;
                                        }
                                    }

                                    if (!ghost) {
                                        ghost = doc.createElement('img');
                                        ghost.className = 'smartcrop-preview-ghost';
                                        ghost.alt = '';
                                        ghost.setAttribute('aria-hidden', 'true');
                                        ghost.draggable = false;
                                        layer.appendChild(ghost);
                                    }
                                    if (imgUrl && ghost.src !== imgUrl) ghost.src = imgUrl;

                                    // Ghost Alignment relative to layer / visualContent
                                    const cRect = visualContent?.getBoundingClientRect();
                                    const lRect = layer.getBoundingClientRect();
                                    const contentLeft = (cRect && lRect) ? Math.max(0, cRect.left - lRect.left) : 0;
                                    const contentTop  = (cRect && lRect) ? Math.max(0, cRect.top - lRect.top) : 0;
                                    const contentW    = (cRect && cRect.width > 0) ? cRect.width : (layer.clientWidth || 150);
                                    const contentH    = (cRect && cRect.height > 0) ? cRect.height : (layer.clientHeight || 150);

                                    const cardPixelX = contentLeft + (cardX / 100) * contentW;
                                    const cardPixelY = contentTop + (cardY / 100) * contentH;
                                    const cardPixelW = (cardW / 100) * contentW;
                                    const cardPixelH = (cardH / 100) * contentH;

                                    const ghostW = Math.round(cardPixelW * scaleX);
                                    const ghostH = Math.round(cardPixelH * scaleY);
                                    const ghostLeft = Math.round(cardPixelX - (normX / normW) * cardPixelW);
                                    const ghostTop  = Math.round(cardPixelY - (normY / normH) * cardPixelH);

                                    ghost.style.setProperty('position', 'absolute', 'important');
                                    ghost.style.setProperty('left', `${ghostLeft}px`, 'important');
                                    ghost.style.setProperty('top', `${ghostTop}px`, 'important');
                                    ghost.style.setProperty('width', `${ghostW}px`, 'important');
                                    ghost.style.setProperty('height', `${ghostH}px`, 'important');
                                    ghost.style.setProperty('object-fit', 'fill', 'important');
                                    ghost.style.setProperty('pointer-events', 'none', 'important');
                                    ghost.style.setProperty('z-index', '0', 'important');
                                } else {
                                    // Fallback: visual does not have separate asset layers
                                    const visualW = visual?.clientWidth || layer.clientWidth || 150;
                                    const visualH = visual?.clientHeight || layer.clientHeight || 150;
                                    let frameW = visualW;
                                    let frameH = Math.round(visualW / cropAspect);
                                    if (frameH > visualH) {
                                        frameH = visualH;
                                        frameW = Math.round(visualH * cropAspect);
                                    }
                                    if (visual?.closest('.resource-info-panel')) {
                                        const maxW = Math.min(visualW, 140);
                                        const maxH = Math.min(visualH, 108);
                                        frameW = maxW;
                                        frameH = Math.round(maxW / cropAspect);
                                        if (frameH > maxH) {
                                            frameH = maxH;
                                            frameW = Math.round(maxH * cropAspect);
                                        }
                                    }
                                    const leftOffset = Math.max(0, Math.round((visualW - frameW) / 2));
                                    const topOffset  = Math.max(0, Math.round((visualH - frameH) / 2));

                                    if (!frame) {
                                        if (ghost) {
                                            ghost.remove();
                                            ghost = null;
                                        }
                                        frame = doc.createElement('div');
                                        frame.className = 'smartcrop-preview-frame is-cropped';

                                        clip = doc.createElement('div');
                                        clip.className = 'smartcrop-preview-clip';

                                        clipImg = doc.createElement('img');
                                        clipImg.className = 'smartcrop-cropped-preview';
                                        clipImg.alt = '';
                                        clipImg.draggable = false;
                                        clip.appendChild(clipImg);

                                        ghost = doc.createElement('img');
                                        ghost.className = 'smartcrop-preview-ghost';
                                        ghost.alt = '';
                                        ghost.setAttribute('aria-hidden', 'true');
                                        ghost.draggable = false;

                                        frame.appendChild(ghost);
                                        frame.appendChild(clip);
                                        layer.appendChild(frame);
                                    }

                                    if (imgUrl) {
                                        if (clipImg.src !== imgUrl) clipImg.src = imgUrl;
                                        if (ghost.src !== imgUrl) ghost.src = imgUrl;
                                    }

                                    frame.style.setProperty('position', 'absolute', 'important');
                                    frame.style.setProperty('left', `${leftOffset}px`, 'important');
                                    frame.style.setProperty('top', `${topOffset}px`, 'important');
                                    frame.style.setProperty('width', `${frameW}px`, 'important');
                                    frame.style.setProperty('height', `${frameH}px`, 'important');
                                    frame.style.setProperty('pointer-events', 'none', 'important');

                                    clipImg.style.setProperty('position', 'absolute', 'important');
                                    clipImg.style.setProperty('left', `${leftPct}%`, 'important');
                                    clipImg.style.setProperty('top', `${topPct}%`, 'important');
                                    clipImg.style.setProperty('width', `${widthPct}%`, 'important');
                                    clipImg.style.setProperty('height', `${heightPct}%`, 'important');
                                    clipImg.style.setProperty('object-fit', 'fill', 'important');
                                    clipImg.style.setProperty('pointer-events', 'none', 'important');

                                    ghost.style.setProperty('position', 'absolute', 'important');
                                    ghost.style.setProperty('left', `${leftPct}%`, 'important');
                                    ghost.style.setProperty('top', `${topPct}%`, 'important');
                                    ghost.style.setProperty('width', `${widthPct}%`, 'important');
                                    ghost.style.setProperty('height', `${heightPct}%`, 'important');
                                    ghost.style.setProperty('object-fit', 'fill', 'important');
                                    ghost.style.setProperty('pointer-events', 'none', 'important');

                                    if (vueImg) {
                                        vueImg.style.setProperty('opacity', '0', 'important');
                                    }
                                }
                            } else {
                                btn.className = 'smartcrop-preview-btn';
                                btn.title = ctx.isReadOnly ? 'Ορισμός κάδρου (4:3) [Μόνο για ανάγνωση]' : 'Ορισμός κάδρου (4:3)';
                                btn.setAttribute('aria-label', btn.title);
                                btn.innerHTML = '<span class="icon-scissors fas fa-crop-simple" aria-hidden="true"></span> <span>4:3</span>';

                                if (assetImageLayer) {
                                    assetImageLayer.classList.remove('has-image-crop');
                                    assetImageLayer.style.removeProperty('--sb-visual-width');
                                    assetImageLayer.style.removeProperty('--sb-visual-height');
                                    assetImageLayer.style.removeProperty('--sb-visual-x');
                                    assetImageLayer.style.removeProperty('--sb-visual-y');
                                    assetImageLayer.style.removeProperty('--sb-crop-x');
                                    assetImageLayer.style.removeProperty('--sb-crop-y');
                                    assetImageLayer.style.removeProperty('--sb-crop-width');
                                    assetImageLayer.style.removeProperty('--sb-crop-height');
                                    assetImageLayer.style.removeProperty('overflow');
                                    assetImageLayer.style.removeProperty('z-index');
                                }
                                if (assetBaseLayer) {
                                    assetBaseLayer.style.removeProperty('--sb-visual-width');
                                    assetBaseLayer.style.removeProperty('--sb-visual-height');
                                    assetBaseLayer.style.removeProperty('--sb-visual-x');
                                    assetBaseLayer.style.removeProperty('--sb-visual-y');
                                    assetBaseLayer.style.removeProperty('z-index');
                                }
                                if (vueImg) {
                                    vueImg.style.removeProperty('position');
                                    vueImg.style.removeProperty('left');
                                    vueImg.style.removeProperty('top');
                                    vueImg.style.removeProperty('width');
                                    vueImg.style.removeProperty('height');
                                    vueImg.style.removeProperty('max-width');
                                    vueImg.style.removeProperty('max-height');
                                    vueImg.style.removeProperty('object-fit');
                                    vueImg.style.removeProperty('opacity');
                                    vueImg.style.removeProperty('pointer-events');
                                }
                                if (badge) {
                                    badge.style.removeProperty('--sb-visual-x');
                                    badge.style.removeProperty('--sb-visual-y');
                                    badge.style.removeProperty('z-index');
                                    badge.style.removeProperty('pointer-events');
                                }

                                if (frame) {
                                    frame.remove();
                                    frame = null;
                                    clip = null;
                                    clipImg = null;
                                }

                                if (ghost) {
                                    ghost.remove();
                                    ghost = null;
                                }

                                if (vueImg) {
                                    vueImg.style.removeProperty('opacity');
                                }
                                if (visual) {
                                    visual.classList.remove('is-revealing-ghost');
                                }
                                if (area) {
                                    area.classList.remove('is-revealing-ghost');
                                }
                                layer.classList.remove('is-expanded-overlay', 'is-revealing-ghost');
                            }
                        };

                        // Hover preview revealing uncropped ghost behind crop outline without flickering
                        let isHovering = false;
                        const onHoverEnter = () => {
                            isHovering = true;
                            if (ghost || frame || layer.querySelector('.smartcrop-preview-frame.is-cropped')) {
                                if (hasImagePresentation && ghost) {
                                    updateGhostPosition();
                                }
                                layer.classList.add('is-expanded-overlay', 'is-revealing-ghost');
                                if (visual) visual.classList.add('is-revealing-ghost');
                                if (area) area.classList.add('is-revealing-ghost');
                            }
                        };
                        const onHoverLeave = () => {
                            isHovering = false;
                            layer.classList.remove('is-expanded-overlay', 'is-revealing-ghost');
                            if (visual) visual.classList.remove('is-revealing-ghost');
                            if (area) area.classList.remove('is-revealing-ghost');
                        };

                        btn.addEventListener('mouseenter', onHoverEnter);
                        btn.addEventListener('mouseleave', onHoverLeave);

                        // Click opens SmartCrop interactive modal
                        btn.addEventListener('click', (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            btn.blur();
                            onHoverLeave();

                            const ctx = currentContext || context;
                            if (ctx.isReadOnly) return;

                            const curCrop = getActiveCrop();
                            const curUrl = getImageUrl();
                            if (!curUrl) return;

                            const initialSource = ctx.getAddress?.() || ctx.resource?.id || curUrl;
                            const isImageResource = ctx.resource?.type === 'image'
                                || (typeof initialSource === 'string' && (initialSource.includes('#joomlaImage://') || initialSource.startsWith('image/')));

                            let effectiveCrop = curCrop?.crop || curCrop;
                            let effectiveRatioW = curCrop?.ratio?.width || 4;
                            let effectiveRatioH = curCrop?.ratio?.height || 3;

                            // If crop was for a different image source, reset crop for the new image
                            const cropSource = curCrop?.source || curCrop?.src || '';
                            if (cropSource && curUrl) {
                                const normCropSource = SmartCropManager.normalizeSource(cropSource);
                                const normCur = SmartCropManager.normalizeSource(curUrl);
                                if (normCropSource && normCur && normCropSource !== normCur) {
                                    effectiveCrop = null;
                                }
                            }

                            SmartCropManager.openCustom({
                                imageUrl: curUrl,
                                source: isImageResource ? initialSource : curUrl,
                                crop: effectiveCrop,
                                ratioW: effectiveRatioW,
                                ratioH: effectiveRatioH,
                                previewElement: visual,
                                document: doc,
                                onApply: async (result) => {
                                    btn.blur();
                                    onHoverLeave();
                                    SmartCropManager.registerSelectionAddressCodec();
                                    const applyCtx = currentContext || context;
                                    if (applyCtx?.isReadOnly) return;

                                    const primaryImg = (typeof applyCtx.getImageElement === 'function' ? applyCtx.getImageElement() : null)
                                        || applyCtx.imageElement
                                        || visual?.querySelector('img[data-sb-primary-image], img.resource-visual-image, img:not(.smartcrop-preview-ghost):not(.smartcrop-cropped-preview)');
                                    primaryImg?.removeAttribute?.('data-sb-image-presentation');

                                    const cleanNum = (n, fallback = 0) => {
                                        const num = Number(n);
                                        return Number.isFinite(num) ? num : fallback;
                                    };

                                    const rawCrop = result.crop || {};
                                    const rawRatio = result.ratio || {};
                                    const rw = cleanNum(typeof rawRatio === 'object' ? rawRatio.width : (String(rawRatio).replace(/[xX/_]/g, ':').split(':')[0]), 4);
                                    const rh = cleanNum(typeof rawRatio === 'object' ? rawRatio.height : (String(rawRatio).replace(/[xX/_]/g, ':').split(':')[1]), 3);
                                    const rval = rh > 0 ? Math.round((rw / rh) * 10000) / 10000 : 1.3333;
                                    const rlabel = (typeof rawRatio === 'object' && rawRatio.label) ? String(rawRatio.label) : `${rw}:${rh}`;

                                    const rawMetadata = {
                                        source: String(curUrl || initialSource || ''),
                                        ratio: {
                                            width: rw,
                                            height: rh,
                                            value: rval,
                                            label: rlabel
                                        },
                                        crop: {
                                            x: cleanNum(rawCrop.x, 0),
                                            y: cleanNum(rawCrop.y, 0),
                                            width: Math.max(0.0001, cleanNum(rawCrop.width, 1)),
                                            height: Math.max(0.0001, cleanNum(rawCrop.height, 1))
                                        },
                                        zoom: Math.max(0.05, cleanNum(result.zoom, 1.0))
                                    };

                                    if (result.sourceDimensions && Number.isFinite(result.sourceDimensions.width) && Number.isFinite(result.sourceDimensions.height)) {
                                        rawMetadata.sourceDimensions = {
                                            width: Math.round(result.sourceDimensions.width),
                                            height: Math.round(result.sourceDimensions.height)
                                        };
                                    }

                                    const targetWin = doc?.defaultView || applyCtx.fieldElement?.ownerDocument?.defaultView || window;
                                    const realmJson = SmartCropManager.getRealmJson(applyCtx, targetWin);
                                    const cropMetadata = SmartCropManager.sanitizeJsonMetadata(rawMetadata, realmJson);

                                    if (typeof applyCtx.setMetadata === 'function') {
                                        try {
                                            await applyCtx.setMetadata('smartcrop.crop', cropMetadata);
                                        } catch (e) {
                                            console.warn('[SmartCrop] setMetadata warning:', e);
                                        }
                                    } else if (typeof applyCtx.setValue === 'function') {
                                        try {
                                            await applyCtx.setValue('ext.smartcrop.crop', cropMetadata);
                                        } catch (e) {}
                                    }

                                    // Mutate resource descriptor only when legacy fallback without registerImagePresentation is active
                                    const resourceImage = applyCtx.resource?.image || curUrl || initialSource || '';
                                    const cropW = Math.max(0.0001, cleanNum(rawCrop.width, 1));
                                    const cropH = Math.max(0.0001, cleanNum(rawCrop.height, 1));
                                    const cropX = cleanNum(rawCrop.x, 0);
                                    const cropY = cleanNum(rawCrop.y, 0);

                                    const sbImageCrop = {
                                        source: resourceImage,
                                        ratio: rw / rh,
                                        x: parseFloat((-(cropX / cropW) * 100.0).toFixed(4)),
                                        y: parseFloat((-(cropY / cropH) * 100.0).toFixed(4)),
                                        width: parseFloat(((1.0 / cropW) * 100.0).toFixed(4)),
                                        height: parseFloat(((1.0 / cropH) * 100.0).toFixed(4)),
                                        crop: {
                                            x: cropX,
                                            y: cropY,
                                            width: cropW,
                                            height: cropH
                                        },
                                        zoom: Math.max(0.05, cleanNum(result.zoom, 1.0))
                                    };

                                    if (!hasImagePresentation && applyCtx.resource) {
                                        applyCtx.resource.imageCrop = sbImageCrop;
                                        applyCtx.resource.crop = cropMetadata;
                                    }

                                    // 1. Update address directly if available AND only if isImageResource
                                    if (isImageResource && typeof applyCtx.setAddress === 'function' && result.uri) {
                                        try {
                                            await applyCtx.setAddress(result.uri);
                                        } catch (e) {
                                            console.warn('[SmartCrop] setAddress warning:', e);
                                        }
                                    }

                                    // 2. Direct Sync to Native Joomla Media Input
                                    SmartCropManager.syncDirectToJoomlaFields(applyCtx, result, cropMetadata);

                                    if (typeof applyCtx.notifyPresentationChange === 'function') {
                                        try {
                                            applyCtx.notifyPresentationChange({ reason: 'aspect-ratio' });
                                        } catch (e) {}
                                    }

                                    syncFraming();
                                },
                                onRemove: async () => {
                                    btn.blur();
                                    onHoverLeave();
                                    SmartCropManager.registerSelectionAddressCodec();
                                    const removeCtx = currentContext || context;
                                    if (removeCtx?.isReadOnly) return;

                                    const primaryImg = (typeof removeCtx.getImageElement === 'function' ? removeCtx.getImageElement() : null)
                                        || removeCtx.imageElement
                                        || visual?.querySelector('img[data-sb-primary-image], img.resource-visual-image, img:not(.smartcrop-preview-ghost):not(.smartcrop-cropped-preview)');
                                    primaryImg?.removeAttribute?.('data-sb-image-presentation');

                                    if (typeof removeCtx.setMetadata === 'function') {
                                        try { await removeCtx.setMetadata('smartcrop.crop', null); } catch (e) {}
                                    } else if (typeof removeCtx.setValue === 'function') {
                                        try { await removeCtx.setValue('ext.smartcrop.crop', null); } catch (e) {}
                                    }

                                    // Remove crop descriptor from resource
                                    if (!hasImagePresentation && removeCtx.resource) {
                                        delete removeCtx.resource.imageCrop;
                                        delete removeCtx.resource.crop;
                                    }

                                    if (isImageResource) {
                                        const currentAddr = removeCtx.getAddress?.() || removeCtx.resource?.id || curUrl || '';
                                        const cleanJoomlaUri = SmartCropModalController.prototype.removeCropFromUri.call(
                                             null,
                                             currentAddr
                                        ) || currentAddr.split('#')[0].split('?')[0];

                                        if (typeof removeCtx.setAddress === 'function') {
                                            try { await removeCtx.setAddress(cleanJoomlaUri); } catch (e) {}
                                        }

                                        // Direct Sync clean URI to Native Joomla Media Input
                                        SmartCropManager.syncDirectToJoomlaFields(removeCtx, { uri: cleanJoomlaUri }, null);
                                    } else {
                                        // For articles/categories, never touch the resource address on remove
                                        SmartCropManager.syncDirectToJoomlaFields(removeCtx, null, null);
                                    }

                                    if (typeof removeCtx.notifyPresentationChange === 'function') {
                                        try {
                                            removeCtx.notifyPresentationChange({ reason: 'reset' });
                                        } catch (e) {}
                                    }

                                    syncFraming();
                                }
                            });
                        });

                        const actionsHost = context.actionsContainer || visual?.closest('.resource-lightweight-area')?.querySelector('.resource-lightweight-preview-action');
                        if (actionsHost) {
                            actionsHost.querySelectorAll('.smartcrop-preview-btn').forEach(oldBtn => oldBtn.remove());
                            actionsHost.appendChild(btn);
                        } else {
                            layer.querySelectorAll('.smartcrop-preview-btn').forEach(oldBtn => oldBtn.remove());
                            layer.appendChild(btn);
                        }
                        syncFraming();

                        // Keep framing responsive to container resize without thrashing during hover
                        if (typeof ResizeObserver !== 'undefined') {
                            resizeObserver = new ResizeObserver(() => {
                                if (!isHovering) {
                                    syncFraming();
                                }
                            });
                            resizeObserver.observe(layer);
                        }

                        // Re-sync if Vue renders or swaps images asynchronously inside visual
                        if (typeof MutationObserver !== 'undefined' && visual) {
                            visualObserver = new MutationObserver((mutations) => {
                                let shouldSync = false;
                                for (const m of mutations) {
                                    for (const node of m.addedNodes) {
                                        if (node.nodeType === 1) {
                                            if (node.tagName === 'IMG' && !node.classList.contains('smartcrop-preview-ghost') && !node.classList.contains('smartcrop-cropped-preview')) {
                                                shouldSync = true;
                                                break;
                                            }
                                            if (node.querySelector && node.querySelector('img:not(.smartcrop-preview-ghost):not(.smartcrop-cropped-preview)')) {
                                                shouldSync = true;
                                                break;
                                            }
                                        }
                                    }
                                    if (shouldSync) break;
                                }
                                if (shouldSync && !isHovering) {
                                    syncFraming();
                                }
                            });
                            visualObserver.observe(visual, { childList: true, subtree: true });
                        }

                        // Close editor if overlay signal is aborted
                        if (context.signal) {
                            context.signal.addEventListener('abort', () => {
                                window.SmartCropCloseModal?.();
                            }, { once: true });
                        }

                        layer._smartcropSyncFraming = syncFraming;
                        layer._smartcropUpdateContext = (newCtx) => {
                            currentContext = newCtx;
                        };

                        return () => {
                            if (resizeObserver) {
                                resizeObserver.disconnect();
                                resizeObserver = null;
                            }
                            if (visualObserver) {
                                visualObserver.disconnect();
                                visualObserver = null;
                            }
                            if (!hasImagePresentation) {
                                const curVueImg = visual?.querySelector('img:not(.smartcrop-preview-ghost):not(.smartcrop-cropped-preview)');
                                const assetImageLayer = visual?.querySelector('.resource-visual-layer.asset-image') || curVueImg?.closest('.resource-visual-layer');
                                if (assetImageLayer) {
                                    assetImageLayer.classList.remove('has-image-crop');
                                    assetImageLayer.style.removeProperty('--sb-visual-width');
                                    assetImageLayer.style.removeProperty('--sb-visual-height');
                                    assetImageLayer.style.removeProperty('--sb-visual-x');
                                    assetImageLayer.style.removeProperty('--sb-visual-y');
                                    assetImageLayer.style.removeProperty('--sb-crop-x');
                                    assetImageLayer.style.removeProperty('--sb-crop-y');
                                    assetImageLayer.style.removeProperty('--sb-crop-width');
                                    assetImageLayer.style.removeProperty('--sb-crop-height');
                                    assetImageLayer.style.removeProperty('overflow');
                                    assetImageLayer.style.removeProperty('z-index');
                                }
                                const assetBaseLayer = visual?.querySelector('.resource-visual-layer.asset-base');
                                if (assetBaseLayer) {
                                    assetBaseLayer.style.removeProperty('--sb-visual-width');
                                    assetBaseLayer.style.removeProperty('--sb-visual-height');
                                    assetBaseLayer.style.removeProperty('--sb-visual-x');
                                    assetBaseLayer.style.removeProperty('--sb-visual-y');
                                    assetBaseLayer.style.removeProperty('z-index');
                                }
                                const vueImg = visual?.querySelector('img:not(.smartcrop-preview-ghost):not(.smartcrop-cropped-preview)');
                                if (vueImg) {
                                    vueImg.style.removeProperty('position');
                                    vueImg.style.removeProperty('left');
                                    vueImg.style.removeProperty('top');
                                    vueImg.style.removeProperty('width');
                                    vueImg.style.removeProperty('height');
                                    vueImg.style.removeProperty('max-width');
                                    vueImg.style.removeProperty('max-height');
                                    vueImg.style.removeProperty('object-fit');
                                    vueImg.style.removeProperty('opacity');
                                    vueImg.style.removeProperty('pointer-events');
                                }
                                const badge = visual?.querySelector('.resource-visual-layer.resource-node-visual-symbol, .resource-visual-layer.style-badge, .resource-visual-layer.asset-identity');
                                if (badge) {
                                    badge.style.removeProperty('--sb-visual-x');
                                    badge.style.removeProperty('--sb-visual-y');
                                    badge.style.removeProperty('z-index');
                                    badge.style.removeProperty('pointer-events');
                                }
                            }
                            if (visual) {
                                visual.classList.remove('is-revealing-ghost');
                            }
                            if (area) {
                                area.classList.remove('is-revealing-ghost');
                            }
                            layer.classList.remove('is-expanded-overlay', 'is-revealing-ghost');
                            if (frame) {
                                frame.remove();
                                frame = null;
                            }
                            if (ghost) {
                                ghost.remove();
                                ghost = null;
                            }
                            btn.remove();
                            delete layer._smartcropSyncFraming;
                            delete layer._smartcropUpdateContext;
                        };
                    },
                    update(layer, nextContext) {
                        if (nextContext && typeof layer._smartcropUpdateContext === 'function') {
                            layer._smartcropUpdateContext(nextContext);
                        }
                        if (typeof layer._smartcropSyncFraming === 'function') {
                            layer._smartcropSyncFraming();
                        }
                    }
                });
                window._smartcropSbOverlayRegistered = true;
                return true;
            } catch (e) {
                console.error('[SmartCrop] Failed to register visual overlay:', e);
                return false;
            }
        };

        if (!doRegister()) {
            document.addEventListener('smartbrowser:ready', doRegister, { once: true });
            document.addEventListener('smartbrowser:collection-ready', doRegister, { once: true });
            document.addEventListener('DOMContentLoaded', doRegister, { once: true });
            setTimeout(doRegister, 100);
            setTimeout(doRegister, 500);
            setTimeout(doRegister, 1500);
        }
    }

    static registerSmartBrowserAction() {
        if (typeof window === 'undefined') return;
        // If Visual Overlay API is active, do not register legacy action-bar button
        if (window.SmartBrowserPicker && typeof window.SmartBrowserPicker.registerVisualOverlay === 'function') {
            return;
        }
        if (window._smartcropSbActionRegistered) return;

        const doRegister = () => {
            if (!window.SmartBrowserPicker || typeof window.SmartBrowserPicker.registerPreviewAction !== 'function') {
                return false;
            }
            if (typeof window.SmartBrowserPicker.registerVisualOverlay === 'function') {
                return false;
            }
            if (window._smartcropSbActionRegistered) return true;

            try {
                window.SmartBrowserPicker.registerPreviewAction({
                    id: 'smartcrop.crop',
                    label: 'PLG_CONTENT_SMARTCROP_ACTION_CROP',
                    icon: 'fas fa-crop-simple',
                    applies: (context) => {
                        if (window.SmartBrowserPicker && typeof window.SmartBrowserPicker.registerVisualOverlay === 'function') {
                            return false;
                        }
                        if (!context || !context.resource || context.resource.type !== 'image') {
                            return false;
                        }
                        if (context.nativePreview) {
                            return false;
                        }
                        if (context.previewElement?.closest('joomla-field-media, .sb-article-image-field, .sb-article-image-preview, .sb-native-preview-host')) {
                            return false;
                        }
                        return true;
                    },
                    async run(context) {
                        const existingCrop = context.getValues?.()?.['smartcrop.crop'] || context.getValues?.()?.crop || null;
                        const imageUrl = context.resource?.metadata?.url
                            || context.resource?.image
                            || context.resource?.url
                            || (window.SmartBrowserMediaValue?.format ? window.SmartBrowserMediaValue.format(context.resource, 'url') : '')
                            || '';

                        SmartCropManager.openCustom({
                            imageUrl: imageUrl,
                            source: context.resource?.id || imageUrl,
                            crop: existingCrop,
                            previewElement: context.previewElement,
                            onApply: (result) => {
                                if (typeof context.setValue === 'function') {
                                    context.setValue('smartcrop.crop', result.crop);
                                    context.setValue('crop', result.crop);
                                }
                                if (typeof context.setAddress === 'function') {
                                    context.setAddress(result.uri);
                                }
                                if (context.previewElement) {
                                    SmartCropManager.applyFramingToElement(context.previewElement, result, imageUrl);
                                }
                            },
                            onRemove: () => {
                                if (typeof context.setValue === 'function') {
                                    context.setValue('smartcrop.crop', null);
                                    context.setValue('crop', null);
                                }
                                if (typeof context.setAddress === 'function') {
                                    const cleanUri = (context.resource?.id || imageUrl || '').split('#')[0];
                                    context.setAddress(cleanUri);
                                }
                                if (context.previewElement) {
                                    SmartCropManager.clearFramingFromElement(context.previewElement);
                                }
                            }
                        });
                    }
                });
                window._smartcropSbActionRegistered = true;
                return true;
            } catch (e) {
                return false;
            }
        };

        if (!doRegister()) {
            document.addEventListener('smartbrowser:ready', doRegister, { once: true });
            document.addEventListener('smartbrowser:collection-ready', doRegister, { once: true });
            document.addEventListener('DOMContentLoaded', doRegister, { once: true });
            setTimeout(doRegister, 100);
            setTimeout(doRegister, 500);
            setTimeout(doRegister, 1500);
        }
    }

    static initSmartBrowserFields() {
        // If Visual Overlay API is supported, SmartBrowser handles mounting natively
        if (window.SmartBrowserPicker && typeof window.SmartBrowserPicker.registerVisualOverlay === 'function') {
            return;
        }

        const sbFields = document.querySelectorAll('.sb-selection-field');
        sbFields.forEach((sbField) => {
            // Never process native article media fields here (image_intro, image_fulltext)
            // They are already managed by initField() and updateFieldPreview()
            if (sbField.hasAttribute('data-sb-article-media') ||
                sbField.closest('.sb-native-preview-host, .sb-article-image-field, joomla-field-media') ||
                sbField.querySelector('.sb-native-preview-host, joomla-field-media, input[name*="[images]["]')) {
                return;
            }

            const visuals = sbField.querySelectorAll('.resource-lightweight-visual');
            visuals.forEach((visual) => {
                SmartCropManager.decorateSmartBrowserVisual(visual, sbField);
            });
        });
    }

    static decorateSmartBrowserVisual(visual, sbField) {
        if (!visual) return;

        // Find the active preview image
        const img = visual.querySelector('img:not(.smartcrop-preview-ghost)');
        if (!img || !img.src || img.src === '#' || img.style.display === 'none') {
            visual.querySelector('.smartcrop-preview-btn')?.remove();
            visual.querySelector('.smartcrop-preview-ghost')?.remove();
            visual.classList.remove('is-cropped', 'is-revealing-ghost');
            return;
        }

        const input = sbField ? (sbField.querySelector('input[data-sb-value]') || sbField.querySelector('input[type="hidden"]')) : null;
        const cleanSrc = (img.currentSrc || img.src || '').split('#')[0].trim();

        // Ensure ghost image layer exists inside visual
        let ghost = visual.querySelector('.smartcrop-preview-ghost');
        if (!ghost) {
            ghost = document.createElement('img');
            ghost.className = 'smartcrop-preview-ghost';
            ghost.alt = '';
            ghost.setAttribute('aria-hidden', 'true');
            visual.insertBefore(ghost, visual.firstChild);
        }
        if (cleanSrc && ghost.src !== cleanSrc) {
            ghost.src = cleanSrc;
        }

        // If img is a direct child of visual and not wrapped in a clip container, wrap it
        if (img.parentElement === visual) {
            let clip = visual.querySelector('.smartcrop-preview-clip');
            if (!clip) {
                clip = document.createElement('div');
                clip.className = 'smartcrop-preview-clip';
                visual.insertBefore(clip, img);
                clip.appendChild(img);
            }
        }

        // Ensure preview button exists in top-right corner of visual
        let previewBtn = visual.querySelector('.smartcrop-preview-btn');
        if (!previewBtn) {
            previewBtn = document.createElement('button');
            previewBtn.type = 'button';
            previewBtn.className = 'smartcrop-preview-btn';
            previewBtn.setAttribute('data-smartcrop-preview-btn', '');
            visual.appendChild(previewBtn);
        }

        // Bind hover preview to reveal the uncropped ghost
        if (!previewBtn._smartcropHoverBound) {
            previewBtn._smartcropHoverBound = true;
            const parentArea = visual.closest('.resource-lightweight-area, .sb-selected-panel, .resource-info-panel, .control-group') || visual.parentElement;

            const onEnter = () => {
                if (visual.classList.contains('is-cropped')) {
                    visual.classList.add('is-revealing-ghost');
                    if (parentArea) parentArea.classList.add('is-revealing-ghost');
                    if (sbField) sbField.classList.add('is-revealing-ghost');
                }
            };
            const onLeave = () => {
                visual.classList.remove('is-revealing-ghost');
                if (parentArea) parentArea.classList.remove('is-revealing-ghost');
                if (sbField) sbField.classList.remove('is-revealing-ghost');
            };

            previewBtn.addEventListener('mouseenter', onEnter);
            previewBtn.addEventListener('mouseleave', onLeave);
            previewBtn.addEventListener('focus', onEnter);
            previewBtn.addEventListener('blur', onLeave);
        }

        // Resolve existing crop metadata
        let parsedCrop = null;
        if (visual._smartcropData) {
            parsedCrop = visual._smartcropData;
        } else if (input && input.dataset && input.dataset.smartcrop) {
            try { parsedCrop = JSON.parse(input.dataset.smartcrop); } catch (e) {}
        } else if (visual.dataset && visual.dataset.smartcrop) {
            try { parsedCrop = JSON.parse(visual.dataset.smartcrop); } catch (e) {}
        } else if (input && input.value) {
            try {
                const valData = JSON.parse(input.value);
                const item = valData.items?.[0];
                if (item?.usage?.['smartcrop.crop']) {
                    parsedCrop = { crop: item.usage['smartcrop.crop'] };
                } else if (item?.usage?.crop) {
                    parsedCrop = { crop: item.usage.crop };
                } else if (item?.selection?.crop) {
                    parsedCrop = { crop: item.selection.crop };
                } else if (typeof item?.selection?.id === 'string' && item.selection.id.includes('crop=')) {
                    parsedCrop = SmartCropManager.extractCropFromValue(item.selection.id);
                }
            } catch (e) {}
        }

        // Apply framing or set uncropped state
        if (parsedCrop && parsedCrop.crop) {
            SmartCropManager.applySmartBrowserVisualFraming(visual, parsedCrop, cleanSrc);
        } else {
            SmartCropManager.clearSmartBrowserVisualFraming(visual);
        }

        // Bind click handler to open SmartCrop modal
        if (!previewBtn._smartcropClickBound) {
            previewBtn._smartcropClickBound = true;
            previewBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                const curSrc = (img.currentSrc || img.src || cleanSrc).split('#')[0].trim();
                const curCrop = visual._smartcropData || parsedCrop;

                SmartCropManager.openCustom({
                    imageUrl: curSrc,
                    source: curSrc,
                    crop: curCrop?.crop || curCrop,
                    ratioW: curCrop?.ratio?.width || 4,
                    ratioH: curCrop?.ratio?.height || 3,
                    previewElement: visual,
                    onApply: (result) => {
                        visual._smartcropData = result;
                        visual.dataset.smartcrop = JSON.stringify(result);
                        if (input) {
                            input.dataset.smartcrop = JSON.stringify(result);
                            SmartCropManager.persistSmartBrowserValue(input, result);
                            input.dispatchEvent(new Event('input', { bubbles: true }));
                            input.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                        SmartCropManager.decorateSmartBrowserVisual(visual, sbField);
                    },
                    onRemove: () => {
                        visual._smartcropData = null;
                        delete visual.dataset.smartcrop;
                        if (input) {
                            delete input.dataset.smartcrop;
                            SmartCropManager.persistSmartBrowserValue(input, null);
                            input.dispatchEvent(new Event('input', { bubbles: true }));
                            input.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                        SmartCropManager.decorateSmartBrowserVisual(visual, sbField);
                    }
                });
            });
        }
    }

    static applySmartBrowserVisualFraming(visual, cropResult, imageUrl) {
        if (!visual) return;
        const img = visual.querySelector('img:not(.smartcrop-preview-ghost)');
        if (!img) return;

        const crop = cropResult?.crop || cropResult;
        if (!crop) return;

        let ghost = visual.querySelector('.smartcrop-preview-ghost');
        const cleanSrc = (imageUrl || img.currentSrc || img.src || '').split('#')[0].trim();
        if (ghost && cleanSrc && ghost.src !== cleanSrc) {
            ghost.src = cleanSrc;
        }

        const previewBtn = visual.querySelector('.smartcrop-preview-btn');
        const rw = cropResult.ratio?.width || Math.round((crop.width / crop.height) * 100) / 100 || 4;
        const rh = cropResult.ratio?.height || 3;
        const ratioText = (cropResult.ratio?.width && cropResult.ratio?.height) ? `${cropResult.ratio.width}:${cropResult.ratio.height}` : `${rw}:${rh}`;

        visual.classList.add('smartcrop-preview-frame', 'is-cropped');
        visual.style.setProperty('position', 'relative', 'important');

        if (previewBtn) {
            previewBtn.className = 'smartcrop-preview-btn is-cropped';
            previewBtn.title = `Επεξεργασία κάδρου (${ratioText}) — Hover για ολόκληρη εικόνα`;
            previewBtn.setAttribute('aria-label', `Επεξεργασία κάδρου (${ratioText})`);
            previewBtn.innerHTML = `<span class="icon-scissors" aria-hidden="true"></span> <span>${ratioText}</span>`;
        }

        let normX = Number(crop.x) || 0;
        let normY = Number(crop.y) || 0;
        let normW = Number(crop.width) || 1;
        let normH = Number(crop.height) || 1;

        if (normW <= 1.0001 && normX >= -0.0001) {
            normX = Math.max(0, Math.min(1, normX));
            normW = Math.max(0.0001, Math.min(1 - normX, normW));
        } else {
            normW = Math.max(0.0001, Math.min(25.0, normW));
            normX = Math.max(-25.0, Math.min(1.0, normX));
        }

        if (normH <= 1.0001 && normY >= -0.0001) {
            normY = Math.max(0, Math.min(1, normY));
            normH = Math.max(0.0001, Math.min(1 - normY, normH));
        } else {
            normH = Math.max(0.0001, Math.min(25.0, normH));
            normY = Math.max(-25.0, Math.min(1.0, normY));
        }

        const scaleX = 1.0 / normW;
        const scaleY = 1.0 / normH;

        const widthPct  = (scaleX * 100.0).toFixed(4);
        const heightPct = (scaleY * 100.0).toFixed(4);
        const leftPct   = (-(normX / normW) * 100.0).toFixed(4);
        const topPct    = (-(normY / normH) * 100.0).toFixed(4);

        // Position active cropped image
        img.style.setProperty('position', 'absolute', 'important');
        img.style.setProperty('left', `${leftPct}%`, 'important');
        img.style.setProperty('top', `${topPct}%`, 'important');
        img.style.setProperty('width', `${widthPct}%`, 'important');
        img.style.setProperty('height', `${heightPct}%`, 'important');
        img.style.setProperty('max-width', 'none', 'important');
        img.style.setProperty('max-height', 'none', 'important');
        img.style.setProperty('display', 'block', 'important');
        img.style.setProperty('object-fit', 'fill', 'important');
        img.style.setProperty('pointer-events', 'none', 'important');

        // Position ghost image behind crop
        if (ghost) {
            ghost.style.removeProperty('display');
            ghost.style.setProperty('position', 'absolute', 'important');
            ghost.style.setProperty('left', `${leftPct}%`, 'important');
            ghost.style.setProperty('top', `${topPct}%`, 'important');
            ghost.style.setProperty('width', `${widthPct}%`, 'important');
            ghost.style.setProperty('height', `${heightPct}%`, 'important');
            ghost.style.setProperty('max-width', 'none', 'important');
            ghost.style.setProperty('max-height', 'none', 'important');
            ghost.style.setProperty('display', 'block', 'important');
            ghost.style.setProperty('object-fit', 'fill', 'important');
            ghost.style.setProperty('pointer-events', 'none', 'important');
        }
    }

    static clearSmartBrowserVisualFraming(visual) {
        if (!visual) return;
        visual.classList.remove('smartcrop-preview-frame', 'is-cropped', 'is-revealing-ghost');

        const ghost = visual.querySelector('.smartcrop-preview-ghost');
        if (ghost) {
            ghost.style.setProperty('display', 'none', 'important');
        }

        const previewBtn = visual.querySelector('.smartcrop-preview-btn');
        if (previewBtn) {
            previewBtn.className = 'smartcrop-preview-btn';
            previewBtn.title = 'Ορισμός κάδρου (4:3)';
            previewBtn.setAttribute('aria-label', 'Ορισμός κάδρου (4:3)');
            previewBtn.innerHTML = '<span class="icon-scissors" aria-hidden="true"></span> <span>4:3</span>';
        }

        const img = visual.querySelector('img:not(.smartcrop-preview-ghost)');
        if (img) {
            img.style.removeProperty('position');
            img.style.removeProperty('left');
            img.style.removeProperty('top');
            img.style.removeProperty('width');
            img.style.removeProperty('height');
            img.style.removeProperty('max-width');
            img.style.removeProperty('max-height');
            img.style.removeProperty('object-fit');
            img.style.removeProperty('pointer-events');
        }

        delete visual._smartcropData;
        delete visual.dataset.smartcrop;
    }

    static persistSmartBrowserValue(input, result) {
        if (!input) return;
        try {
            if (!result) {
                delete input.dataset.smartcrop;
                return;
            }
            input.dataset.smartcrop = JSON.stringify(result);
        } catch (e) {}
    }

    static getRealmJson(context, fallbackWin = null) {
        try {
            if (typeof context?.setMetadata === 'function' && context.setMetadata.constructor) {
                const j = context.setMetadata.constructor('return JSON')();
                if (j && typeof j.parse === 'function') return j;
            }
        } catch (e) {}
        try {
            if (typeof context?.setValue === 'function' && context.setValue.constructor) {
                const j = context.setValue.constructor('return JSON')();
                if (j && typeof j.parse === 'function') return j;
            }
        } catch (e) {}
        if (fallbackWin && fallbackWin.JSON) return fallbackWin.JSON;
        if (context?.fieldElement?.ownerDocument?.defaultView?.JSON) {
            return context.fieldElement.ownerDocument.defaultView.JSON;
        }
        return window.JSON;
    }

    static sanitizeJsonMetadata(data, realmJSON = null) {
        if (data === null || data === undefined) return null;
        const clean = (val, depth = 0) => {
            if (depth > 20) return undefined;
            if (val === undefined || typeof val === 'function' || typeof val === 'symbol') {
                return undefined;
            }
            if (val === null || typeof val === 'string' || typeof val === 'boolean') {
                return val;
            }
            if (typeof val === 'number') {
                return Number.isFinite(val) ? val : null;
            }
            if (Array.isArray(val)) {
                return val.map(item => clean(item, depth + 1)).filter(item => item !== undefined);
            }
            if (typeof val === 'object') {
                const cleanedObj = {};
                for (const [k, v] of Object.entries(val)) {
                    const cleanedVal = clean(v, depth + 1);
                    if (cleanedVal !== undefined) {
                        cleanedObj[k] = cleanedVal;
                    }
                }
                return cleanedObj;
            }
            return undefined;
        };

        const cleaned = clean(data);
        if (cleaned === undefined) return null;
        const jsonImpl = (realmJSON && typeof realmJSON.parse === 'function') ? realmJSON : JSON;
        try {
            return jsonImpl.parse(JSON.stringify(cleaned));
        } catch (e) {
            try {
                return JSON.parse(JSON.stringify(cleaned));
            } catch (err) {
                return null;
            }
        }
    }

    static syncDirectToJoomlaFields(context, result, cropMetadata) {
        if (!context) return;
        const uri = result?.uri;
        const initialAddress = context.getAddress?.() || context.resource?.id || '';
        const isImageResource = context.resource?.type === 'image'
            || (typeof initialAddress === 'string' && (initialAddress.includes('#joomlaImage://') || initialAddress.startsWith('image/')));

        // 1. Direct Sync to Native Joomla Media Input (e.g. image_intro, image_fulltext, custom media fields)
        try {
            const fieldEl = context.fieldElement?.closest?.('.sb-selection-field') || context.fieldElement || document.querySelector('.sb-selection-field');
            const form = fieldEl?.closest('form') || document.querySelector('form#item-form, form.form-validate, form');
            if (form) {
                const targetInputs = new Set();

                // Inspect data-sb-article-media mapping
                const rawMapping = fieldEl?.dataset?.sbArticleMedia;
                if (rawMapping) {
                    try {
                        const mapping = JSON.parse(rawMapping);
                        const role = mapping.role;
                        const imgField = mapping.image;
                        if (imgField) {
                            const inp = form.elements.namedItem(imgField);
                            if (inp) targetInputs.add(inp.tagName ? inp : inp[0]);
                        }
                        if (role) {
                            const inp = form.elements.namedItem(`jform[images][image_${role}]`);
                            if (inp) targetInputs.add(inp.tagName ? inp : inp[0]);
                        }
                        if (mapping.nativeNames) {
                            Object.values(mapping.nativeNames).forEach(name => {
                                const inp = form.elements.namedItem(name);
                                if (inp) targetInputs.add(inp.tagName ? inp : inp[0]);
                            });
                        }
                    } catch (e) {}
                }

                // Also inspect surrounding container (fieldset, control-group)
                const container = fieldEl?.closest('[data-sb-native-media], .options-form, .control-group');
                if (container) {
                    container.querySelectorAll('input[name^="jform[images]"], input.field-media-input, joomla-field-media input').forEach(inp => {
                        targetInputs.add(inp);
                    });
                }

                if (uri && isImageResource) {
                    targetInputs.forEach(input => {
                        if (input && input.value !== uri) {
                            input.value = uri;
                            const jfm = input.closest('joomla-field-media');
                            if (jfm) {
                                jfm.validatedUrl = uri;
                                if (typeof jfm.updatePreview === 'function') {
                                    try { jfm.updatePreview(); } catch (e) {}
                                }
                                jfm.dispatchEvent(new CustomEvent('change', { bubbles: true, detail: { value: uri } }));
                            }
                            input.dispatchEvent(new Event('input', { bubbles: true }));
                            input.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    });
                } else if (cropMetadata === null) {
                    targetInputs.forEach(input => {
                        if (input && input.value && input.value.includes('crop=')) {
                            const cleaned = SmartCropManager.cleanCropFromJoomlaUri(input.value) || input.value.split('#')[0];
                            if (input.value !== cleaned) {
                                input.value = cleaned;
                                const jfm = input.closest('joomla-field-media');
                                if (jfm) {
                                    jfm.validatedUrl = cleaned;
                                    if (typeof jfm.updatePreview === 'function') {
                                        try { jfm.updatePreview(); } catch (e) {}
                                    }
                                    jfm.dispatchEvent(new CustomEvent('change', { bubbles: true, detail: { value: cleaned } }));
                                }
                                input.dispatchEvent(new Event('input', { bubbles: true }));
                                input.dispatchEvent(new Event('change', { bubbles: true }));
                            }
                        }
                    });
                }
            }
        } catch (e) {
            console.warn('[SmartCrop] syncDirectToJoomlaFields native inputs warning:', e);
        }

        // 2. Direct Sync to SmartBrowser Selection Field hidden input [data-sb-value] (fallback only if setMetadata is not supported)
        if (typeof context.setMetadata !== 'function' && typeof context.setValue !== 'function') {
            try {
                const fieldEl = context.fieldElement?.closest?.('.sb-selection-field') || context.fieldElement || document.querySelector('.sb-selection-field');
                const sbValueInput = fieldEl?.querySelector('[data-sb-value]');
                if (sbValueInput && sbValueInput.value) {
                    const parsed = JSON.parse(sbValueInput.value);
                    if (parsed && Array.isArray(parsed.items) && parsed.items.length > 0) {
                        let mutated = false;
                        for (const item of parsed.items) {
                            item.usage = item.usage || {};
                            if (isImageResource) {
                                if (uri) {
                                    item.usage['ext.address'] = uri;
                                    mutated = true;
                                } else if (uri === '') {
                                    delete item.usage['ext.address'];
                                    mutated = true;
                                }
                            }
                            if (cropMetadata) {
                                item.usage['ext.smartcrop.crop'] = cropMetadata;
                                mutated = true;
                            } else if (cropMetadata === null) {
                                delete item.usage['ext.smartcrop.crop'];
                                mutated = true;
                            }
                        }
                        if (mutated) {
                            sbValueInput.value = JSON.stringify(parsed);
                            sbValueInput.dispatchEvent(new Event('input', { bubbles: true }));
                            sbValueInput.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    }
                }
            } catch (e) {
                console.warn('[SmartCrop] syncDirectToJoomlaFields sbValue warning:', e);
            }
        }
    }

    static initAll() {
        const els = document.querySelectorAll('joomla-field-media, .field-media-wrapper, input.field-media-input, [data-smartcrop-field], .smartcrop-field');
        els.forEach((el) => {
            const target = el.tagName === 'INPUT' ? (el.closest('joomla-field-media, .field-media-wrapper, [data-smartcrop-field], .smartcrop-field') || el.closest('.input-group') || el) : el;
            SmartCropManager.initField(target);
        });

        // Register Selection Address codec on SmartBrowser
        SmartCropManager.registerSelectionAddressCodec();

        // Register Image Presentation Provider on SmartBrowserPicker
        SmartCropManager.registerSmartBrowserImagePresentation();

        // Register Visual Overlay on SmartBrowserPicker
        SmartCropManager.registerSmartBrowserVisualOverlay();

        // Fallback for legacy SmartBrowser versions without Visual Overlay API
        SmartCropManager.initSmartBrowserFields();
        SmartCropManager.registerSmartBrowserAction();
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
            modalEl = document.querySelector('[data-smartcrop-modal].smartcrop-modal-visible, [data-smartcrop-modal].show, dialog[data-smartcrop-modal][open]');
        }
        if (!modalEl) return;
        modalEl.classList.remove('show', 'smartcrop-modal-visible');
        modalEl.style.display = 'none';
        modalEl.setAttribute('aria-hidden', 'true');
        modalEl.removeAttribute('aria-modal');
        if (typeof modalEl.close === 'function') {
            try {
                if (modalEl.open) {
                    modalEl.close();
                }
            } catch (e) {}
        }
        document.body?.classList.remove('modal-open');
        if (modalEl._smartcropController) {
            try {
                modalEl._smartcropController.closeModal();
            } catch (e) {}
        }
    };

    window.SmartCropOpenCustom = window.SmartCropOpenCustom || function(options) {
        return SmartCropManager.openCustom(options);
    };

    window.SmartCropHelper = window.SmartCropHelper || {
        resolveCropPresentation: SmartCropManager.resolveCropPresentation,
        isCropApplicable: SmartCropManager.isCropApplicable,
        normalizeSource: SmartCropManager.normalizeSource,
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
    document.addEventListener('DOMContentLoaded', () => {
        initSmartCrop();
        setTimeout(initSmartCrop, 150);
        setTimeout(initSmartCrop, 500);
        setTimeout(initSmartCrop, 1200);
    });
} else {
    initSmartCrop();
    setTimeout(initSmartCrop, 150);
    setTimeout(initSmartCrop, 500);
    setTimeout(initSmartCrop, 1200);
}

// Re-check on tab changes or SmartBrowser events
if (typeof document !== 'undefined') {
    document.addEventListener('shown.bs.tab', () => setTimeout(initSmartCrop, 50));
    document.addEventListener('smartbrowser:ready', () => {
        SmartCropManager.registerSelectionAddressCodec();
        SmartCropManager.registerSmartBrowserImagePresentation();
        setTimeout(initSmartCrop, 50);
    });
    document.addEventListener('smartbrowser:collection-ready', () => {
        SmartCropManager.registerSelectionAddressCodec();
        SmartCropManager.registerSmartBrowserImagePresentation();
        setTimeout(initSmartCrop, 50);
    });
    document.addEventListener('click', (e) => {
        if (e.target && (e.target.closest('[data-bs-toggle="tab"], [data-toggle="tab"], [role="tab"], .nav-link') || e.target.closest('joomla-tab'))) {
            setTimeout(initSmartCrop, 60);
        }
    });
}

// Observe dynamic DOM changes (e.g. AJAX-injected dialogs, tabs, SmartBrowser)
if (typeof window !== 'undefined' && window.MutationObserver) {
    try {
        let observerDebounce = null;
        const dynamicObserver = new MutationObserver((mutations) => {
            let hasNewMediaField = false;
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    // Ignore internal SmartCrop elements to prevent feedback loops
                    if (node.classList?.contains('smartcrop-preview-frame') ||
                        node.classList?.contains('smartcrop-preview-badge') ||
                        node.classList?.contains('smartcrop-crop-btn') ||
                        node.classList?.contains('smartcrop-preview-btn') ||
                        node.classList?.contains('smartcrop-preview-ghost') ||
                        node.classList?.contains('smartcrop-modal') ||
                        node.hasAttribute?.('data-smartcrop-modal')) {
                        continue;
                    }
                    if (node.matches?.('joomla-field-media, .field-media-wrapper, input.field-media-input, .sb-selection-field, .resource-lightweight-visual, [data-sb-collection]') ||
                        node.querySelector?.('joomla-field-media, .field-media-wrapper, input.field-media-input, .sb-selection-field, .resource-lightweight-visual, [data-sb-collection]')) {
                        hasNewMediaField = true;
                        break;
                    }
                }
                if (hasNewMediaField) break;
            }

            if (hasNewMediaField) {
                if (observerDebounce) clearTimeout(observerDebounce);
                observerDebounce = setTimeout(initSmartCrop, 80);
            }
        });

        const startObserving = () => {
            if (document.body) {
                dynamicObserver.observe(document.body, { childList: true, subtree: true });
            }
        };
        if (document.body) {
            startObserving();
        } else {
            document.addEventListener('DOMContentLoaded', startObserving);
        }
    } catch (err) {}
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SmartCropModalController, SmartCropManager };
}

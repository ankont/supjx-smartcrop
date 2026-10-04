<?php

declare(strict_types=1);

namespace SuperSoftJx\Plugin\Content\SmartCrop\Field;

defined('_JEXEC') or die;

use Joomla\CMS\Document\HtmlDocument;
use Joomla\CMS\Factory;
use Joomla\CMS\Form\FormField;
use Joomla\CMS\Language\Text;
use Joomla\CMS\Plugin\PluginHelper;
use Joomla\CMS\Uri\Uri;
use Joomla\Registry\Registry;
use SuperSoftJx\Plugin\Content\SmartCrop\Service\CropValidator;
use SuperSoftJx\Plugin\Content\SmartCrop\Service\ImageNormalizer;
use Throwable;

final class SmartcropField extends FormField
{
    /**
     * The form field type.
     *
     * @var string
     */
    protected $type = 'Smartcrop';

    /**
     * Method to filter the field value before storing or validating.
     *
     * @param   mixed          $value  The raw input value
     * @param   string|null    $group  The field group
     * @param   Registry|null  $input  The input registry
     *
     * @return  array|null     Sanitized array or null
     */
    public function filter($value, $group = null, Registry $input = null)
    {
        if (empty($value)) {
            return null;
        }

        if (is_string($value)) {
            $value = trim($value);
            if ($value === '' || $value === 'null') {
                return null;
            }

            $decoded = json_decode($value, true);
            if (is_array($decoded)) {
                $value = $decoded;
            }
        }

        if (is_array($value)) {
            return CropValidator::validateProfile($value);
        }

        return null;
    }

    /**
     * Method to get the field input markup.
     *
     * @return  string  The field input markup.
     */
    protected function getInput(): string
    {
        $app = Factory::getApplication();
        try {
            $lang = $app->getLanguage();
        } catch (Throwable) {
            $lang = null;
        }
        if (!$lang && class_exists(Factory::class)) {
            try {
                $lang = Factory::getLanguage();
            } catch (Throwable) {
                $lang = null;
            }
        }

        $adminPath = \defined('JPATH_ADMINISTRATOR') ? \JPATH_ADMINISTRATOR : '';
        $sitePath  = \defined('JPATH_SITE') ? \JPATH_SITE : '';
        $pluginPath = \defined('JPATH_PLUGINS') ? \JPATH_PLUGINS . '/content/smartcrop' : dirname(__DIR__, 2);

        if ($lang) {
            if ($adminPath !== '') {
                $lang->load('plg_content_smartcrop', $adminPath);
            }
            if ($sitePath !== '') {
                $lang->load('plg_content_smartcrop', $sitePath);
            }
            if ($pluginPath !== '') {
                $lang->load('plg_content_smartcrop', $pluginPath);
            }
        }

        // Field XML attributes
        $profile     = (string) ($this->element['profile'] ?? 'intro');
        $targetField = (string) ($this->element['target_field'] ?? 'image_intro');

        // Plugin configuration
        $plugin = PluginHelper::getPlugin('content', 'smartcrop');
        $params = new Registry($plugin->params ?? '{}');

        $ratioW = (float) $params->get('ratio_width', 4);
        $ratioH = (float) $params->get('ratio_height', 3);
        if ($ratioW <= 0) {
            $ratioW = 4.0;
        }
        if ($ratioH <= 0) {
            $ratioH = 3.0;
        }

        $previewMaxWidth = (int) $params->get('preview_max_width', 480);
        if ($previewMaxWidth < 240) {
            $previewMaxWidth = 480;
        }

        // Resolve current article image source for this target field
        $currentImageSource = (string) ($this->form->getValue($targetField, 'images') ?? '');

        if ($currentImageSource === '') {
            $currentImageSource = (string) ($this->form->getValue($targetField) ?? '');
        }

        if ($currentImageSource === '') {
            $formData = $this->form->getData();
            if ($formData instanceof Registry) {
                $currentImageSource = (string) ($formData->get('images.' . $targetField) ?? '');
                if ($currentImageSource === '') {
                    $rawImages = $formData->get('images');
                    if (is_string($rawImages)) {
                        $decoded = json_decode($rawImages, true);
                        if (is_array($decoded)) {
                            $currentImageSource = (string) ($decoded[$targetField] ?? '');
                        }
                    } elseif (is_array($rawImages)) {
                        $currentImageSource = (string) ($rawImages[$targetField] ?? '');
                    }
                }
            } elseif (is_object($formData) && isset($formData->images)) {
                $rawImages = $formData->images;
                if (is_string($rawImages)) {
                    $decoded = json_decode($rawImages, true);
                    if (is_array($decoded)) {
                        $currentImageSource = (string) ($decoded[$targetField] ?? '');
                    }
                } elseif (is_array($rawImages)) {
                    $currentImageSource = (string) ($rawImages[$targetField] ?? '');
                } elseif (is_object($rawImages) && isset($rawImages->$targetField)) {
                    $currentImageSource = (string) $rawImages->$targetField;
                }
            } elseif (is_array($formData) && isset($formData['images'])) {
                $rawImages = $formData['images'];
                if (is_string($rawImages)) {
                    $decoded = json_decode($rawImages, true);
                    if (is_array($decoded)) {
                        $currentImageSource = (string) ($decoded[$targetField] ?? '');
                    }
                } elseif (is_array($rawImages)) {
                    $currentImageSource = (string) ($rawImages[$targetField] ?? '');
                }
            }
        }

        // 3. Form storage search under images.smartcrop
        $storedProfile = null;

        // Direct field value (if populated in current form state)
        if (!empty($this->value)) {
            $val = $this->value;
            if (is_string($val)) {
                $decoded = json_decode($val, true);
                if (is_array($decoded)) {
                    $val = $decoded;
                }
            }
            if (is_array($val) && isset($val['crop'])) {
                $storedProfile = $val;
            }
        }

        if ($storedProfile === null) {
            $smartcropRaw = $this->form->getValue('smartcrop', 'images');
            if ($smartcropRaw === null) {
                $formData = $this->form->getData();
                if ($formData instanceof Registry) {
                    $smartcropRaw = $formData->get('images.smartcrop');
                    if ($smartcropRaw === null) {
                        $rawImages = $formData->get('images');
                        if (is_string($rawImages)) {
                            $decoded = json_decode($rawImages, true);
                            $smartcropRaw = $decoded['smartcrop'] ?? null;
                        } elseif (is_array($rawImages)) {
                            $smartcropRaw = $rawImages['smartcrop'] ?? null;
                        }
                    }
                } elseif (is_object($formData) && isset($formData->images)) {
                    $rawImages = $formData->images;
                    if (is_string($rawImages)) {
                        $decoded = json_decode($rawImages, true);
                        $smartcropRaw = $decoded['smartcrop'] ?? null;
                    } elseif (is_array($rawImages)) {
                        $smartcropRaw = $rawImages['smartcrop'] ?? null;
                    } elseif (is_object($rawImages) && isset($rawImages->smartcrop)) {
                        $smartcropRaw = $rawImages->smartcrop;
                    }
                } elseif (is_array($formData) && isset($formData['images'])) {
                    $rawImages = $formData['images'];
                    if (is_string($rawImages)) {
                        $decoded = json_decode($rawImages, true);
                        $smartcropRaw = $decoded['smartcrop'] ?? null;
                    } elseif (is_array($rawImages)) {
                        $smartcropRaw = $rawImages['smartcrop'] ?? null;
                    }
                }
            }

            if (is_string($smartcropRaw)) {
                $smartcropRaw = json_decode($smartcropRaw, true);
            }

            if (is_array($smartcropRaw) && !empty($smartcropRaw['profiles'])) {
                $storedProfile = $smartcropRaw['profiles'][$profile] ?? null;
                if ($storedProfile === null && $profile === 'intro') {
                    $storedProfile = $smartcropRaw['profiles']['default'] ?? null;
                }
            }
        }

        // 4. Database lookup fallback if form has not yet loaded article images (common in frontend/SmartBrowser)
        if ($currentImageSource === '' || $storedProfile === null) {
            $articleId = (int) ($this->form->getValue('id') ?? 0);
            if ($articleId === 0) {
                $formData = $this->form->getData();
                if ($formData instanceof Registry) {
                    $articleId = (int) $formData->get('id', 0);
                } elseif (is_object($formData) && isset($formData->id)) {
                    $articleId = (int) $formData->id;
                } elseif (is_array($formData) && isset($formData['id'])) {
                    $articleId = (int) $formData['id'];
                }
            }
            if ($articleId === 0) {
                $articleId = (int) ($app->getInput()->getInt('id') ?: $app->getInput()->getInt('a_id'));
            }

            if ($articleId > 0) {
                try {
                    $db = Factory::getDbo();
                    $q = $db->getQuery(true)
                        ->select($db->quoteName('images'))
                        ->from($db->quoteName('#__content'))
                        ->where($db->quoteName('id') . ' = ' . $articleId);
                    $rawContentImages = (string) $db->setQuery($q)->loadResult();
                    if ($rawContentImages !== '') {
                        $decodedImages = json_decode($rawContentImages, true);
                        if (is_array($decodedImages)) {
                            if ($currentImageSource === '' && !empty($decodedImages[$targetField])) {
                                $currentImageSource = (string) $decodedImages[$targetField];
                            }
                            if ($storedProfile === null && !empty($decodedImages['smartcrop'])) {
                                $sc = $decodedImages['smartcrop'];
                                if (is_string($sc)) {
                                    $sc = json_decode($sc, true);
                                }
                                if (is_array($sc) && !empty($sc['profiles'])) {
                                    $storedProfile = $sc['profiles'][$profile] ?? null;
                                    if ($storedProfile === null && $profile === 'intro') {
                                        $storedProfile = $sc['profiles']['default'] ?? null;
                                    }
                                }
                            }
                        }
                    }
                } catch (Throwable) {
                }
            }
        }

        $currentImageUrl = $currentImageSource !== '' ? ImageNormalizer::toUrl($currentImageSource) : '';

        $validatedProfile = is_array($storedProfile) ? CropValidator::validateProfile($storedProfile) : null;
        $hasStoredCrop    = $validatedProfile !== null;

        $inputValue = $hasStoredCrop ? htmlspecialchars((string) json_encode($validatedProfile, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), ENT_QUOTES, 'UTF-8') : '';
        $storedProfileJson = $hasStoredCrop ? htmlspecialchars((string) json_encode($validatedProfile), ENT_QUOTES, 'UTF-8') : '';

        // Register Web Assets
        $this->loadAssets();

        // Pass scripts text safely
        try {
            if ($app->getDocument() instanceof HtmlDocument) {
                Text::script('PLG_CONTENT_SMARTCROP_STATUS_ACTIVE');
                Text::script('PLG_CONTENT_SMARTCROP_STATUS_INACTIVE');
                Text::script('PLG_CONTENT_SMARTCROP_NO_IMAGE_DETECTED');
                Text::script('PLG_CONTENT_SMARTCROP_PROMPT_MANUAL_IMAGE');
            }
        } catch (Throwable) {
        }

        $modalId   = 'smartcrop-modal-' . $profile;
        $triggerId = 'smartcrop-trigger-' . $profile;

        ob_start();
        ?>
        <style>
        .smartcrop-field-widget { margin-top: 0.35rem; margin-bottom: 0.85rem; padding: 0.4rem 0.65rem; background: var(--bs-tertiary-bg, #f8f9fa); border: 1px dashed var(--bs-border-color, #dee2e6); border-radius: 6px; display: inline-flex; align-items: center; gap: 0.65rem; flex-wrap: wrap; }
        .smartcrop-field-widget .smartcrop-open-modal-btn { font-weight: 500; display: inline-flex; align-items: center; gap: 0.35rem; }
        .smartcrop-field-widget .smartcrop-badge { font-size: 0.8rem; padding: 0.35em 0.65em; font-weight: 500; letter-spacing: 0.3px; }
        .smartcrop-field-widget .smartcrop-clear-btn { padding: 0.2rem 0.5rem; line-height: 1; }
        .smartcrop-modal { display: none; }
        .smartcrop-modal.smartcrop-modal-visible, .smartcrop-modal.show { display: flex !important; align-items: center; justify-content: center; position: fixed !important; top: 0 !important; left: 0 !important; right: 0 !important; bottom: 0 !important; width: 100vw !important; height: 100vh !important; z-index: 2147483640 !important; background-color: rgba(0, 0, 0, 0.72) !important; backdrop-filter: blur(2px); overflow-x: hidden; overflow-y: auto; padding: 1rem; box-sizing: border-box; opacity: 1 !important; }
        .smartcrop-modal.smartcrop-modal-visible .modal-dialog, .smartcrop-modal.show .modal-dialog { width: 100%; max-width: 680px; margin: auto; transform: none !important; }
        .smartcrop-modal .modal-content { background-color: var(--bs-body-bg, #ffffff); color: var(--bs-body-color, #212529); border-radius: 10px; box-shadow: 0 10px 40px rgba(0,0,0,0.35); overflow: hidden; }
        .smartcrop-modal .modal-header { background: var(--bs-tertiary-bg, #f8f9fa); border-bottom: 1px solid var(--bs-border-color, #dee2e6); padding: 0.85rem 1.25rem; }
        .smartcrop-modal .modal-title { font-size: 1.05rem; font-weight: 600; display: flex; align-items: center; gap: 0.5rem; }
        .smartcrop-modal .modal-body { padding: 1.15rem 1.25rem; }
        .smartcrop-modal .modal-footer { background: var(--bs-tertiary-bg, #f8f9fa); border-top: 1px solid var(--bs-border-color, #dee2e6); padding: 0.75rem 1.25rem; }
        .smartcrop-guide-banner { background-color: var(--bs-tertiary-bg, #f0f4f9); border: 1px solid var(--bs-border-color, #cde0f7); border-radius: 6px; padding: 0.65rem 0.85rem; margin-bottom: 1rem; font-size: 0.84rem; }
        .smartcrop-guide-banner .smartcrop-steps { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; }
        .smartcrop-guide-step { display: inline-flex; align-items: center; gap: 0.3rem; }
        .smartcrop-viewport-wrapper { position: relative; width: 100%; display: flex; justify-content: center; background: #0d1117; border-radius: 8px; border: 1px solid #30363d; box-shadow: inset 0 2px 8px rgba(0,0,0,0.6); overflow: hidden; padding: 14px; }
        .smartcrop-viewport { position: relative; width: 100%; max-width: <?php echo $previewMaxWidth; ?>px; overflow: hidden; background: #161b22; border-radius: 6px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.2); cursor: grab; user-select: none; -webkit-user-select: none; touch-action: none; }
        .smartcrop-viewport.is-dragging { cursor: grabbing; }
        .smartcrop-image { position: absolute; top: 0; left: 0; max-width: none !important; max-height: none !important; user-select: none; -webkit-user-drag: none; pointer-events: none; will-change: transform; transform-origin: 0 0; }
        .smartcrop-corner { position: absolute; width: 16px; height: 16px; pointer-events: none; z-index: 4; filter: drop-shadow(0 0 2px rgba(0,0,0,0.9)); }
        .smartcrop-corner.tl { top: 8px; left: 8px; border-top: 2.5px solid #ffffff; border-left: 2.5px solid #ffffff; }
        .smartcrop-corner.tr { top: 8px; right: 8px; border-top: 2.5px solid #ffffff; border-right: 2.5px solid #ffffff; }
        .smartcrop-corner.bl { bottom: 8px; left: 8px; border-bottom: 2.5px solid #ffffff; border-left: 2.5px solid #ffffff; }
        .smartcrop-corner.br { bottom: 8px; right: 8px; border-bottom: 2.5px solid #ffffff; border-right: 2.5px solid #ffffff; }
        .smartcrop-viewfinder-badge { position: absolute; top: 10px; left: 30px; background: rgba(0,0,0,0.7); color: #f0f6fc; font-size: 0.72rem; font-weight: 600; letter-spacing: 0.4px; padding: 2px 7px; border-radius: 4px; pointer-events: none; z-index: 4; backdrop-filter: blur(4px); border: 1px solid rgba(255,255,255,0.2); }
        .smartcrop-grid { position: absolute; inset: 0; pointer-events: none; opacity: 0.35; transition: opacity 0.2s ease; z-index: 3; }
        .smartcrop-viewport:hover .smartcrop-grid, .smartcrop-viewport.is-dragging .smartcrop-grid { opacity: 0.65; }
        .smartcrop-grid-line { position: absolute; background-color: rgba(255,255,255,0.65); box-shadow: 0 0 1px rgba(0,0,0,0.8); }
        .smartcrop-grid-line.v1 { top: 0; bottom: 0; left: 33.3333%; width: 1px; }
        .smartcrop-grid-line.v2 { top: 0; bottom: 0; left: 66.6666%; width: 1px; }
        .smartcrop-grid-line.h1 { left: 0; right: 0; top: 33.3333%; height: 1px; }
        .smartcrop-grid-line.h2 { left: 0; right: 0; top: 66.6666%; height: 1px; }
        .smartcrop-pan-hint { position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%); background: rgba(13,110,253,0.9); color: #ffffff; font-size: 0.8rem; font-weight: 600; padding: 4px 12px; border-radius: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.45); pointer-events: none; z-index: 5; transition: opacity 0.4s ease, transform 0.4s ease; white-space: nowrap; animation: smartcrop-hint-pulse 2.2s infinite ease-in-out; }
        .smartcrop-pan-hint.is-hidden { opacity: 0; transform: translateX(-50%) translateY(8px); pointer-events: none; }
        @keyframes smartcrop-hint-pulse { 0%, 100% { transform: translateX(-50%) scale(1); } 50% { transform: translateX(-50%) scale(1.04); background: rgba(11,94,215,0.96); } }
        .smartcrop-empty-state { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(22,27,34,0.95); color: #c9d1d9; z-index: 6; padding: 1rem; text-align: center; }
        .smartcrop-empty-state .icon-picture { font-size: 2.5rem; opacity: 0.5; }
        .smartcrop-toolbar { background: var(--bs-tertiary-bg, #f8f9fa); padding: 0.65rem 0.85rem; border-radius: 6px; border: 1px solid var(--bs-border-color, #dee2e6); }
        .smartcrop-zoom-controls { flex: 1 1 240px; max-width: 340px; }
        .smartcrop-zoom-slider { cursor: pointer; flex: 1; }
        .smartcrop-zoom-value { min-width: 40px; text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; font-size: 0.85rem; }
        .smartcrop-presets { display: flex; align-items: center; gap: 3px; }
        .smartcrop-btn-preset { font-size: 0.76rem; padding: 0.2rem 0.45rem; border-radius: 4px; font-weight: 500; }
        .smartcrop-btn-preset.is-active { background-color: var(--bs-primary, #0d6efd); color: #fff; border-color: var(--bs-primary, #0d6efd); }
        .smartcrop-live-coords-bar { font-family: SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 0.75rem; background: var(--bs-body-bg, #fff); border: 1px solid var(--bs-border-color, #dee2e6); border-radius: 4px; padding: 0.25rem 0.6rem; color: var(--bs-secondary-color, #6c757d); display: inline-flex; align-items: center; gap: 5px; }
        </style>

        <!-- Inline Trigger Widget -->
        <div id="<?php echo htmlspecialchars($triggerId, ENT_QUOTES, 'UTF-8'); ?>"
             class="smartcrop-field-widget"
             data-smartcrop-widget
             data-profile="<?php echo htmlspecialchars($profile, ENT_QUOTES, 'UTF-8'); ?>"
             data-target-field="<?php echo htmlspecialchars($targetField, ENT_QUOTES, 'UTF-8'); ?>"
             data-modal-id="<?php echo htmlspecialchars($modalId, ENT_QUOTES, 'UTF-8'); ?>"
        >
            <input type="hidden"
                   name="<?php echo htmlspecialchars($this->name, ENT_QUOTES, 'UTF-8'); ?>"
                   id="<?php echo htmlspecialchars($this->id, ENT_QUOTES, 'UTF-8'); ?>"
                   value="<?php echo $inputValue; ?>"
                   data-smartcrop-input
            />

            <button type="button"
                    class="btn btn-sm btn-outline-primary smartcrop-open-modal-btn"
                    data-smartcrop-open-modal-btn
                    data-bs-toggle="modal"
                    data-bs-target="#<?php echo htmlspecialchars($modalId, ENT_QUOTES, 'UTF-8'); ?>"
                    onclick="window.SmartCropOpenModal &amp;&amp; window.SmartCropOpenModal('<?php echo htmlspecialchars($profile, ENT_QUOTES, 'UTF-8'); ?>', event);"
            >
                <span class="icon-crop" aria-hidden="true"></span>
                <span><?php echo Text::_('PLG_CONTENT_SMARTCROP_OPEN_MODAL_BUTTON'); ?> (<?php echo $ratioW; ?>:<?php echo $ratioH; ?>)</span>
            </button>

            <span class="smartcrop-badge badge <?php echo $hasStoredCrop ? 'bg-success' : 'bg-light text-muted border'; ?>"
                  data-smartcrop-badge
            >
                <?php echo $hasStoredCrop ? Text::sprintf('PLG_CONTENT_SMARTCROP_STATUS_ACTIVE', $ratioW, $ratioH) : Text::_('PLG_CONTENT_SMARTCROP_STATUS_INACTIVE'); ?>
            </span>

            <button type="button"
                    class="btn btn-sm btn-outline-danger smartcrop-clear-btn <?php echo $hasStoredCrop ? '' : 'd-none'; ?>"
                    data-smartcrop-clear-btn
                    title="<?php echo Text::_('PLG_CONTENT_SMARTCROP_REMOVE_CROP'); ?>"
            >
                <span class="icon-trash" aria-hidden="true"></span>
            </button>
        </div>

        <!-- Bootstrap 5 Modal Framing Dialog -->
        <div class="modal fade smartcrop-modal"
             id="<?php echo htmlspecialchars($modalId, ENT_QUOTES, 'UTF-8'); ?>"
             tabindex="-1"
             aria-hidden="true"
             data-smartcrop-modal
             data-profile="<?php echo htmlspecialchars($profile, ENT_QUOTES, 'UTF-8'); ?>"
             data-target-field="<?php echo htmlspecialchars($targetField, ENT_QUOTES, 'UTF-8'); ?>"
             data-ratio-w="<?php echo $ratioW; ?>"
             data-ratio-h="<?php echo $ratioH; ?>"
             data-max-width="<?php echo $previewMaxWidth; ?>"
             data-site-root="<?php echo htmlspecialchars(rtrim(preg_replace('#/index\.php/?$#i', '/', (string) Uri::root()), '/'), ENT_QUOTES, 'UTF-8'); ?>"
             data-base-path="<?php echo htmlspecialchars(rtrim(preg_replace('#/index\.php/?$#i', '/', (string) Uri::root(true)), '/'), ENT_QUOTES, 'UTF-8'); ?>"
             data-active-source="<?php echo htmlspecialchars($currentImageSource, ENT_QUOTES, 'UTF-8'); ?>"
             data-active-url="<?php echo htmlspecialchars($currentImageUrl, ENT_QUOTES, 'UTF-8'); ?>"
             data-stored-profile="<?php echo $storedProfileJson; ?>"
        >
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">
                            <span class="icon-crop" aria-hidden="true"></span>
                            <span>
                                <?php echo $profile === 'intro'
                                    ? Text::sprintf('PLG_CONTENT_SMARTCROP_MODAL_TITLE_INTRO', $ratioW, $ratioH)
                                    : Text::sprintf('PLG_CONTENT_SMARTCROP_MODAL_TITLE_FULLTEXT', $ratioW, $ratioH);
                                ?>
                            </span>
                        </h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" data-smartcrop-cancel onclick="window.SmartCropCloseModal &amp;&amp; window.SmartCropCloseModal(this.closest('.smartcrop-modal'));" aria-label="<?php echo Text::_('PLG_CONTENT_SMARTCROP_CANCEL'); ?>"></button>
                    </div>

                    <div class="modal-body">
                        <!-- Quick Guide -->
                        <div class="smartcrop-guide-banner">
                            <div class="smartcrop-steps">
                                <span class="smartcrop-guide-step">
                                    <span class="badge bg-primary">1</span>
                                    <span><?php echo Text::_('PLG_CONTENT_SMARTCROP_STEP_1'); ?></span>
                                </span>
                                <span class="smartcrop-guide-step">
                                    <span class="badge bg-primary">2</span>
                                    <span><?php echo Text::_('PLG_CONTENT_SMARTCROP_STEP_2'); ?></span>
                                </span>
                                <span class="smartcrop-guide-step">
                                    <span class="badge bg-primary">3</span>
                                    <span><?php echo Text::_('PLG_CONTENT_SMARTCROP_STEP_3'); ?></span>
                                </span>
                            </div>
                        </div>

                        <!-- Viewport Framing Container -->
                        <div class="smartcrop-viewport-wrapper">
                            <div class="smartcrop-viewport"
                                 data-smartcrop-viewport
                                 style="aspect-ratio: <?php echo $ratioW; ?> / <?php echo $ratioH; ?>; max-width: <?php echo $previewMaxWidth; ?>px;"
                            >
                                <!-- Camera Reticle Corners -->
                                <div class="smartcrop-corner tl" aria-hidden="true"></div>
                                <div class="smartcrop-corner tr" aria-hidden="true"></div>
                                <div class="smartcrop-corner bl" aria-hidden="true"></div>
                                <div class="smartcrop-corner br" aria-hidden="true"></div>

                                <!-- Viewfinder Badge -->
                                <div class="smartcrop-viewfinder-badge" aria-hidden="true">
                                    📐 <?php echo Text::sprintf('PLG_CONTENT_SMARTCROP_VIEWPORT_BADGE', $ratioW, $ratioH); ?>
                                </div>

                                <!-- Framed Image -->
                                <img src="<?php echo htmlspecialchars($currentImageUrl, ENT_QUOTES, 'UTF-8'); ?>"
                                     alt=""
                                     class="smartcrop-image <?php echo $currentImageUrl === '' ? 'd-none' : ''; ?>"
                                     data-smartcrop-image
                                     draggable="false"
                                />

                                <!-- Rule of Thirds Guide Grid -->
                                <div class="smartcrop-grid" aria-hidden="true">
                                    <div class="smartcrop-grid-line v1"></div>
                                    <div class="smartcrop-grid-line v2"></div>
                                    <div class="smartcrop-grid-line h1"></div>
                                    <div class="smartcrop-grid-line h2"></div>
                                </div>

                                <!-- Floating Pan Hint Pill -->
                                <div class="smartcrop-pan-hint <?php echo $currentImageUrl === '' ? 'd-none' : ''; ?>"
                                     data-smartcrop-pan-hint>
                                    🖐️ <?php echo Text::_('PLG_CONTENT_SMARTCROP_PAN_HINT'); ?>
                                </div>

                                <!-- Empty State -->
                                <div class="smartcrop-empty-state <?php echo $currentImageUrl !== '' ? 'd-none' : ''; ?>"
                                     data-smartcrop-empty-state>
                                    <div>
                                        <span class="icon-picture display-4 mb-2 d-block" aria-hidden="true"></span>
                                        <p class="mb-3 small"><?php echo Text::_('PLG_CONTENT_SMARTCROP_NO_IMAGE_IN_FIELD'); ?></p>
                                        <button type="button"
                                                class="btn btn-sm btn-primary"
                                                data-smartcrop-select-media>
                                            <span class="icon-picture" aria-hidden="true"></span>
                                            <span><?php echo Text::_('PLG_CONTENT_SMARTCROP_SELECT_IMAGE'); ?></span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Controls Toolbar -->
                        <div class="smartcrop-toolbar d-flex flex-wrap align-items-center justify-content-between gap-2 mt-3 <?php echo $currentImageUrl === '' ? 'd-none' : ''; ?>"
                             data-smartcrop-toolbar>
                            <div class="smartcrop-zoom-controls d-flex align-items-center gap-2">
                                <button type="button"
                                        class="btn btn-sm btn-outline-secondary"
                                        data-smartcrop-zoom-out
                                        title="<?php echo Text::_('PLG_CONTENT_SMARTCROP_ZOOM_OUT'); ?>">
                                    <span class="icon-minus" aria-hidden="true"></span>
                                </button>

                                <input type="range"
                                       class="form-range smartcrop-zoom-slider"
                                       min="1.0"
                                       max="3.0"
                                       step="0.01"
                                       value="1.0"
                                       data-smartcrop-zoom-slider
                                       aria-label="<?php echo Text::_('PLG_CONTENT_SMARTCROP_ZOOM_SLIDER'); ?>"
                                />

                                <button type="button"
                                        class="btn btn-sm btn-outline-secondary"
                                        data-smartcrop-zoom-in
                                        title="<?php echo Text::_('PLG_CONTENT_SMARTCROP_ZOOM_IN'); ?>">
                                    <span class="icon-plus" aria-hidden="true"></span>
                                </button>

                                <span class="smartcrop-zoom-value" data-smartcrop-zoom-value>100%</span>
                            </div>

                            <!-- Quick Zoom Presets -->
                            <div class="smartcrop-presets" data-smartcrop-presets>
                                <button type="button"
                                        class="btn btn-sm btn-primary smartcrop-btn-preset is-active"
                                        data-smartcrop-zoom-preset="1.0">
                                    <?php echo Text::_('PLG_CONTENT_SMARTCROP_ZOOM_FIT'); ?>
                                </button>
                                <button type="button"
                                        class="btn btn-sm btn-outline-secondary smartcrop-btn-preset"
                                        data-smartcrop-zoom-preset="1.25">
                                    125%
                                </button>
                                <button type="button"
                                        class="btn btn-sm btn-outline-secondary smartcrop-btn-preset"
                                        data-smartcrop-zoom-preset="1.5">
                                    150%
                                </button>
                                <button type="button"
                                        class="btn btn-sm btn-outline-secondary smartcrop-btn-preset"
                                        data-smartcrop-zoom-preset="2.0">
                                    200%
                                </button>
                            </div>

                            <!-- Live Coordinates Readout -->
                            <div class="smartcrop-live-coords-bar" data-smartcrop-live-coords-bar>
                                <span class="icon-crop" aria-hidden="true"></span>
                                <span data-smartcrop-live-coords>-</span>
                            </div>

                            <button type="button"
                                    class="btn btn-sm btn-outline-danger smartcrop-btn-reset ms-auto"
                                    data-smartcrop-reset
                                    title="<?php echo Text::_('PLG_CONTENT_SMARTCROP_RESET_TITLE'); ?>">
                                <span class="icon-loop" aria-hidden="true"></span>
                                <span><?php echo Text::_('PLG_CONTENT_SMARTCROP_RESET'); ?></span>
                            </button>
                        </div>
                    </div>

                    <div class="modal-footer d-flex justify-content-between">
                        <button type="button" class="btn btn-sm btn-secondary" data-bs-dismiss="modal" data-smartcrop-cancel onclick="window.SmartCropCloseModal &amp;&amp; window.SmartCropCloseModal(this.closest('.smartcrop-modal'));">
                            <?php echo Text::_('PLG_CONTENT_SMARTCROP_CANCEL'); ?>
                        </button>
                        <button type="button" class="btn btn-sm btn-primary" data-smartcrop-apply-btn>
                            <span class="icon-check" aria-hidden="true"></span>
                            <span><?php echo Text::_('PLG_CONTENT_SMARTCROP_APPLY_FRAME'); ?></span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
        <!-- Resilient Standalone Controller Bootstrapper & Event Delegation -->
        <script>
        (function() {
            var scriptUrl = '<?php echo htmlspecialchars(rtrim(preg_replace('#/index\.php/?$#i', '/', (string) Uri::root()), '/') . '/media/plg_content_smartcrop/js/smartcrop-editor.js?v=1.0.0-beta1', ENT_QUOTES, 'UTF-8'); ?>';
            var cssUrl = '<?php echo htmlspecialchars(rtrim(preg_replace('#/index\.php/?$#i', '/', (string) Uri::root()), '/') . '/media/plg_content_smartcrop/css/smartcrop-editor.css?v=1.0.0-beta1', ENT_QUOTES, 'UTF-8'); ?>';

            // Ensure CSS stylesheet is present in the DOM (works in non-standard templates, Gantry 5, AJAX modals)
            if (!document.querySelector('link[href*="smartcrop-editor.css"]')) {
                var link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = cssUrl;
                document.head.appendChild(link);
            }

            // Ensure JS controller is loaded
            function ensureScript(callback) {
                if (window.SmartCropModalController) {
                    if (callback) callback();
                    return;
                }
                var existing = document.querySelector('script[src*="smartcrop-editor.js"]');
                if (!existing) {
                    var s = document.createElement('script');
                    s.src = scriptUrl;
                    s.defer = true;
                    s.onload = function() {
                        if (callback) callback();
                    };
                    document.head.appendChild(s);
                } else {
                    existing.addEventListener('load', function() {
                        if (callback) callback();
                    }, { once: true });
                }
            }

            // Universal Close Modal function (safe to call from inline onclick or event delegation)
            window.SmartCropCloseModal = function(modalEl) {
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

            // Universal Open Modal function (safe to call from inline onclick or event delegation)
            window.SmartCropOpenModal = window.SmartCropOpenModal || function(profile, event) {
                if (event) {
                    event.preventDefault();
                    event.stopPropagation();
                }
                var modalEl = document.getElementById('smartcrop-modal-' + profile)
                    || document.querySelector('[data-smartcrop-modal][data-profile="' + profile + '"]');
                if (!modalEl) return;

                // Move to document.body so it is never trapped in scroll/overflow containers
                if (modalEl.parentNode !== document.body) {
                    document.body.appendChild(modalEl);
                }

                // Show modal instantly with pure CSS & highest z-index
                modalEl.classList.add('show', 'smartcrop-modal-visible');
                modalEl.style.display = 'flex';
                modalEl.style.zIndex = '2147483640';
                modalEl.removeAttribute('aria-hidden');
                modalEl.setAttribute('aria-modal', 'true');
                document.body.classList.add('modal-open');

                ensureScript(function() {
                    if (window.SmartCropModalController) {
                        if (!modalEl._smartcropController) {
                            modalEl._smartcropController = new window.SmartCropModalController(modalEl);
                        }
                        modalEl._smartcropController.openModal();
                    }
                });
            };

            // Global click delegation for all SmartCrop open buttons (works with AJAX-injected editors)
            if (!window._smartcropClickDelegated) {
                window._smartcropClickDelegated = true;
                document.addEventListener('click', function(e) {
                    var btn = e.target.closest('.smartcrop-open-modal-btn, [data-smartcrop-open-modal-btn]');
                    if (btn) {
                        e.preventDefault();
                        e.stopPropagation();
                        var widget = btn.closest('[data-smartcrop-widget]');
                        var profile = (widget && widget.dataset.profile)
                            || (btn.dataset.bsTarget && btn.dataset.bsTarget.replace('#smartcrop-modal-', ''))
                            || 'intro';
                        window.SmartCropOpenModal(profile, e);
                    }
                }, true);
            }

            // Global click delegation for all SmartCrop close/cancel buttons
            if (!window._smartcropCloseDelegated) {
                window._smartcropCloseDelegated = true;
                document.addEventListener('click', function(e) {
                    var closeBtn = e.target.closest('[data-smartcrop-cancel], [data-bs-dismiss="modal"]');
                    if (closeBtn) {
                        var modal = closeBtn.closest('.smartcrop-modal');
                        if (modal) {
                            e.preventDefault();
                            e.stopPropagation();
                            window.SmartCropCloseModal(modal);
                        }
                    }
                }, true);
            }

            // Pre-load script in background
            ensureScript();
        })();
        </script>
        <?php
        return (string) ob_get_clean();
    }

    /**
     * Registers Web Assets for the SmartCrop editor.
     *
     * @return  void
     */
    private function loadAssets(): void
    {
        $app = Factory::getApplication();
        $doc = $app->getDocument();

        if (!$doc instanceof HtmlDocument) {
            return;
        }

        $wa = $doc->getWebAssetManager();

        try {
            $wa->getRegistry()->addExtensionRegistryFile('plg_content_smartcrop');
        } catch (Throwable) {
        }

        try {
            if ($wa->getRegistry()->exists('style', 'plg_content_smartcrop.editor-style')) {
                $wa->useStyle('plg_content_smartcrop.editor-style');
            } else {
                $wa->registerAndUseStyle(
                    'plg_content_smartcrop.editor-style',
                    'plg_content_smartcrop/css/smartcrop-editor.css'
                );
            }

            if ($wa->getRegistry()->exists('script', 'plg_content_smartcrop.editor')) {
                $wa->useScript('plg_content_smartcrop.editor');
            } else {
                $wa->registerAndUseScript(
                    'plg_content_smartcrop.editor',
                    'plg_content_smartcrop/js/smartcrop-editor.js',
                    ['core'],
                    ['defer' => true]
                );
            }
        } catch (Throwable) {
            try {
                $wa->registerAndUseStyle(
                    'plg_content_smartcrop.editor-style',
                    'plg_content_smartcrop/css/smartcrop-editor.css'
                );
                $wa->registerAndUseScript(
                    'plg_content_smartcrop.editor',
                    'plg_content_smartcrop/js/smartcrop-editor.js',
                    ['core'],
                    ['defer' => true]
                );
            } catch (Throwable) {
            }
        }
    }
}

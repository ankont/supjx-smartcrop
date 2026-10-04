<?php

declare(strict_types=1);

namespace SuperSoftJx\Plugin\Content\SmartCrop\Extension;

defined('_JEXEC') or die;

use Joomla\CMS\Document\HtmlDocument;
use Joomla\CMS\Event\Model\BeforeSaveEvent;
use Joomla\CMS\Event\Model\BeforeValidateDataEvent;
use Joomla\CMS\Event\Model\PrepareFormEvent;
use Joomla\CMS\Factory;
use Joomla\CMS\Form\Form;
use Joomla\CMS\Form\FormHelper;
use Joomla\CMS\Plugin\CMSPlugin;
use Joomla\Event\SubscriberInterface;
use SuperSoftJx\Plugin\Content\SmartCrop\Helper\SmartCropHelper;
use SuperSoftJx\Plugin\Content\SmartCrop\Service\CropValidator;
use Throwable;

final class SmartCrop extends CMSPlugin implements SubscriberInterface
{
    /**
     * Automatically load language files when plugin is instantiated.
     *
     * @var boolean
     */
    protected $autoloadLanguage = true;

    /**
     * Subscribed events for Joomla 5.4+ and Joomla 6.
     *
     * @return array<string, string>
     */
    public static function getSubscribedEvents(): array
    {
        return [
            'onContentPrepare'            => 'onContentPrepare',
            'onContentPrepareForm'        => 'onContentPrepareForm',
            'onContentBeforeValidateData' => 'onContentBeforeValidateData',
            'onContentBeforeSave'         => 'onContentBeforeSave',
        ];
    }

    /**
     * Intercepts content rendering to enrich article items with SmartCrop presentation styles
     * for standard Joomla templates and layout helpers.
     *
     * @param   string  $context  The context (e.g. 'com_content.article' or 'com_content.category')
     * @param   object  $item     The item being rendered
     * @param   mixed   $params   Parameters
     * @param   int     $page     Page number
     *
     * @return  void
     */
    public function onContentPrepare(string $context, object &$item, mixed &$params, int $page = 0): void
    {
        if (!is_object($item)) {
            return;
        }

        $images = $item->images ?? null;
        if (empty($images)) {
            return;
        }

        $imagesArr = null;
        if (is_string($images)) {
            $trimmed = trim($images);
            if ($trimmed !== '' && ($trimmed[0] === '{' || $trimmed[0] === '[')) {
                $imagesArr = json_decode($trimmed, true);
            }
        } elseif (is_array($images)) {
            $imagesArr = $images;
        } elseif (is_object($images)) {
            $imagesArr = (array) $images;
        }

        if (!is_array($imagesArr)) {
            return;
        }

        $introUri = (string) ($imagesArr['image_intro'] ?? '');
        $fullUri  = (string) ($imagesArr['image_fulltext'] ?? '');

        $introStyle = '';
        $fullStyle  = '';

        if ($introUri !== '') {
            $introStyle = SmartCropHelper::getCssStyle($introUri);
            if ($introStyle === '' && isset($imagesArr['smartcrop'])) {
                $introStyle = SmartCropHelper::getCssStyle($item, 'intro');
            }
        }

        if ($fullUri !== '') {
            $fullStyle = SmartCropHelper::getCssStyle($fullUri);
            if ($fullStyle === '' && isset($imagesArr['smartcrop'])) {
                $fullStyle = SmartCropHelper::getCssStyle($item, 'fulltext');
            }
        }

        $item->smartcrop_intro_style    = $introStyle;
        $item->smartcrop_fulltext_style = $fullStyle;

        if (isset($item->images) && is_object($item->images)) {
            $item->images->intro_style    = $introStyle;
            $item->images->fulltext_style = $fullStyle;
        } elseif (isset($item->images) && is_array($item->images)) {
            $item->images['intro_style']    = $introStyle;
            $item->images['fulltext_style'] = $fullStyle;
        }
    }

    /**
     * Integrates SmartCrop form definition into the com_content.article edit form
     * and registers web assets for all forms featuring media fields.
     *
     * @param   mixed  $event  PrepareFormEvent or Form
     *
     * @return  void
     */
    public function onContentPrepareForm(mixed $event): void
    {
        $form = null;

        if ($event instanceof PrepareFormEvent) {
            $form = $event->getForm();
        } elseif ($event instanceof Form) {
            $form = $event;
        }

        if (!$form instanceof Form) {
            return;
        }

        $formName = $form->getName();

        try {
            $this->loadLanguage();
        } catch (Throwable) {
        }

        try {
            $lang = Factory::getApplication()->getLanguage();
            $adminPath = \defined('JPATH_ADMINISTRATOR') ? \JPATH_ADMINISTRATOR : '';
            $sitePath  = \defined('JPATH_SITE') ? \JPATH_SITE : '';
            $pluginPath = \defined('JPATH_PLUGINS') ? \JPATH_PLUGINS . '/content/smartcrop' : dirname(__DIR__, 2);
            if ($adminPath !== '') {
                $lang->load('plg_content_smartcrop', $adminPath);
            }
            if ($sitePath !== '') {
                $lang->load('plg_content_smartcrop', $sitePath);
            }
            if ($pluginPath !== '') {
                $lang->load('plg_content_smartcrop', $pluginPath);
            }
        } catch (Throwable) {
        }

        // Register custom form field prefix
        FormHelper::addFieldPrefix('SuperSoftJx\\Plugin\\Content\\SmartCrop\\Field');

        // Always register Web Asset in document for forms
        try {
            $doc = Factory::getApplication()->getDocument();
            if ($doc instanceof HtmlDocument) {
                $wa = $doc->getWebAssetManager();
                $wa->useScript('plg_content_smartcrop.editor');
                $wa->useStyle('plg_content_smartcrop.editor-style');
            }
        } catch (Throwable) {
        }

        if ($formName === 'com_content.article') {
            // Locate and inject form definition for articles
            $xmlPath = \defined('JPATH_PLUGINS') ? \JPATH_PLUGINS . '/content/smartcrop/forms/article_smartcrop.xml' : '';
            if ($xmlPath === '' || !file_exists($xmlPath)) {
                $xmlPath = dirname(__DIR__, 2) . '/forms/article_smartcrop.xml';
            }

            if (file_exists($xmlPath)) {
                $form->loadFile($xmlPath, false);
            }
        }
    }

    /**
     * Ensures SmartCrop field data submitted as a JSON string is parsed into a clean PHP array
     * before form validation and serialization.
     *
     * @param   mixed  $event  BeforeValidateDataEvent
     *
     * @return  void
     */
    public function onContentBeforeValidateData(mixed $event): void
    {
        if (!$event instanceof BeforeValidateDataEvent) {
            return;
        }

        $form = $event->getSubject();
        if ($form instanceof Form && $form->getName() !== 'com_content.article') {
            return;
        }

        $data = $event->getData();
        if (!is_array($data) || empty($data['images']) || !is_array($data['images'])) {
            return;
        }

        $images = &$data['images'];
        $modified = false;

        // Existing smartcrop data if present
        $existingSmartcrop = $images['smartcrop'] ?? null;
        if (is_string($existingSmartcrop)) {
            $rawJson = trim($existingSmartcrop);
            $existingSmartcrop = ($rawJson !== '' && ($rawJson[0] === '{' || $rawJson[0] === '['))
                ? json_decode($rawJson, true)
                : null;
        }

        $smartcropData = is_array($existingSmartcrop) ? $existingSmartcrop : ['version' => 1, 'profiles' => []];
        if (!isset($smartcropData['profiles']) || !is_array($smartcropData['profiles'])) {
            $smartcropData['profiles'] = [];
        }

        // Process smartcrop_intro from form
        if (array_key_exists('smartcrop_intro', $images)) {
            $rawIntro = $images['smartcrop_intro'];
            unset($images['smartcrop_intro']);
            $modified = true;

            if (!empty($rawIntro)) {
                $intro = is_string($rawIntro) ? json_decode($rawIntro, true) : $rawIntro;
                if (is_array($intro)) {
                    $validatedIntro = CropValidator::validateProfile($intro);
                    if ($validatedIntro !== null) {
                        $smartcropData['profiles']['intro'] = $validatedIntro;
                    } else {
                        unset($smartcropData['profiles']['intro']);
                    }
                }
            } else {
                unset($smartcropData['profiles']['intro']);
            }
        }

        // Process smartcrop_fulltext from form
        if (array_key_exists('smartcrop_fulltext', $images)) {
            $rawFull = $images['smartcrop_fulltext'];
            unset($images['smartcrop_fulltext']);
            $modified = true;

            if (!empty($rawFull)) {
                $full = is_string($rawFull) ? json_decode($rawFull, true) : $rawFull;
                if (is_array($full)) {
                    $validatedFull = CropValidator::validateProfile($full);
                    if ($validatedFull !== null) {
                        $smartcropData['profiles']['fulltext'] = $validatedFull;
                    } else {
                        unset($smartcropData['profiles']['fulltext']);
                    }
                }
            } else {
                unset($smartcropData['profiles']['fulltext']);
            }
        }

        // Auto-extract crop from image_intro if encoded in #joomlaImage://
        if (!isset($smartcropData['profiles']['intro']) && !empty($images['image_intro']) && is_string($images['image_intro'])) {
            $parsedIntro = SmartCropHelper::parseCropFromUri($images['image_intro']);
            if ($parsedIntro !== null) {
                $smartcropData['profiles']['intro'] = [
                    'source' => $parsedIntro['source'],
                    'ratio'  => $parsedIntro['ratio'],
                    'crop'   => $parsedIntro['crop'],
                    'zoom'   => $parsedIntro['zoom'],
                ];
                $modified = true;
            }
        }

        // Auto-extract crop from image_fulltext if encoded in #joomlaImage://
        if (!isset($smartcropData['profiles']['fulltext']) && !empty($images['image_fulltext']) && is_string($images['image_fulltext'])) {
            $parsedFull = SmartCropHelper::parseCropFromUri($images['image_fulltext']);
            if ($parsedFull !== null) {
                $smartcropData['profiles']['fulltext'] = [
                    'source' => $parsedFull['source'],
                    'ratio'  => $parsedFull['ratio'],
                    'crop'   => $parsedFull['crop'],
                    'zoom'   => $parsedFull['zoom'],
                ];
                $modified = true;
            }
        }

        // If direct 'smartcrop' array/json was submitted (e.g. from existing unit test or direct API)
        if (isset($smartcropData['profiles']['default']) && !isset($smartcropData['profiles']['intro']) && !isset($smartcropData['profiles']['fulltext'])) {
            $validated = CropValidator::validateAndClean($smartcropData);
            if ($validated !== null) {
                $smartcropData = $validated;
                $modified = true;
            }
        }

        // Maintain default profile
        if (isset($smartcropData['profiles']['intro'])) {
            $smartcropData['profiles']['default'] = $smartcropData['profiles']['intro'];
        } elseif (isset($smartcropData['profiles']['fulltext'])) {
            $smartcropData['profiles']['default'] = $smartcropData['profiles']['fulltext'];
        }

        $validatedAll = CropValidator::validateAndClean($smartcropData);
        if ($validatedAll !== null) {
            $images['smartcrop'] = $validatedAll;
            $modified = true;
        } elseif ($modified) {
            unset($images['smartcrop']);
        }

        if ($modified || isset($images['smartcrop'])) {
            $event->setData($data);
        }
    }

    /**
     * Prepares and merges SmartCrop metadata inside the article's images JSON before storage.
     *
     * Guarantees:
     * - Preserves all other native or third-party image metadata in #__content.images
     * - Stored as a genuine nested JSON object, not an escaped string
     * - Save as Copy automatically carries over SmartCrop metadata
     *
     * @param   mixed  $event  BeforeSaveEvent or context string
     *
     * @return  void
     */
    public function onContentBeforeSave(mixed $event): void
    {
        $context = '';
        $table   = null;

        if ($event instanceof BeforeSaveEvent) {
            $context = $event->getContext();
            $table   = $event->getItem();
        } else {
            $context = (string) $event;
            $table   = func_num_args() > 1 ? func_get_arg(1) : null;
        }

        if ($context !== 'com_content.article' || !is_object($table)) {
            return;
        }

        if (!property_exists($table, 'images')) {
            return;
        }

        $images = $table->images;

        if (is_string($images)) {
            $images = trim($images);
            if ($images !== '' && ($images[0] === '{' || $images[0] === '[')) {
                $images = json_decode($images, true);
            }
        }

        if (is_object($images)) {
            $images = (array) $images;
        }

        if (!is_array($images)) {
            return;
        }

        if (isset($images['smartcrop'])) {
            $cropData = $images['smartcrop'];

            if (is_string($cropData)) {
                $cropData = json_decode($cropData, true);
            }

            if (is_array($cropData)) {
                $clean = CropValidator::validateAndClean($cropData);
                if ($clean !== null) {
                    $images['smartcrop'] = $clean;
                } else {
                    unset($images['smartcrop']);
                }
            } else {
                unset($images['smartcrop']);
            }

            try {
                $table->images = json_encode($images, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            } catch (Throwable) {
                // Keep original images if encoding fails
            }
        }
    }
}

<?php

declare(strict_types=1);

namespace SuperSoft\Plugin\Content\SmartCrop\Extension;

defined('_JEXEC') or die;

use Joomla\CMS\Document\HtmlDocument;
use Joomla\CMS\Event\Model\PrepareFormEvent;
use Joomla\CMS\Factory;
use Joomla\CMS\Form\Form;
use Joomla\CMS\Plugin\CMSPlugin;
use Joomla\Event\SubscriberInterface;
use SuperSoft\Plugin\Content\SmartCrop\Helper\SmartCropHelper;
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
            'onContentPrepare'     => 'onContentPrepare',
            'onContentPrepareForm' => 'onContentPrepareForm',
            'onBeforeCompileHead'  => 'onBeforeCompileHead',
        ];
    }

    /**
     * Intercepts content rendering to enrich article items with SmartCrop presentation styles
     * for standard Joomla templates and layout helpers.
     *
     * Supports both modern Joomla 5/6 ContentPrepareEvent and legacy positional arguments.
     *
     * @param   mixed  $contextOrEvent  ContentPrepareEvent or string context
     * @param   mixed  $item            The item being rendered (legacy)
     * @param   mixed  $params          Parameters (legacy)
     * @param   int    $page            Page number (legacy)
     *
     * @return  void
     */
    public function onContentPrepare(mixed $contextOrEvent, mixed &$item = null, mixed &$params = null, int $page = 0): void
    {
        if (is_object($contextOrEvent) && method_exists($contextOrEvent, 'getItem')) {
            $item = $contextOrEvent->getItem();
        } elseif (is_object($contextOrEvent) && method_exists($contextOrEvent, 'getArgument')) {
            $item = $contextOrEvent->getArgument('subject') ?? $contextOrEvent->getArgument('item');
        }

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
        }

        if ($fullUri !== '') {
            $fullStyle = SmartCropHelper::getCssStyle($fullUri);
        }

        $item->smartcrop_intro_style    = $introStyle;
        $item->smartcrop_fulltext_style = $fullStyle;

        if (is_string($item->images)) {
            $decoded = json_decode($item->images);
            if (is_object($decoded)) {
                $decoded->intro_style    = $introStyle;
                $decoded->fulltext_style = $fullStyle;
                $item->images = json_encode($decoded);
            }
        } elseif (is_object($item->images)) {
            $item->images->intro_style    = $introStyle;
            $item->images->fulltext_style = $fullStyle;
        } elseif (is_array($item->images)) {
            $item->images['intro_style']    = $introStyle;
            $item->images['fulltext_style'] = $fullStyle;
        }
    }

    /**
     * Registers Web Asset Manager (CSS & JS) and loads languages for edit forms
     * containing media fields (articles, categories, custom fields, etc.).
     *
     * @param   mixed  $event  PrepareFormEvent or Form
     *
     * @return  void
     */
    public function onContentPrepareForm(mixed $event): void
    {
        $this->registerAssets();
    }

    /**
     * Intercepts head compilation to ensure SmartCrop assets are loaded in admin / edit views.
     *
     * @param   mixed  $event  BeforeCompileHeadEvent
     *
     * @return  void
     */
    public function onBeforeCompileHead(mixed $event = null): void
    {
        try {
            $app = Factory::getApplication();
            if ($app->isClient('administrator')) {
                $this->registerAssets();
            }
        } catch (Throwable) {
        }
    }

    /**
     * Registers Web Asset Manager (CSS & JS) and loads language files.
     *
     * @return  void
     */
    public function registerAssets(): void
    {
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

        // Register Web Asset Manager assets (JS editor & CSS)
        try {
            $doc = Factory::getApplication()->getDocument();
            if ($doc instanceof HtmlDocument) {
                $doc->addScriptOptions('plg_content_smartcrop', $this->getEditorOptions());
                $wa = $doc->getWebAssetManager();
                $reg = $wa->getRegistry();
                if (!$reg->exists('script', 'plg_content_smartcrop.editor')) {
                    $reg->addExtensionRegistryFile('plg_content_smartcrop');
                }
                $wa->useScript('plg_content_smartcrop.editor');
                $wa->useStyle('plg_content_smartcrop.editor-style');
            }
        } catch (Throwable) {
            try {
                $doc = Factory::getApplication()->getDocument();
                if ($doc instanceof HtmlDocument) {
                    $doc->addScriptOptions('plg_content_smartcrop', $this->getEditorOptions());
                    $doc->addScript(\Joomla\CMS\Uri\Uri::root(true) . '/media/plg_content_smartcrop/js/smartcrop-editor.js', ['version' => '1.3.1'], ['defer' => true]);
                    $doc->addStyleSheet(\Joomla\CMS\Uri\Uri::root(true) . '/media/plg_content_smartcrop/css/smartcrop-editor.css', ['version' => '1.3.1']);
                }
            } catch (Throwable) {
            }
        }
    }

    /**
     * Resolves plugin configuration options for the frontend editor.
     *
     * @return array
     */
    public function getEditorOptions(): array
    {
        $supportedRatios = $this->params->get('supported_ratios', []);
        $ratios = [];

        if (is_string($supportedRatios)) {
            $supportedRatios = json_decode($supportedRatios, true) ?? [];
        }
        if (is_object($supportedRatios)) {
            $supportedRatios = (array) $supportedRatios;
        }
        if (is_array($supportedRatios)) {
            foreach ($supportedRatios as $row) {
                if (is_object($row)) {
                    $row = (array) $row;
                }
                if (is_array($row) && !empty($row['width']) && !empty($row['height'])) {
                    $label = trim((string) ($row['label'] ?? ''));
                    $w = (float) $row['width'];
                    $h = (float) $row['height'];
                    if ($w > 0 && $h > 0) {
                        $ratios[] = [
                            'label'  => $label !== '' ? $label : sprintf('%s:%s', $w, $h),
                            'width'  => $w,
                            'height' => $h,
                        ];
                    }
                }
            }
        }

        if (empty($ratios)) {
            $ratios = [
                ['label' => 'Πλαίσιο άρθρου', 'width' => 4.0, 'height' => 3.0],
                ['label' => 'Hero Banner',   'width' => 16.0, 'height' => 9.0],
                ['label' => 'Τετράγωνο',     'width' => 1.0, 'height' => 1.0],
            ];
        }

        $allowCustom = (bool) $this->params->get('allow_custom_ratio', 1);
        $previewMaxWidth = (int) $this->params->get('preview_max_width', 480);
        if ($previewMaxWidth < 200 || $previewMaxWidth > 1600) {
            $previewMaxWidth = 480;
        }

        return [
            'ratios'          => $ratios,
            'allowCustom'     => $allowCustom,
            'previewMaxWidth' => $previewMaxWidth,
        ];
    }
}

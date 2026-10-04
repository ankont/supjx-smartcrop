<?php

declare(strict_types=1);

namespace SuperSoftJx\Plugin\Content\SmartCrop\Extension;

defined('_JEXEC') or die;

use Joomla\CMS\Document\HtmlDocument;
use Joomla\CMS\Event\Model\PrepareFormEvent;
use Joomla\CMS\Factory;
use Joomla\CMS\Form\Form;
use Joomla\CMS\Plugin\CMSPlugin;
use Joomla\Event\SubscriberInterface;
use SuperSoftJx\Plugin\Content\SmartCrop\Helper\SmartCropHelper;
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
                $wa = $doc->getWebAssetManager();
                $wa->useScript('plg_content_smartcrop.editor');
                $wa->useStyle('plg_content_smartcrop.editor-style');
            }
        } catch (Throwable) {
        }
    }
}

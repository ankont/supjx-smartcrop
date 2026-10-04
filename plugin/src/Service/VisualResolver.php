<?php

declare(strict_types=1);

namespace SuperSoftJx\Plugin\Content\SmartCrop\Service;

defined('_JEXEC') or die;

use Joomla\CMS\Factory;
use Joomla\CMS\Plugin\PluginHelper;
use Joomla\Database\DatabaseInterface;
use Joomla\Database\ParameterType;
use Joomla\Event\Event;
use Throwable;

final class VisualResolver
{
    /**
     * Resolves the effective image for an article.
     *
     * Precedence:
     * 1. Native article intro image
     * 2. Fallback native full article image
     * 3. Generic SmartVisuals provider decoration (onSmartVisualsDecorateResources)
     *
     * @param   mixed  $article  Article object, array, or article ID (int)
     *
     * @return  string  Normalized image source path/URL, or empty string if none
     */
    public static function resolve(mixed $article): string
    {
        $articleId = 0;
        $imagesData = null;

        if (is_numeric($article)) {
            $articleId = (int) $article;
            $imagesData = self::loadArticleImagesFromDb($articleId);
        } elseif (is_object($article)) {
            $articleId = (int) ($article->id ?? 0);
            $imagesData = $article->images ?? null;
        } elseif (is_array($article)) {
            $articleId = (int) ($article['id'] ?? 0);
            $imagesData = $article['images'] ?? null;
        }

        // 1. Resolve native base image (Intro image > fallback Full article image)
        $baseImage = self::extractBaseImage($imagesData);

        // 2. Dispatch generic SmartVisuals event
        $effectiveImage = self::dispatchSmartVisuals($articleId, $baseImage);

        return $effectiveImage !== '' ? $effectiveImage : $baseImage;
    }

    /**
     * Extracts native base image from article images data with standard precedence.
     *
     * @param   mixed  $imagesData
     *
     * @return  string  Normalized base image path
     */
    public static function extractBaseImage(mixed $imagesData): string
    {
        if (is_string($imagesData)) {
            $imagesData = trim($imagesData);
            if ($imagesData !== '' && ($imagesData[0] === '{' || $imagesData[0] === '[')) {
                $imagesData = json_decode($imagesData, true);
            }
        }

        if (is_object($imagesData)) {
            $imagesData = (array) $imagesData;
        }

        if (!is_array($imagesData)) {
            return '';
        }

        // 1. Intro Image
        $intro = ImageNormalizer::normalize($imagesData['image_intro'] ?? '');
        if ($intro !== '') {
            return $intro;
        }

        // 2. Full Article Image fallback
        $fulltext = ImageNormalizer::normalize($imagesData['image_fulltext'] ?? '');
        if ($fulltext !== '') {
            return $fulltext;
        }

        return '';
    }

    /**
     * Dispatches generic onSmartVisualsDecorateResources event to decorate resources.
     *
     * @param   int     $articleId
     * @param   string  $baseImage
     *
     * @return  string  Decorated normalized image or empty string if not decorated
     */
    private static function dispatchSmartVisuals(int $articleId, string $baseImage): string
    {
        try {
            $app = Factory::getApplication();
            $dispatcher = $app->getDispatcher();

            PluginHelper::importPlugin('smartvisuals', null, true, $dispatcher);

            $resourceId = 'article:' . $articleId;
            $resource = [
                'id'    => $resourceId,
                'type'  => 'article',
                'image' => $baseImage !== '' ? ImageNormalizer::toUrl($baseImage) : '',
            ];

            $event = new Event('onSmartVisualsDecorateResources', [
                'resources'   => [$resource],
                'decorations' => [],
            ]);

            $dispatcher->dispatch($event->getName(), $event);

            $decorations = (array) ($event->getArgument('decorations') ?? []);
            $decoration  = $decorations[$resourceId] ?? null;

            if (is_array($decoration)) {
                $decoratedImage = $decoration['image'] ?? null;
                if (is_string($decoratedImage) && trim($decoratedImage) !== '') {
                    return ImageNormalizer::normalize($decoratedImage);
                }
            }
        } catch (Throwable) {
            // SmartVisuals provider failure must never block or crash
            return '';
        }

        return '';
    }

    /**
     * Loads images column from database for an article ID.
     *
     * @param   int  $articleId
     *
     * @return  string|null
     */
    private static function loadArticleImagesFromDb(int $articleId): ?string
    {
        if ($articleId <= 0) {
            return null;
        }

        try {
            /** @var DatabaseInterface $db */
            $db = Factory::getContainer()->get(DatabaseInterface::class);
            $query = $db->getQuery(true)
                ->select($db->quoteName('images'))
                ->from($db->quoteName('#__content'))
                ->where($db->quoteName('id') . ' = :id')
                ->bind(':id', $articleId, ParameterType::INTEGER);

            $db->setQuery($query);
            $result = $db->loadResult();

            return is_string($result) ? $result : null;
        } catch (Throwable) {
            return null;
        }
    }
}

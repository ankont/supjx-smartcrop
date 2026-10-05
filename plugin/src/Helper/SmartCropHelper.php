<?php

declare(strict_types=1);

namespace SuperSoftJx\Plugin\Content\SmartCrop\Helper;

defined('_JEXEC') or die;

use Joomla\CMS\Factory;
use Joomla\Database\DatabaseInterface;
use Joomla\Database\ParameterType;
use SuperSoftJx\Plugin\Content\SmartCrop\Service\CropValidator;
use SuperSoftJx\Plugin\Content\SmartCrop\Service\ImageNormalizer;
use Throwable;

final class SmartCropHelper
{
    /**
     * Parses crop, zoom, and ratio metadata directly from an image URI (e.g. #joomlaImage://...&crop=...)
     * or a standalone query string / JSON string.
     *
     * @param   string  $uri  Image URI or string containing crop parameters
     *
     * @return  array|null    Parsed crop data or null if none found/valid
     */
    public static function parseCropFromUri(string $uri): ?array
    {
        $uri = trim($uri);
        if ($uri === '') {
            return null;
        }

        // 1. If it's a JSON string: {"crop":{...},"ratio":{...}}
        if (($uri[0] === '{' && str_ends_with($uri, '}')) || ($uri[0] === '[' && str_ends_with($uri, ']'))) {
            $decoded = json_decode($uri, true);
            if (is_array($decoded) && isset($decoded['crop'])) {
                $validated = CropValidator::validateProfile($decoded);
                if ($validated !== null) {
                    $crop = $validated['crop'];
                    $ratio = $validated['ratio'];
                    $focalX = round(($crop['x'] + $crop['width'] / 2) * 100, 2);
                    $focalY = round(($crop['y'] + $crop['height'] / 2) * 100, 2);
                    $zoom   = max(1.0, (float) ($decoded['zoom'] ?? 1.0));
                    return [
                        'crop'    => $crop,
                        'ratio'   => $ratio,
                        'zoom'    => $zoom,
                        'focal_x' => $focalX,
                        'focal_y' => $focalY,
                        'source'  => $validated['source'] ?? '',
                    ];
                }
            }
        }

        // 2. Extract query string from fragment or URL
        $queryString = '';
        $hashPos = strpos($uri, '#');
        if ($hashPos !== false) {
            $fragment = substr($uri, $hashPos + 1);
            $qPos = strpos($fragment, '?');
            if ($qPos !== false) {
                $queryString = substr($fragment, $qPos + 1);
            }
        }

        if ($queryString === '') {
            $qPos = strpos($uri, '?');
            if ($qPos !== false) {
                $queryString = substr($uri, $qPos + 1);
                $hPos = strpos($queryString, '#');
                if ($hPos !== false) {
                    $queryString = substr($queryString, 0, $hPos);
                }
            }
        }

        if ($queryString === '') {
            return null;
        }

        parse_str($queryString, $queryParams);
        if (empty($queryParams['crop'])) {
            return null;
        }

        $cropParam = (string) $queryParams['crop'];
        $coords = explode(',', $cropParam);
        if (count($coords) !== 4) {
            return null;
        }

        $x = (float) $coords[0];
        $y = (float) $coords[1];
        $w = (float) $coords[2];
        $h = (float) $coords[3];

        // Ratio parsing
        $ratioW = 4.0;
        $ratioH = 3.0;
        if (!empty($queryParams['ratio'])) {
            $ratioParts = explode(':', str_replace(['x', 'X', '/'], ':', (string) $queryParams['ratio']));
            if (count($ratioParts) === 2 && (float) $ratioParts[0] > 0 && (float) $ratioParts[1] > 0) {
                $ratioW = (float) $ratioParts[0];
                $ratioH = (float) $ratioParts[1];
            }
        }

        // Zoom parsing
        $zoom = 1.0;
        if (!empty($queryParams['zoom'])) {
            $zoom = max(1.0, min(5.0, (float) $queryParams['zoom']));
        }

        $source = ImageNormalizer::normalize($uri);
        if ($source === '') {
            $source = 'image';
        }

        $rawProfile = [
            'source' => $source,
            'crop' => [
                'x'      => $x,
                'y'      => $y,
                'width'  => $w,
                'height' => $h,
            ],
            'ratio' => [
                'width'  => $ratioW,
                'height' => $ratioH,
            ],
        ];

        $validated = CropValidator::validateProfile($rawProfile);
        if ($validated === null) {
            return null;
        }

        $crop = $validated['crop'];
        $ratio = $validated['ratio'];
        $focalX = round(($crop['x'] + $crop['width'] / 2) * 100, 2);
        $focalY = round(($crop['y'] + $crop['height'] / 2) * 100, 2);

        return [
            'crop'    => $crop,
            'ratio'   => $ratio,
            'zoom'    => $zoom,
            'focal_x' => $focalX,
            'focal_y' => $focalY,
            'source'  => ImageNormalizer::normalize($uri),
        ];
    }

    /**
     * Resolves and returns the inline CSS style for a framed image.
     *
     * Can receive:
     * - A URI string containing #joomlaImage://...&crop=...
     * - An article object / array
     * - A pre-resolved crop profile array
     *
     * @param   mixed   $imageOrArticle  Image URI, crop array, or article representation
     * @param   string  $profile         Profile key if article is passed (default: 'default')
     *
     * @return  string  CSS inline style (e.g. 'object-position: 50% 25%; transform: scale(1.2); ...') or ''
     */
    public static function getCssStyle(mixed $imageOrArticle, string $profile = 'default'): string
    {
        $info = self::getFocalPointAndScale($imageOrArticle, $profile);
        return $info !== null ? $info['css'] : '';
    }

    /**
     * Computes focal point percentages, zoom factor, and CSS string for an image or article.
     *
     * @param   mixed   $imageOrArticle
     * @param   string  $profile
     *
     * @return  array|null
     */
    public static function getFocalPointAndScale(mixed $imageOrArticle, string $profile = 'default'): ?array
    {
        if (empty($imageOrArticle)) {
            return null;
        }

        $focalX = 50.0;
        $focalY = 50.0;
        $zoom   = 1.0;
        $ratioStr = '4:3';

        // Case 1: String URI
        if (is_string($imageOrArticle)) {
            $parsed = self::parseCropFromUri($imageOrArticle);
            if ($parsed !== null) {
                $crop   = $parsed['crop'];
                $focalX = $parsed['focal_x'];
                $focalY = $parsed['focal_y'];
                $zoom   = $parsed['zoom'];
                $ratioStr = $parsed['ratio']['width'] . ':' . $parsed['ratio']['height'];
            } else {
                return null;
            }
        }
        // Case 2: Pre-parsed crop array
        elseif (is_array($imageOrArticle) && isset($imageOrArticle['crop'])) {
            $crop = $imageOrArticle['crop'];
            $w = max(0.0001, (float) ($crop['width'] ?? 1.0));
            $h = max(0.0001, (float) ($crop['height'] ?? 1.0));
            $x = (float) ($crop['x'] ?? 0.0);
            $y = (float) ($crop['y'] ?? 0.0);
            $focalX = round(($x + $w / 2) * 100, 2);
            $focalY = round(($y + $h / 2) * 100, 2);
            $zoom   = max(1.0, (float) ($imageOrArticle['zoom'] ?? 1.0));
            if (isset($imageOrArticle['ratio']['width'], $imageOrArticle['ratio']['height'])) {
                $ratioStr = $imageOrArticle['ratio']['width'] . ':' . $imageOrArticle['ratio']['height'];
            }
        }
        // Case 3: Article object or array
        else {
            $imagesData = self::extractImagesData($imageOrArticle);
            if ($imagesData === null) {
                return null;
            }

            // Check if URI in image_intro or image_fulltext has crop
            $targetUri = (string) ($imagesData['image_intro'] ?? $imagesData['image_fulltext'] ?? '');
            $parsed = self::parseCropFromUri($targetUri);
            if ($parsed !== null) {
                $crop   = $parsed['crop'];
                $focalX = $parsed['focal_x'];
                $focalY = $parsed['focal_y'];
                $zoom   = $parsed['zoom'];
                $ratioStr = $parsed['ratio']['width'] . ':' . $parsed['ratio']['height'];
            } else {
                $cropData = self::getCrop($imageOrArticle, $targetUri, $profile);
                if ($cropData === null) {
                    return null;
                }
                $crop = $cropData['crop'];
                $focalX = round(($crop['x'] + $crop['width'] / 2) * 100, 2);
                $focalY = round(($crop['y'] + $crop['height'] / 2) * 100, 2);
                $zoom   = max(1.0, (float) ($cropData['zoom'] ?? 1.0));
                $ratioStr = $cropData['ratio']['width'] . ':' . $cropData['ratio']['height'];
            }
        }

        $cropX = (float) ($crop['x'] ?? 0.0);
        $cropY = (float) ($crop['y'] ?? 0.0);
        $cropW = max(0.0001, (float) ($crop['width'] ?? 1.0));
        $cropH = max(0.0001, (float) ($crop['height'] ?? 1.0));

        $normX = max(0.0, min(1.0, $cropX));
        $normY = max(0.0, min(1.0, $cropY));
        $normW = max(0.0001, min(1.0 - $normX, $cropW));
        $normH = max(0.0001, min(1.0 - $normY, $cropH));

        $scaleX = 1.0 / $normW;
        $scaleY = 1.0 / $normH;
        $widthPct  = round($scaleX * 100.0, 4);
        $heightPct = round($scaleY * 100.0, 4);
        $leftPct   = round(-($normX / $normW) * 100.0, 4);
        $topPct    = round(-($normY / $normH) * 100.0, 4);
        $leftPct   = abs($leftPct) < 0.0001 ? 0.0 : $leftPct;
        $topPct    = abs($topPct) < 0.0001 ? 0.0 : $topPct;

        $focalX = max(0.0, min(100.0, $focalX));
        $focalY = max(0.0, min(100.0, $focalY));
        $zoom   = round(max(1.0, min(5.0, $zoom)), 3);

        $css = sprintf(
            'position: absolute !important; left: %s%% !important; top: %s%% !important; width: %s%% !important; height: %s%% !important; right: auto !important; bottom: auto !important; max-width: none !important; max-height: none !important; object-fit: fill !important; transform: none !important; object-position: %s%% %s%%; transform-origin: %s%% %s%%;',
            $leftPct,
            $topPct,
            $widthPct,
            $heightPct,
            $focalX,
            $focalY,
            $focalX,
            $focalY
        );

        return [
            'focal_x'    => $focalX,
            'focal_y'    => $focalY,
            'zoom'       => $zoom,
            'ratio'      => $ratioStr,
            'width_pct'  => $widthPct,
            'height_pct' => $heightPct,
            'left_pct'   => $leftPct,
            'top_pct'    => $topPct,
            'css'        => $css,
        ];
    }

    /**
     * Resolves the crop metadata for a specific article, image, and profile.
     *
     * Returns null if:
     * - Article has no SmartCrop metadata
     * - Profile does not exist
     * - The image passed does not match the image the crop was created for
     * - Crop metadata is malformed or invalid
     *
     * @param   mixed   $article  Article object, array, or article ID (int)
     * @param   mixed   $image    The image path/URL being rendered by the template
     * @param   string  $profile  Profile key (defaults to 'default')
     *
     * @return  array|null  Matching crop metadata or null
     */
    public static function getCrop(mixed $article, mixed $image, string $profile = 'default'): ?array
    {
        $normalizedTarget = ImageNormalizer::normalize($image);
        if ($normalizedTarget === '') {
            return null;
        }

        $imagesData = self::extractImagesData($article);
        if ($imagesData === null) {
            return null;
        }

        $smartcrop = $imagesData['smartcrop'] ?? null;
        if (is_string($smartcrop)) {
            $smartcrop = json_decode($smartcrop, true);
        }

        if (!is_array($smartcrop)) {
            return null;
        }

        $profiles = $smartcrop['profiles'] ?? null;
        if (!is_array($profiles)) {
            return null;
        }

        $profileData = $profiles[$profile] ?? null;
        $matchedKey  = $profile;

        if (!is_array($profileData)) {
            if ($profile === 'default') {
                $profileData = $profiles['intro'] ?? $profiles['fulltext'] ?? null;
                $matchedKey  = isset($profiles['intro']) ? 'intro' : (isset($profiles['fulltext']) ? 'fulltext' : 'default');
            }
        }

        if (!is_array($profileData)) {
            return null;
        }

        // Validate that crop source matches target image
        $source = ImageNormalizer::normalize($profileData['source'] ?? '');
        if ($source === '' || $source !== $normalizedTarget) {
            return null;
        }

        // Validate crop rectangle and ratio
        $validated = CropValidator::validateAndClean([
            'version'  => $smartcrop['version'] ?? 1,
            'profiles' => [$matchedKey => $profileData],
        ]);

        if ($validated === null) {
            return null;
        }

        $cleanProfile = $validated['profiles'][$matchedKey];
        $cleanProfile['profile'] = $matchedKey;

        return $cleanProfile;
    }

    /**
     * Checks if a matching crop exists for an article and image.
     *
     * @param   mixed   $article
     * @param   mixed   $image
     * @param   string  $profile
     *
     * @return  bool
     */
    public static function hasCrop(mixed $article, mixed $image, string $profile = 'default'): bool
    {
        return self::getCrop($article, $image, $profile) !== null;
    }

    /**
     * Calculates presentation values (dimensions, percentage offsets, styles, CSS variables)
     * from a crop rectangle for responsive CSS rendering.
     *
     * @param   mixed   $article  Article object/array/ID, OR pre-fetched crop array
     * @param   mixed   $image    Image path/URL (ignored if $article is already a crop array)
     * @param   string  $profile  Profile key (defaults to 'default')
     *
     * @return  array|null  Presentation calculations or null if no matching crop
     */
    public static function getPresentation(mixed $article, mixed $image = null, string $profile = 'default'): ?array
    {
        $cropData = null;

        if (is_array($article) && isset($article['crop'], $article['ratio'])) {
            $cropData = $article;
        } else {
            $cropData = self::getCrop($article, $image, $profile);
        }

        if ($cropData === null) {
            return null;
        }

        $crop   = $cropData['crop'];
        $ratio  = $cropData['ratio'];

        $x = (float) $crop['x'];
        $y = (float) $crop['y'];
        $w = max(0.0001, (float) $crop['width']);
        $h = max(0.0001, (float) $crop['height']);

        $ratioW = (float) $ratio['width'];
        $ratioH = (float) $ratio['height'];
        $aspectRatioCss = $ratioW . ' / ' . $ratioH;

        // Scaling factors
        $scaleX = 1.0 / $w;
        $scaleY = 1.0 / $h;

        // Percentage values relative to the viewport container
        $widthPct  = $scaleX * 100.0;
        $heightPct = $scaleY * 100.0;
        $leftPct   = -($x / $w) * 100.0;
        $topPct    = -($y / $h) * 100.0;

        $leftPctStr   = round($leftPct, 4) . '%';
        $topPctStr    = round($topPct, 4) . '%';
        $widthPctStr  = round($widthPct, 4) . '%';
        $heightPctStr = round($heightPct, 4) . '%';

        $containerStyle = sprintf('position: relative; overflow: hidden; aspect-ratio: %s;', $aspectRatioCss);
        $imageStyle     = sprintf(
            'position: absolute; left: %s; top: %s; width: %s; height: %s; max-width: none; max-height: none; display: block;',
            $leftPctStr,
            $topPctStr,
            $widthPctStr,
            $heightPctStr
        );

        $cssVariables = sprintf(
            '--smartcrop-ratio: %s; --smartcrop-left: %s; --smartcrop-top: %s; --smartcrop-width: %s; --smartcrop-height: %s;',
            $aspectRatioCss,
            $leftPctStr,
            $topPctStr,
            $widthPctStr,
            $heightPctStr
        );

        return [
            'crop' => [
                'x'      => $x,
                'y'      => $y,
                'width'  => $w,
                'height' => $h,
            ],
            'ratio' => [
                'width'        => $ratioW,
                'height'       => $ratioH,
                'aspect_ratio' => $aspectRatioCss,
                'decimal'      => $ratioW / $ratioH,
            ],
            'values' => [
                'scale_x'      => round($scaleX, 4),
                'scale_y'      => round($scaleY, 4),
                'width_pct'    => round($widthPct, 4),
                'height_pct'   => round($heightPct, 4),
                'left_pct'     => round($leftPct, 4),
                'top_pct'      => round($topPct, 4),
            ],
            'styles' => [
                'container'    => $containerStyle,
                'image'        => $imageStyle,
                'css_variables'=> $cssVariables,
            ],
            'source' => $cropData['source'] ?? '',
        ];
    }

    /**
     * Renders responsive HTML markup for a framed article image.
     *
     * @param   mixed   $article     Article object/array/ID
     * @param   mixed   $image       Image path or URL
     * @param   array   $attributes  Optional HTML attributes for <img> (e.g. alt, class, loading)
     * @param   string  $profile     Profile key (defaults to 'default')
     *
     * @return  string  HTML markup
     */
    public static function renderImage(
        mixed $article,
        mixed $image,
        array $attributes = [],
        string $profile = 'default'
    ): string {
        $presentation = self::getPresentation($article, $image, $profile);
        $imageUrl     = ImageNormalizer::toUrl($image);

        if ($presentation === null) {
            // Fallback rendering when no crop exists
            $alt   = htmlspecialchars($attributes['alt'] ?? '', ENT_QUOTES, 'UTF-8');
            $class = htmlspecialchars($attributes['class'] ?? '', ENT_QUOTES, 'UTF-8');

            return sprintf('<img src="%s" alt="%s" class="%s">', htmlspecialchars($imageUrl, ENT_QUOTES, 'UTF-8'), $alt, $class);
        }

        $containerClass = htmlspecialchars($attributes['container_class'] ?? 'smartcrop-frame', ENT_QUOTES, 'UTF-8');
        $alt            = htmlspecialchars($attributes['alt'] ?? '', ENT_QUOTES, 'UTF-8');
        $class          = htmlspecialchars($attributes['class'] ?? 'smartcrop-image', ENT_QUOTES, 'UTF-8');
        $loading        = htmlspecialchars($attributes['loading'] ?? 'lazy', ENT_QUOTES, 'UTF-8');

        return sprintf(
            '<div class="%s" style="%s"><img src="%s" alt="%s" class="%s" loading="%s" style="%s"></div>',
            $containerClass,
            $presentation['styles']['container'],
            htmlspecialchars($imageUrl, ENT_QUOTES, 'UTF-8'),
            $alt,
            $class,
            $loading,
            $presentation['styles']['image']
        );
    }

    /**
     * Extracts images array from an article representation.
     *
     * @param   mixed  $article
     *
     * @return  array|null
     */
    private static function extractImagesData(mixed $article): ?array
    {
        $rawImages = null;

        if (is_numeric($article)) {
            $rawImages = self::loadImagesFromDb((int) $article);
        } elseif (is_object($article)) {
            $rawImages = $article->images ?? null;
        } elseif (is_array($article)) {
            $rawImages = $article['images'] ?? null;
        }

        if (is_string($rawImages)) {
            $rawImages = trim($rawImages);
            if ($rawImages !== '' && ($rawImages[0] === '{' || $rawImages[0] === '[')) {
                $rawImages = json_decode($rawImages, true);
            }
        }

        if (is_object($rawImages)) {
            $rawImages = (array) $rawImages;
        }

        return is_array($rawImages) ? $rawImages : null;
    }

    /**
     * Loads images column from #__content for an article ID.
     *
     * @param   int  $articleId
     *
     * @return  string|null
     */
    private static function loadImagesFromDb(int $articleId): ?string
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
            $res = $db->loadResult();

            return is_string($res) ? $res : null;
        } catch (Throwable) {
            return null;
        }
    }
}

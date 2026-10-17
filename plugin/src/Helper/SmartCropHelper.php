<?php

declare(strict_types=1);

namespace SuperSoft\Plugin\Content\SmartCrop\Helper;

defined('_JEXEC') or die;

use Joomla\CMS\Factory;
use Joomla\Database\DatabaseInterface;
use Joomla\Database\ParameterType;
use SuperSoft\Plugin\Content\SmartCrop\Service\CropValidator;
use SuperSoft\Plugin\Content\SmartCrop\Service\ImageNormalizer;
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
                    $zoom   = max(0.05, (float) ($decoded['zoom'] ?? 1.0));
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
        $normalizedCropParam = (string) preg_replace('/(\d)-/', '$1,', trim($cropParam));
        $coords = preg_split('/[,_~]+/', $normalizedCropParam) ?: [];
        if (count($coords) !== 4 || !is_numeric($coords[0]) || !is_numeric($coords[1]) || !is_numeric($coords[2]) || !is_numeric($coords[3])) {
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
            $ratioParts = explode(':', str_replace(['x', 'X', '/', '_'], ':', (string) $queryParams['ratio']));
            if (count($ratioParts) === 2 && (float) $ratioParts[0] > 0 && (float) $ratioParts[1] > 0) {
                $ratioW = (float) $ratioParts[0];
                $ratioH = (float) $ratioParts[1];
            }
        }

        // Zoom parsing
        $zoom = 1.0;
        if (!empty($queryParams['zoom'])) {
            $zoom = max(0.05, min(5.0, (float) $queryParams['zoom']));
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
            $zoom   = max(0.05, (float) ($imageOrArticle['zoom'] ?? 1.0));
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
                $zoom   = max(0.05, (float) ($cropData['zoom'] ?? 1.0));
                $ratioStr = $cropData['ratio']['width'] . ':' . $cropData['ratio']['height'];
            }
        }

        $cropX = (float) ($crop['x'] ?? 0.0);
        $cropY = (float) ($crop['y'] ?? 0.0);
        $cropW = max(0.0001, (float) ($crop['width'] ?? 1.0));
        $cropH = max(0.0001, (float) ($crop['height'] ?? 1.0));

        $normX = $cropX;
        $normY = $cropY;
        $normW = $cropW;
        $normH = $cropH;

        if ($normW <= 1.0001 && $normX >= -0.0001) {
            $normX = max(0.0, min(1.0, $normX));
            $normW = max(0.0001, min(1.0 - $normX, $normW));
        } else {
            $normW = max(0.0001, min(25.0, $normW));
            $normX = max(-25.0, min(0.0, $normX));
        }

        if ($normH <= 1.0001 && $normY >= -0.0001) {
            $normY = max(0.0, min(1.0, $normY));
            $normH = max(0.0001, min(1.0 - $normY, $normH));
        } else {
            $normH = max(0.0001, min(25.0, $normH));
            $normY = max(-25.0, min(0.0, $normY));
        }

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
        $zoom   = round(max(0.05, min(5.0, $zoom)), 3);

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
     * Public resolver for frontend consumers to obtain crop presentation calculations
     * for a final rendered image given extension metadata (ext.smartcrop.crop, usage dictionary, or JSON).
     *
     * Adheres to the exact coordinate normalization, clamping, and zoom conventions used by the editor.
     * Verifies that the crop metadata matches the target image's canonical identity.
     * If the image was changed (e.g. Intro Image changed on an article), the crop is recognized
     * as stale and null is returned, preventing the old crop from being applied to the new image.
     *
     * @param   mixed  $finalImage    The final resolved image being rendered (path, URL, array, or object)
     * @param   mixed  $cropMetadata  Metadata from ext.smartcrop.crop, parent usage array, JSON string, or address
     *
     * @return  array|null  Presentation dictionary, or null if no crop / invalid / source mismatch
     */
    public static function resolveCropPresentation(mixed $finalImage, mixed $cropMetadata): ?array
    {
        if (empty($finalImage) || empty($cropMetadata)) {
            return null;
        }

        $normFinal = ImageNormalizer::normalize($finalImage);
        if ($normFinal === '') {
            return null;
        }

        $payload = $cropMetadata;

        // 1. If it's a string, try JSON decoding or query/address extraction
        if (is_string($payload)) {
            $payload = trim($payload);
            if (($payload[0] === '{' && str_ends_with($payload, '}')) || ($payload[0] === '[' && str_ends_with($payload, ']'))) {
                $decoded = json_decode($payload, true);
                if (is_array($decoded)) {
                    $payload = $decoded;
                }
            } elseif (str_contains($payload, '#') || str_contains($payload, '?')) {
                // Address string or query string with parameters
                $queryString = '';
                $hashPos = strpos($payload, '#');
                if ($hashPos !== false) {
                    $frag = substr($payload, $hashPos + 1);
                    $qPos = strpos($frag, '?');
                    if ($qPos !== false) {
                        $queryString = substr($frag, $qPos + 1);
                    }
                }
                if ($queryString === '') {
                    $qPos = strpos($payload, '?');
                    if ($qPos !== false) {
                        $queryString = substr($payload, $qPos + 1);
                    }
                }
                if ($queryString !== '') {
                    $qp = [];
                    foreach (explode('&', $queryString) as $pair) {
                        if ($pair === '') {
                            continue;
                        }
                        $eq = strpos($pair, '=');
                        if ($eq !== false) {
                            $k = rawurldecode(substr($pair, 0, $eq));
                            $v = rawurldecode(substr($pair, $eq + 1));
                            $qp[$k] = $v;
                        } else {
                            $qp[rawurldecode($pair)] = '';
                        }
                    }
                    $payload = $qp;
                }
            }
        }

        if (!is_array($payload)) {
            return null;
        }

        // 2. Unwrap nested metadata keys if a usage/extension dictionary was passed
        if (isset($payload['ext.smartcrop.crop']) && is_array($payload['ext.smartcrop.crop'])) {
            $payload = $payload['ext.smartcrop.crop'];
        } elseif (isset($payload['ext.smartcrop.crop']) && is_string($payload['ext.smartcrop.crop'])) {
            $dec = json_decode($payload['ext.smartcrop.crop'], true);
            $payload = is_array($dec) ? $dec : $payload;
        } elseif (isset($payload['smartcrop.crop']) && is_array($payload['smartcrop.crop'])) {
            $payload = $payload['smartcrop.crop'];
        } elseif (isset($payload['usage']['ext.smartcrop.crop']) && is_array($payload['usage']['ext.smartcrop.crop'])) {
            $payload = $payload['usage']['ext.smartcrop.crop'];
        }

        // 3. Resolve potential Selection Address compound alias (e.g. smartcrop=sc or crop=c with .coords, .ratio, .src, .zoom)
        $alias = null;
        if (isset($payload['smartcrop']) && is_string($payload['smartcrop']) && preg_match('/^[a-zA-Z_][a-zA-Z0-9_]*$/', $payload['smartcrop']) && $payload['smartcrop'] !== 'original') {
            $alias = $payload['smartcrop'];
        } elseif (isset($payload['crop']) && is_string($payload['crop']) && preg_match('/^[a-zA-Z_][a-zA-Z0-9_]*$/', $payload['crop']) && $payload['crop'] !== 'original') {
            $alias = $payload['crop'];
        }

        $cropRaw = null;
        if ($alias !== null) {
            $cropRaw = $payload[$alias . '.coords'] ?? $payload[$alias . '_coords'] ?? null;
        }
        if ($cropRaw === null) {
            $cropRaw = $payload['crop'] ?? $payload['coords'] ?? $payload['sc.coords'] ?? $payload['sc_coords'] ?? $payload['c.coords'] ?? $payload['c_coords'] ?? null;
        }

        if (is_string($cropRaw)) {
            $normalizedCropRaw = (string) preg_replace('/(\d)-/', '$1,', trim($cropRaw));
            $coords = preg_split('/[,_~]+/', $normalizedCropRaw) ?: [];
            if (count($coords) === 4 && is_numeric($coords[0]) && is_numeric($coords[1]) && is_numeric($coords[2]) && is_numeric($coords[3])) {
                $cropRaw = [
                    'x'      => (float) $coords[0],
                    'y'      => (float) $coords[1],
                    'width'  => (float) $coords[2],
                    'height' => (float) $coords[3],
                ];
            }
        }

        if (!is_array($cropRaw) || !isset($cropRaw['width'], $cropRaw['height'])) {
            return null;
        }

        // 4. Source Identity Matching
        $expectedSource = '';
        if ($alias !== null) {
            $expectedSource = $payload[$alias . '.src'] ?? $payload[$alias . '_src'] ?? $payload[$alias . '.source'] ?? '';
        }
        if ($expectedSource === '') {
            $expectedSource = $payload['source'] ?? $payload['src'] ?? $payload['sc.src'] ?? $payload['sc_src'] ?? $payload['c.src'] ?? $payload['c_src'] ?? '';
        }
        if ($expectedSource === '' && is_string($cropMetadata)) {
            $trimmedMeta = trim($cropMetadata);
            $beforeQuery = preg_split('/[?#]/', $trimmedMeta, 2)[0] ?? '';
            $isImageUri = str_contains($trimmedMeta, '#joomlaImage://')
                || str_starts_with(strtolower($trimmedMeta), 'file:')
                || ($beforeQuery !== '' && !str_starts_with($beforeQuery, '{') && !str_contains($beforeQuery, '=') && !str_contains($beforeQuery, ':') && (str_contains($beforeQuery, '/') || str_contains($beforeQuery, '.')));
            if ($isImageUri) {
                $uriCandidateSource = ImageNormalizer::normalize($trimmedMeta);
                if ($uriCandidateSource !== '' && !str_contains($uriCandidateSource, ':')) {
                    $expectedSource = $uriCandidateSource;
                }
            }
        }
        if (is_string($expectedSource) && trim($expectedSource) !== '') {
            $normExpected = ImageNormalizer::normalize($expectedSource);
            if ($normExpected !== '' && !ImageNormalizer::matches($normFinal, $normExpected)) {
                // Source mismatch: image was changed or overridden! Do not apply stale crop to a different image.
                return null;
            }
        }

        // 5. Extract Ratio
        $ratioW = 4.0;
        $ratioH = 3.0;
        $ratioRaw = null;
        if ($alias !== null) {
            $ratioRaw = $payload[$alias . '.ratio'] ?? $payload[$alias . '_ratio'] ?? null;
        }
        if ($ratioRaw === null) {
            $ratioRaw = $payload['ratio'] ?? $payload['sc.ratio'] ?? $payload['sc_ratio'] ?? $payload['c.ratio'] ?? $payload['c_ratio'] ?? null;
        }
        if (is_array($ratioRaw) && isset($ratioRaw['width'], $ratioRaw['height'])) {
            $ratioW = max(0.01, (float) $ratioRaw['width']);
            $ratioH = max(0.01, (float) $ratioRaw['height']);
        } elseif (is_string($ratioRaw) && (str_contains($ratioRaw, ':') || str_contains($ratioRaw, '/') || stripos($ratioRaw, 'x') !== false || str_contains($ratioRaw, '_'))) {
            $rParts = array_map('trim', explode(':', str_replace(['x', 'X', '/', '_'], ':', $ratioRaw)));
            if (count($rParts) === 2 && (float) $rParts[0] > 0 && (float) $rParts[1] > 0) {
                $ratioW = (float) $rParts[0];
                $ratioH = (float) $rParts[1];
            }
        } elseif (is_numeric($ratioRaw) && (float) $ratioRaw > 0) {
            $val = (float) $ratioRaw;
            if (abs($val - 16 / 9) < 0.05) { $ratioW = 16.0; $ratioH = 9.0; }
            elseif (abs($val - 4 / 3) < 0.05) { $ratioW = 4.0; $ratioH = 3.0; }
            elseif (abs($val - 1.0) < 0.05) { $ratioW = 1.0; $ratioH = 1.0; }
            elseif (abs($val - 3 / 2) < 0.05) { $ratioW = 3.0; $ratioH = 2.0; }
            else { $ratioW = round($val * 100); $ratioH = 100.0; }
        }

        // 6. Extract Zoom
        $zoom = 1.0;
        $zoomRaw = null;
        if ($alias !== null) {
            $zoomRaw = $payload[$alias . '.zoom'] ?? $payload[$alias . '_zoom'] ?? null;
        }
        if ($zoomRaw === null) {
            $zoomRaw = $payload['zoom'] ?? $payload['sc.zoom'] ?? $payload['sc_zoom'] ?? $payload['c.zoom'] ?? $payload['c_zoom'] ?? null;
        }
        if (is_numeric($zoomRaw)) {
            $zoom = max(0.05, min(5.0, (float) $zoomRaw));
        }

        // 7. Coordinate Normalization & Clamping (identical to editor conventions)
        $cropX = (float) ($cropRaw['x'] ?? 0.0);
        $cropY = (float) ($cropRaw['y'] ?? 0.0);
        $cropW = max(0.0001, (float) ($cropRaw['width'] ?? 1.0));
        $cropH = max(0.0001, (float) ($cropRaw['height'] ?? 1.0));

        $normX = $cropX;
        $normY = $cropY;
        $normW = $cropW;
        $normH = $cropH;

        if ($normW <= 1.0001 && $normX >= -0.0001) {
            $normX = max(0.0, min(1.0, $normX));
            $normW = max(0.0001, min(1.0 - $normX, $normW));
        } else {
            $normW = max(0.0001, min(25.0, $normW));
            $normX = max(-25.0, min(0.0, $normX));
        }

        if ($normH <= 1.0001 && $normY >= -0.0001) {
            $normY = max(0.0, min(1.0, $normY));
            $normH = max(0.0001, min(1.0 - $normY, $normH));
        } else {
            $normH = max(0.0001, min(25.0, $normH));
            $normY = max(-25.0, min(0.0, $normY));
        }

        // 8. Viewport Scaling & Percentages
        $scaleX = 1.0 / $normW;
        $scaleY = 1.0 / $normH;
        $widthPct  = round($scaleX * 100.0, 4);
        $heightPct = round($scaleY * 100.0, 4);
        $leftPct   = round(-($normX / $normW) * 100.0, 4);
        $topPct    = round(-($normY / $normH) * 100.0, 4);
        $leftPct   = abs($leftPct) < 0.0001 ? 0.0 : $leftPct;
        $topPct    = abs($topPct) < 0.0001 ? 0.0 : $topPct;

        $focalX = round(($normX + $normW / 2) * 100.0, 2);
        $focalY = round(($normY + $normH / 2) * 100.0, 2);
        $focalX = max(0.0, min(100.0, $focalX));
        $focalY = max(0.0, min(100.0, $focalY));
        $zoom   = round($zoom, 3);

        $aspectRatioCss = $ratioW . ' / ' . $ratioH;
        $ratioLabel     = $ratioW . ':' . $ratioH;

        $containerStyle = sprintf('position: relative; overflow: hidden; aspect-ratio: %s;', $aspectRatioCss);
        $imageStyle     = sprintf(
            'position: absolute !important; left: %s%% !important; top: %s%% !important; width: %s%% !important; height: %s%% !important; right: auto !important; bottom: auto !important; max-width: none !important; max-height: none !important; object-fit: fill !important; transform: none !important; display: block !important;',
            $leftPct,
            $topPct,
            $widthPct,
            $heightPct
        );

        $cssVariables = sprintf(
            '--smartcrop-ratio: %s; --smartcrop-left: %s%%; --smartcrop-top: %s%%; --smartcrop-width: %s%%; --smartcrop-height: %s%%; --smartcrop-zoom: %s; --smartcrop-focal-x: %s%%; --smartcrop-focal-y: %s%%;',
            $aspectRatioCss,
            $leftPct,
            $topPct,
            $widthPct,
            $heightPct,
            $zoom,
            $focalX,
            $focalY
        );

        $styleVars = [
            '--smartcrop-ratio'   => $aspectRatioCss,
            '--smartcrop-left'    => $leftPct . '%',
            '--smartcrop-top'     => $topPct . '%',
            '--smartcrop-width'   => $widthPct . '%',
            '--smartcrop-height'  => $heightPct . '%',
            '--smartcrop-zoom'    => (string) $zoom,
            '--smartcrop-focal-x' => $focalX . '%',
            '--smartcrop-focal-y' => $focalY . '%',
        ];

        return [
            'is_cropped' => true,
            'crop' => [
                'x'      => $normX,
                'y'      => $normY,
                'width'  => $normW,
                'height' => $normH,
            ],
            'ratio' => [
                'width'        => $ratioW,
                'height'       => $ratioH,
                'aspect_ratio' => $aspectRatioCss,
                'decimal'      => round($ratioW / $ratioH, 4),
                'label'        => $ratioLabel,
            ],
            'zoom'  => $zoom,
            'focal' => [
                'x' => $focalX,
                'y' => $focalY,
            ],
            'values' => [
                'scale_x'    => round($scaleX, 4),
                'scale_y'    => round($scaleY, 4),
                'width_pct'  => $widthPct,
                'height_pct' => $heightPct,
                'left_pct'   => $leftPct,
                'top_pct'    => $topPct,
            ],
            'styles' => [
                'container'     => $containerStyle,
                'image'         => $imageStyle,
                'css_variables' => $cssVariables,
            ],
            'style_vars' => $styleVars,
            'source'     => $normFinal,
            'image_url'  => ImageNormalizer::toUrl($finalImage),
        ];
    }

    /**
     * Checks if a valid crop in metadata is applicable to the given final image.
     *
     * @param   mixed  $finalImage
     * @param   mixed  $cropMetadata
     *
     * @return  bool
     */
    public static function isCropApplicable(mixed $finalImage, mixed $cropMetadata): bool
    {
        return self::resolveCropPresentation($finalImage, $cropMetadata) !== null;
    }

    /**
     * Renders responsive HTML markup for a final image using crop metadata.
     *
     * @param   mixed  $finalImage    Final image path or URL
     * @param   mixed  $cropMetadata  Metadata from ext.smartcrop.crop
     * @param   array  $attributes    Optional HTML attributes for <img> (e.g. alt, class, loading)
     *
     * @return  string  HTML markup
     */
    public static function renderImageWithMetadata(
        mixed $finalImage,
        mixed $cropMetadata,
        array $attributes = []
    ): string {
        $presentation = self::resolveCropPresentation($finalImage, $cropMetadata);
        $imageUrl     = ImageNormalizer::toUrl($finalImage);

        if ($presentation === null) {
            $alt   = htmlspecialchars($attributes['alt'] ?? '', ENT_QUOTES, 'UTF-8');
            $class = htmlspecialchars($attributes['class'] ?? '', ENT_QUOTES, 'UTF-8');

            return sprintf('<img src="%s" alt="%s" class="%s">', htmlspecialchars($imageUrl, ENT_QUOTES, 'UTF-8'), $alt, $class);
        }

        $containerClass = htmlspecialchars($attributes['container_class'] ?? 'smartcrop-frame is-cropped', ENT_QUOTES, 'UTF-8');
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
        } elseif (is_string($article) && !empty($image) && (is_array($image) || (is_string($image) && (str_contains($image, 'crop') || str_starts_with($image, '{'))))) {
            return self::resolveCropPresentation($article, $image);
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

    /**
     * Resolves SmartCrop presentation from a SmartBrowser Image Presentation context.
     *
     * Supports all SmartCrop storage and override formats:
     * - Extension usage/metadata (`ext.smartcrop.crop`, `smartcrop.crop`)
     * - Native Joomla `#joomlaImage://...&crop=...` URIs
     * - Thumbnail overrides (`visual.thumbnailOverride` and compound addresses)
     * - Selection Address codecs (`smartcrop=sc` and `crop=c`)
     * - Resolved image / indigenous resource `imageCrop` and legacy article `images` JSON
     *
     * Verifies source identity against the final resolved image so stale crops or
     * indigenous crops do not leak onto a changed image or different thumbnail override.
     *
     * @param   array        $context      Context array from onSmartBrowserPrepareImagePresentation
     * @param   string|null  $domImageSrc  Optional fallback src attribute from the target <img> element
     *
     * @return  array|null   Presentation dictionary or null if no matching crop applies
     */
    public static function resolveSmartBrowserImagePresentation(array $context, ?string $domImageSrc = null): ?array
    {
        $resource  = is_object($context['resource'] ?? null) ? (array) $context['resource'] : (is_array($context['resource'] ?? null) ? $context['resource'] : []);
        $selection = is_object($context['selection'] ?? null) ? (array) $context['selection'] : (is_array($context['selection'] ?? null) ? $context['selection'] : []);
        $usage     = is_object($context['usage'] ?? null) ? (array) $context['usage'] : (is_array($context['usage'] ?? null) ? $context['usage'] : []);

        if (empty($usage)) {
            if (is_array($selection['usage'] ?? null) || is_object($selection['usage'] ?? null)) {
                $usage = (array) $selection['usage'];
            } elseif (is_array($resource['usage'] ?? null) || is_object($resource['usage'] ?? null)) {
                $usage = (array) $resource['usage'];
            }
        }

        $contextMeta   = is_object($context['metadata'] ?? null) ? (array) $context['metadata'] : (is_array($context['metadata'] ?? null) ? $context['metadata'] : []);
        $selectionMeta = is_object($selection['metadata'] ?? null) ? (array) $selection['metadata'] : (is_array($selection['metadata'] ?? null) ? $selection['metadata'] : []);
        $resMeta       = is_object($resource['metadata'] ?? null) ? (array) $resource['metadata'] : (is_array($resource['metadata'] ?? null) ? $resource['metadata'] : []);

        $resolvedImage = $context['resolvedImage'] ?? ($resource['effectiveThumbnailResource'] ?? null);
        $resImgArr     = is_object($resolvedImage) ? (array) $resolvedImage : (is_array($resolvedImage) ? $resolvedImage : []);
        $resImgMeta    = is_object($resImgArr['metadata'] ?? null) ? (array) $resImgArr['metadata'] : (is_array($resImgArr['metadata'] ?? null) ? $resImgArr['metadata'] : []);

        $imageAddress = is_string($context['imageAddress'] ?? null) ? trim($context['imageAddress']) : '';
        $imageUrl     = is_string($context['imageUrl'] ?? null) ? trim($context['imageUrl']) : '';
        $domSrc       = is_string($domImageSrc) ? trim($domImageSrc) : '';

        $explicitlyCleared = (array_key_exists('ext.smartcrop.crop', $usage) && empty($usage['ext.smartcrop.crop']))
            || (array_key_exists('smartcrop.crop', $usage) && empty($usage['smartcrop.crop']))
            || (array_key_exists('ext.smartcrop.crop', $contextMeta) && empty($contextMeta['ext.smartcrop.crop']))
            || (array_key_exists('smartcrop.crop', $contextMeta) && empty($contextMeta['smartcrop.crop']));

        $extSelectionAddress = is_object($usage['ext.selectionAddress'] ?? null)
            ? (array) $usage['ext.selectionAddress']
            : (is_array($usage['ext.selectionAddress'] ?? null) ? $usage['ext.selectionAddress'] : []);
        $compounds = is_object($extSelectionAddress['compounds'] ?? null)
            ? (array) $extSelectionAddress['compounds']
            : (is_array($extSelectionAddress['compounds'] ?? null) ? $extSelectionAddress['compounds'] : []);

        $rawThumbOverride = $usage['visual.thumbnailOverride'] ?? ($compounds['visual.thumbnailOverride'] ?? null);
        $overrideImage = '';
        if (is_string($rawThumbOverride)) {
            $overrideImage = trim($rawThumbOverride);
        } elseif (is_array($rawThumbOverride) || is_object($rawThumbOverride)) {
            $ovArr = (array) $rawThumbOverride;
            $overrideImage = trim((string) ($ovArr['image'] ?? $ovArr['url'] ?? $ovArr['id'] ?? ''));
        }
        $hasThumbnailOverride = $overrideImage !== '';

        $resolvedImgSource = trim((string) (
            $resImgArr['image']
            ?? $resImgArr['thumbnail']
            ?? $resImgMeta['image']
            ?? $resImgMeta['thumbnail']
            ?? $resImgMeta['url']
            ?? $resImgArr['url']
            ?? (($resImgArr['type'] ?? '') === 'image' ? ($resImgArr['id'] ?? '') : '')
        ));

        $imagesData = !empty($resource) ? self::extractImagesData($resource) : null;
        $indigenousSource = trim((string) (
            $resource['image']
            ?? $resMeta['image']
            ?? ($imagesData['image_intro'] ?? null)
            ?? ($imagesData['image_fulltext'] ?? null)
            ?? (!$hasThumbnailOverride ? (
                $resource['thumbnail']
                ?? $resMeta['thumbnail']
                ?? $resMeta['poster']
                ?? $resMeta['url']
                ?? $resource['url']
                ?? (($resource['type'] ?? '') === 'image' ? ($resource['id'] ?? '') : '')
            ) : '')
        ));

        $isImageLikeAddress = static function (string $addr): bool {
            if ($addr === '') {
                return false;
            }
            $beforeQuery = preg_split('/[?#]/', $addr, 2)[0] ?? '';
            return str_contains($addr, '#joomlaImage://')
                || str_starts_with(strtolower($addr), 'file:')
                || (!str_contains($beforeQuery, ':') && (str_contains($beforeQuery, '/') || str_contains($beforeQuery, '.')));
        };

        // Resolve final target image identity in priority order
        $finalImageCandidates = [
            $imageUrl,
            $resolvedImgSource,
            $isImageLikeAddress($overrideImage) ? $overrideImage : '',
            $isImageLikeAddress($imageAddress) ? $imageAddress : '',
            $domSrc,
            (string) ($resource['effectiveThumbnail'] ?? ''),
            $indigenousSource,
        ];

        $finalImage = '';
        foreach ($finalImageCandidates as $fc) {
            if ($fc !== '' && ImageNormalizer::normalize($fc) !== '') {
                $finalImage = $fc;
                break;
            }
        }

        if ($finalImage === '') {
            return null;
        }

        if (!$hasThumbnailOverride && $indigenousSource !== '' && !ImageNormalizer::matches($indigenousSource, $finalImage)) {
            $hasThumbnailOverride = true;
        }

        $hasUriCropParams = static function (string $val): bool {
            return str_contains($val, 'crop=')
                || str_contains($val, '.coords=')
                || str_contains($val, '_coords=');
        };

        // 1. Explicit extension metadata (ext.smartcrop.crop / smartcrop.crop)
        $extCandidates = [
            $usage['ext.smartcrop.crop'] ?? null,
            $usage['smartcrop.crop'] ?? null,
            $contextMeta['ext.smartcrop.crop'] ?? null,
            $contextMeta['smartcrop.crop'] ?? null,
            $selectionMeta['ext.smartcrop.crop'] ?? null,
            $selectionMeta['smartcrop.crop'] ?? null,
        ];
        foreach ($extCandidates as $cand) {
            if (!empty($cand)) {
                $res = self::resolveCropPresentation($finalImage, $cand);
                if ($res !== null) {
                    return $res;
                }
            }
        }

        // 2. Direct resolved imageAddress / imageUrl / DOM src containing crop parameters
        foreach ([$imageAddress, $imageUrl, $domSrc] as $uriCand) {
            if ($uriCand !== '' && $hasUriCropParams($uriCand)) {
                $res = self::resolveCropPresentation($finalImage, $uriCand);
                if ($res !== null) {
                    return $res;
                }
            }
        }

        // 3. Thumbnail override compounds & values
        $overrideCandidates = [
            $compounds['visual.thumbnailOverride'] ?? null,
            $usage['visual.thumbnailOverride'] ?? null,
            $resource['effectiveImageAddress'] ?? null,
        ];
        foreach ($compounds as $compVal) {
            if (is_string($compVal) && $hasUriCropParams($compVal)) {
                $overrideCandidates[] = $compVal;
            }
        }
        foreach ($overrideCandidates as $ovCand) {
            if (empty($ovCand)) {
                continue;
            }
            if (is_array($ovCand) || is_object($ovCand)) {
                $res = self::resolveCropPresentation($finalImage, (array) $ovCand);
                if ($res !== null) {
                    return $res;
                }
            } elseif (is_string($ovCand) && ($hasUriCropParams($ovCand) || str_starts_with(trim($ovCand), '{'))) {
                $res = self::resolveCropPresentation($finalImage, $ovCand);
                if ($res !== null) {
                    return $res;
                }
            }
        }

        // 4. Selection Address (smartcrop=sc or crop=c)
        $addressCandidates = [
            $context['address'] ?? null,
            $selection['address'] ?? null,
            $usage['ext.address'] ?? null,
        ];
        foreach ($addressCandidates as $addrCand) {
            if (is_string($addrCand) && $addrCand !== '' && $hasUriCropParams($addrCand)) {
                $res = self::resolveCropPresentation($finalImage, $addrCand);
                if ($res !== null) {
                    return $res;
                }
            }
        }

        if ($explicitlyCleared) {
            return null;
        }

        // 5. Resolved image resource (effectiveThumbnailResource) crop metadata
        if (!empty($resImgArr)) {
            $resImgCropCandidates = [
                $resImgArr['imageCrop'] ?? null,
                $resImgMeta['imageCrop'] ?? null,
                $resImgArr['crop'] ?? null,
                $resImgMeta['crop'] ?? null,
                $resImgArr['smartcrop'] ?? null,
                $resImgMeta['smartcrop'] ?? null,
            ];
            foreach ($resImgCropCandidates as $cand) {
                if (empty($cand)) {
                    continue;
                }
                if (is_object($cand)) {
                    $cand = (array) $cand;
                }
                if (is_array($cand) && empty($cand['source']) && $resolvedImgSource !== '') {
                    $cand['source'] = $resolvedImgSource;
                }
                $res = self::resolveCropPresentation($finalImage, $cand);
                if ($res !== null) {
                    return $res;
                }
            }

            foreach ([$resImgArr['image'] ?? '', $resImgMeta['image'] ?? '', $resImgArr['thumbnail'] ?? '', $resImgMeta['thumbnail'] ?? ''] as $strCand) {
                if (is_string($strCand) && $strCand !== '' && $hasUriCropParams($strCand)) {
                    $res = self::resolveCropPresentation($finalImage, $strCand);
                    if ($res !== null) {
                        return $res;
                    }
                }
            }

            $resImgImagesData = self::extractImagesData($resImgArr);
            if ($resImgImagesData !== null) {
                foreach ([$resImgImagesData['image_intro'] ?? '', $resImgImagesData['image_fulltext'] ?? ''] as $artUri) {
                    if (is_string($artUri) && $artUri !== '' && $hasUriCropParams($artUri)) {
                        $res = self::resolveCropPresentation($finalImage, $artUri);
                        if ($res !== null) {
                            return $res;
                        }
                    }
                }
                $legacyResolvedCrop = self::getCrop($resImgArr, $finalImage);
                if ($legacyResolvedCrop !== null) {
                    $res = self::resolveCropPresentation($finalImage, $legacyResolvedCrop);
                    if ($res !== null) {
                        return $res;
                    }
                }
            }
        }

        // 6. Indigenous resource crop metadata (only if matching finalImage and not overridden by a different image)
        if (!empty($resource)) {
            $indigenousCropCandidates = [
                $resource['imageCrop'] ?? null,
                $resMeta['imageCrop'] ?? null,
                $resource['crop'] ?? null,
                $resMeta['crop'] ?? null,
                $resource['smartcrop'] ?? null,
                $resMeta['smartcrop'] ?? null,
            ];
            foreach ($indigenousCropCandidates as $cand) {
                if (empty($cand)) {
                    continue;
                }
                if (is_string($cand) && str_starts_with(trim($cand), '{')) {
                    $decoded = json_decode(trim($cand), true);
                    if (is_array($decoded)) {
                        $cand = $decoded;
                    }
                } elseif (is_object($cand)) {
                    $cand = (array) $cand;
                }
                if (is_array($cand)) {
                    if (empty($cand['source']) && empty($cand['src'])) {
                        if ($indigenousSource !== '') {
                            $cand['source'] = $indigenousSource;
                        } elseif ($hasThumbnailOverride) {
                            continue;
                        }
                    }
                }
                $res = self::resolveCropPresentation($finalImage, $cand);
                if ($res !== null) {
                    return $res;
                }
            }

            $indigenousUriCandidates = [
                $resource['image'] ?? '',
                $resMeta['image'] ?? '',
                $imagesData['image_intro'] ?? '',
                $imagesData['image_fulltext'] ?? '',
            ];
            if (!$hasThumbnailOverride) {
                $indigenousUriCandidates[] = $resource['thumbnail'] ?? '';
                $indigenousUriCandidates[] = $resMeta['thumbnail'] ?? '';
            }
            foreach ($indigenousUriCandidates as $uriCand) {
                if (is_string($uriCand) && $uriCand !== '' && $hasUriCropParams($uriCand)) {
                    $res = self::resolveCropPresentation($finalImage, $uriCand);
                    if ($res !== null) {
                        return $res;
                    }
                }
            }

            $legacyCrop = self::getCrop($resource, $finalImage);
            if ($legacyCrop !== null) {
                $res = self::resolveCropPresentation($finalImage, $legacyCrop);
                if ($res !== null) {
                    return $res;
                }
            }
        }

        return null;
    }

    /**
     * Applies SmartCrop presentation styles directly to a DOMElement (`<img>`)
     * for the `onSmartBrowserPrepareImagePresentation` contract, preserving
     * any unrelated inline CSS properties on the image element.
     *
     * @param   \DOMElement  $image    The primary `<img>` DOMElement
     * @param   array        $context  The presentation context from SmartBrowser
     *
     * @return  bool         True if crop presentation styles were applied, false otherwise
     */
    public static function applySmartBrowserImagePresentation(\DOMElement $image, array $context): bool
    {
        $domSrc = $image->hasAttribute('src') ? $image->getAttribute('src') : null;
        $presentation = self::resolveSmartBrowserImagePresentation($context, $domSrc);
        if ($presentation === null) {
            return false;
        }

        $managedStyles = [
            'aspect-ratio'   => (string) ($presentation['ratio']['aspect_ratio'] ?? '4 / 3'),
            'position'       => 'absolute',
            'left'           => ($presentation['values']['left_pct'] ?? 0) . '%',
            'top'            => ($presentation['values']['top_pct'] ?? 0) . '%',
            'width'          => ($presentation['values']['width_pct'] ?? 100) . '%',
            'height'         => ($presentation['values']['height_pct'] ?? 100) . '%',
            'max-width'      => 'none',
            'max-height'     => 'none',
            'object-fit'     => 'fill',
            'pointer-events' => 'none',
        ];

        $existingStyle = $image->hasAttribute('style') ? $image->getAttribute('style') : '';
        $mergedStyle   = self::mergeInlineStyles($existingStyle, $managedStyles);
        $image->setAttribute('style', $mergedStyle);

        return true;
    }

    /**
     * Merges managed CSS declarations into an existing inline style string while
     * preserving any unrelated CSS properties in their original order.
     *
     * @param   string                 $existingStyle  Existing `style` attribute value
     * @param   array<string, string>  $managedStyles  CSS property => value pairs to apply
     *
     * @return  string
     */
    public static function mergeInlineStyles(string $existingStyle, array $managedStyles): string
    {
        $declarations = [];

        foreach (explode(';', $existingStyle) as $chunk) {
            $chunk = trim($chunk);
            if ($chunk === '') {
                continue;
            }
            $colonPos = strpos($chunk, ':');
            if ($colonPos === false) {
                continue;
            }
            $prop = trim(substr($chunk, 0, $colonPos));
            $val  = trim(substr($chunk, $colonPos + 1));
            if ($prop !== '' && $val !== '') {
                $declarations[strtolower($prop)] = [
                    'name'  => $prop,
                    'value' => $val,
                ];
            }
        }

        foreach ($managedStyles as $prop => $val) {
            $prop = trim((string) $prop);
            $val  = trim((string) $val);
            if ($prop !== '' && $val !== '') {
                $declarations[strtolower($prop)] = [
                    'name'  => $prop,
                    'value' => $val,
                ];
            }
        }

        if (empty($declarations)) {
            return '';
        }

        $parts = [];
        foreach ($declarations as $decl) {
            $parts[] = $decl['name'] . ': ' . $decl['value'];
        }

        return implode('; ', $parts) . ';';
    }
}

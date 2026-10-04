<?php

declare(strict_types=1);

namespace SuperSoftJx\Plugin\Content\SmartCrop\Service;

defined('_JEXEC') or die;

final class CropValidator
{
    /**
     * Tolerance for floating point ratio comparison.
     */
    public const RATIO_TOLERANCE = 0.005;

    /**
     * Validates and cleans a SmartCrop metadata structure.
     *
     * @param   mixed       $data                Raw crop metadata array or JSON string
     * @param   float|null  $expectedRatioWidth  Optional ratio width to validate against
     * @param   float|null  $expectedRatioHeight Optional ratio height to validate against
     *
     * @return  array|null  Sanitized crop metadata array or null if invalid
     */
    public static function validateAndClean(
        mixed $data,
        ?float $expectedRatioWidth = null,
        ?float $expectedRatioHeight = null
    ): ?array {
        if (is_string($data)) {
            $data = trim($data);
            if ($data === '' || ($data[0] !== '{' && $data[0] !== '[')) {
                return null;
            }
            $data = json_decode($data, true);
        }

        if (!is_array($data)) {
            return null;
        }

        $version  = (int) ($data['version'] ?? 1);
        $profiles = $data['profiles'] ?? null;

        if (!is_array($profiles)) {
            return null;
        }

        $cleanProfiles = [];
        foreach ($profiles as $profileKey => $profileData) {
            if (!is_string($profileKey) || !is_array($profileData)) {
                continue;
            }

            $validatedProfile = self::validateProfile($profileData, $expectedRatioWidth, $expectedRatioHeight);
            if ($validatedProfile !== null) {
                $cleanProfiles[$profileKey] = $validatedProfile;
            }
        }

        if (empty($cleanProfiles)) {
            return null;
        }

        // Guarantee backward-compatible 'default' profile
        if (!isset($cleanProfiles['default'])) {
            if (isset($cleanProfiles['intro'])) {
                $cleanProfiles['default'] = $cleanProfiles['intro'];
            } elseif (isset($cleanProfiles['fulltext'])) {
                $cleanProfiles['default'] = $cleanProfiles['fulltext'];
            } else {
                $first = reset($cleanProfiles);
                if ($first !== false) {
                    $cleanProfiles['default'] = $first;
                }
            }
        }

        return [
            'version'  => max(1, $version),
            'profiles' => $cleanProfiles,
        ];
    }

    /**
     * Validates and sanitizes a single crop profile structure.
     *
     * @param   array       $profileData
     * @param   float|null  $expectedRatioWidth
     * @param   float|null  $expectedRatioHeight
     *
     * @return  array|null
     */
    public static function validateProfile(
        array $profileData,
        ?float $expectedRatioWidth = null,
        ?float $expectedRatioHeight = null
    ): ?array {
        // Validate source
        $rawSource = $profileData['source'] ?? '';
        $source    = ImageNormalizer::normalize($rawSource);
        if ($source === '') {
            return null;
        }

        // Validate ratio
        $ratio = $profileData['ratio'] ?? null;
        if (!is_array($ratio)) {
            return null;
        }

        $ratioW = (float) ($ratio['width'] ?? 0);
        $ratioH = (float) ($ratio['height'] ?? 0);
        if ($ratioW <= 0 || $ratioH <= 0) {
            return null;
        }

        // Optional ratio check against configured ratio
        if ($expectedRatioWidth !== null && $expectedRatioHeight !== null && $expectedRatioWidth > 0 && $expectedRatioHeight > 0) {
            $currentRatioValue  = $ratioW / $ratioH;
            $expectedRatioValue = $expectedRatioWidth / $expectedRatioHeight;

            if (abs($currentRatioValue - $expectedRatioValue) > self::RATIO_TOLERANCE) {
                return null;
            }
        }

        // Validate crop rectangle
        $crop = $profileData['crop'] ?? null;
        if (!is_array($crop)) {
            return null;
        }

        if (!isset($crop['x'], $crop['y'], $crop['width'], $crop['height'])) {
            return null;
        }

        $x = (float) $crop['x'];
        $y = (float) $crop['y'];
        $w = (float) $crop['width'];
        $h = (float) $crop['height'];

        // Strict boundary checks
        if ($x < -0.0001 || $x > 1.0 || $y < -0.0001 || $y > 1.0) {
            return null;
        }

        if ($w <= 0.0001 || $w > 1.0001 || $h <= 0.0001 || $h > 1.0001) {
            return null;
        }

        if (($x + $w) > 1.0005 || ($y + $h) > 1.0005) {
            return null;
        }

        // Clamp values to [0, 1] range to avoid floating precision drift
        $x = max(0.0, min(1.0, $x));
        $y = max(0.0, min(1.0, $y));
        $w = max(0.0001, min(1.0 - $x, $w));
        $h = max(0.0001, min(1.0 - $y, $h));

        $cleanProfile = [
            'source' => $source,
            'ratio'  => [
                'width'  => round($ratioW, 4),
                'height' => round($ratioH, 4),
            ],
            'crop'   => [
                'x'      => round($x, 6),
                'y'      => round($y, 6),
                'width'  => round($w, 6),
                'height' => round($h, 6),
            ],
        ];

        // Optional source dimensions if present
        $sourceDims = $profileData['source_dimensions'] ?? null;
        if (is_array($sourceDims) && !empty($sourceDims['width']) && !empty($sourceDims['height'])) {
            $dimW = (int) $sourceDims['width'];
            $dimH = (int) $sourceDims['height'];

            if ($dimW > 0 && $dimH > 0) {
                $cleanProfile['source_dimensions'] = [
                    'width'  => $dimW,
                    'height' => $dimH,
                ];
            }
        }

        return $cleanProfile;
    }

    /**
     * Checks if a profile ratio matches given target ratio within tolerance.
     *
     * @param   array  $profileRatio  Array with 'width' and 'height' keys
     * @param   float  $targetWidth
     * @param   float  $targetHeight
     *
     * @return  bool
     */
    public static function isRatioMatching(array $profileRatio, float $targetWidth, float $targetHeight): bool
    {
        $w = (float) ($profileRatio['width'] ?? 0);
        $h = (float) ($profileRatio['height'] ?? 0);

        if ($w <= 0 || $h <= 0 || $targetWidth <= 0 || $targetHeight <= 0) {
            return false;
        }

        return abs(($w / $h) - ($targetWidth / $targetHeight)) <= self::RATIO_TOLERANCE;
    }
}

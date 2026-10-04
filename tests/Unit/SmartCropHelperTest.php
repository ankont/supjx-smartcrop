<?php

declare(strict_types=1);

namespace SuperSoftJx\Plugin\Content\SmartCrop\Tests\Unit;

use SuperSoftJx\Plugin\Content\SmartCrop\Helper\SmartCropHelper;

final class SmartCropHelperTest
{
    public function runAll(): void
    {
        $this->testGetCropSuccess();
        $this->testGetCropSourceMismatch();
        $this->testGetCropProfileNotFound();
        $this->testHasCrop();
        $this->testGetPresentationCalculations();
        $this->testRenderImage();
        $this->testParseCropFromUri();
        $this->testGetCssStyle();
        $this->testGetFocalPointAndScale();
    }

    private function assertSame(mixed $expected, mixed $actual, string $message = ''): void
    {
        if ($expected !== $actual) {
            throw new \RuntimeException(sprintf(
                "Assertion failed: expected '%s', got '%s'. %s",
                var_export($expected, true),
                var_export($actual, true),
                $message
            ));
        }
    }

    private function assertTrue(bool $condition, string $message = ''): void
    {
        if (!$condition) {
            throw new \RuntimeException("Assertion failed: expected true. " . $message);
        }
    }

    private function assertFalse(bool $condition, string $message = ''): void
    {
        if ($condition) {
            throw new \RuntimeException("Assertion failed: expected false. " . $message);
        }
    }

    private function assertNull(mixed $actual, string $message = ''): void
    {
        if ($actual !== null) {
            throw new \RuntimeException("Assertion failed: expected null, got " . var_export($actual, true) . ". " . $message);
        }
    }

    private function createMockArticle(): array
    {
        return [
            'id' => 15,
            'images' => [
                'image_intro' => 'images/intro.jpg',
                'smartcrop' => [
                    'version' => 1,
                    'profiles' => [
                        'default' => [
                            'source' => 'images/intro.jpg',
                            'ratio'  => ['width' => 4, 'height' => 3],
                            'crop'   => ['x' => 0.1, 'y' => 0.05, 'width' => 0.8, 'height' => 0.6],
                            'source_dimensions' => ['width' => 1600, 'height' => 1200],
                        ]
                    ]
                ]
            ]
        ];
    }

    private function testGetCropSuccess(): void
    {
        $article = $this->createMockArticle();

        // Target image matches stored source
        $crop = SmartCropHelper::getCrop($article, 'images/intro.jpg');
        $this->assertTrue(is_array($crop));
        $this->assertSame('default', $crop['profile']);
        $this->assertSame(0.1, $crop['crop']['x']);
        $this->assertSame(0.8, $crop['crop']['width']);

        // Matches also with fragment or leading slash
        $cropFragment = SmartCropHelper::getCrop($article, '/images/intro.jpg#joomlaImage://...');
        $this->assertTrue(is_array($cropFragment));
    }

    private function testGetCropSourceMismatch(): void
    {
        $article = $this->createMockArticle();

        // Asking for crop on a completely different image returns null
        $crop = SmartCropHelper::getCrop($article, 'images/different-image.jpg');
        $this->assertNull($crop);
    }

    private function testGetCropProfileNotFound(): void
    {
        $article = $this->createMockArticle();

        // Asking for non-existent profile returns null
        $crop = SmartCropHelper::getCrop($article, 'images/intro.jpg', 'banner');
        $this->assertNull($crop);
    }

    private function testHasCrop(): void
    {
        $article = $this->createMockArticle();
        $this->assertTrue(SmartCropHelper::hasCrop($article, 'images/intro.jpg'));
        $this->assertFalse(SmartCropHelper::hasCrop($article, 'images/other.jpg'));
    }

    private function testGetPresentationCalculations(): void
    {
        $article = $this->createMockArticle();

        // Crop: x=0.1, y=0.05, w=0.8, h=0.6, ratio=4:3
        // width = (1 / 0.8) * 100 = 125%
        // height = (1 / 0.6) * 100 = 166.6667%
        // left = -(0.1 / 0.8) * 100 = -12.5%
        // top = -(0.05 / 0.6) * 100 = -8.3333%
        $pres = SmartCropHelper::getPresentation($article, 'images/intro.jpg');

        $this->assertTrue(is_array($pres));
        $this->assertSame(125.0, $pres['values']['width_pct']);
        $this->assertSame(-12.5, $pres['values']['left_pct']);
        $this->assertSame(round((1 / 0.6) * 100, 4), $pres['values']['height_pct']);
        $this->assertSame(round(-(0.05 / 0.6) * 100, 4), $pres['values']['top_pct']);

        // CSS styles
        $this->assertSame('position: relative; overflow: hidden; aspect-ratio: 4 / 3;', $pres['styles']['container']);
        $this->assertTrue(str_contains($pres['styles']['image'], 'left: -12.5%;'));
        $this->assertTrue(str_contains($pres['styles']['image'], 'width: 125%;'));
        $this->assertTrue(str_contains($pres['styles']['css_variables'], '--smartcrop-left: -12.5%;'));
    }

    private function testRenderImage(): void
    {
        $article = $this->createMockArticle();

        $html = SmartCropHelper::renderImage($article, 'images/intro.jpg', ['alt' => 'Test Article']);
        $this->assertTrue(str_contains($html, '<div class="smartcrop-frame"'));
        $this->assertTrue(str_contains($html, 'alt="Test Article"'));
        $this->assertTrue(str_contains($html, 'aspect-ratio: 4 / 3;'));
        $this->assertTrue(str_contains($html, 'left: -12.5%;'));

        // Fallback when no crop exists
        $fallbackHtml = SmartCropHelper::renderImage($article, 'images/other.jpg', ['alt' => 'Other']);
        $this->assertTrue(str_starts_with($fallbackHtml, '<img src='));
        $this->assertFalse(str_contains($fallbackHtml, 'smartcrop-frame'));
    }

    private function testParseCropFromUri(): void
    {
        $uri = 'images/categories/plh-sources.png#joomlaImage://local-images/categories/plh-sources.png?width=1448&height=1086&crop=0.1000,0.2000,0.8000,0.6000&ratio=4:3&zoom=1.25';
        $parsed = SmartCropHelper::parseCropFromUri($uri);

        $this->assertTrue(is_array($parsed));
        $this->assertSame(0.1, $parsed['crop']['x']);
        $this->assertSame(0.2, $parsed['crop']['y']);
        $this->assertSame(0.8, $parsed['crop']['width']);
        $this->assertSame(0.6, $parsed['crop']['height']);
        $this->assertSame(4.0, $parsed['ratio']['width']);
        $this->assertSame(3.0, $parsed['ratio']['height']);
        $this->assertSame(1.25, $parsed['zoom']);
        $this->assertSame(50.0, $parsed['focal_x']);
        $this->assertSame(50.0, $parsed['focal_y']);

        // Invalid URI returns null
        $this->assertNull(SmartCropHelper::parseCropFromUri('images/sample.jpg#joomlaImage://...?width=100'));
        $this->assertNull(SmartCropHelper::parseCropFromUri(''));
    }

    private function testGetCssStyle(): void
    {
        $uri = 'images/photo.jpg#joomlaImage://...?crop=0.1,0.2,0.8,0.6&zoom=1.5&ratio=4:3';
        $css = SmartCropHelper::getCssStyle($uri);

        // focal_x = (0.1 + 0.8/2) * 100 = 50%
        // focal_y = (0.2 + 0.6/2) * 100 = 50%
        $this->assertTrue(str_contains($css, 'object-position: 50% 50%;'));
        $this->assertTrue(str_contains($css, 'transform-origin: 50% 50%;'));
        $this->assertTrue(str_contains($css, 'transform: scale(1.5);'));

        // From mock article
        $article = $this->createMockArticle();
        $articleCss = SmartCropHelper::getCssStyle($article);
        // focal_x = (0.1 + 0.8/2) * 100 = 50%
        // focal_y = (0.05 + 0.6/2) * 100 = 35%
        $this->assertTrue(str_contains($articleCss, 'object-position: 50% 35%;'));
        $this->assertTrue(str_contains($articleCss, 'transform-origin: 50% 35%;'));

        // Non-cropped returns empty string
        $this->assertSame('', SmartCropHelper::getCssStyle('images/no-crop.jpg'));
    }

    private function testGetFocalPointAndScale(): void
    {
        $uri = 'images/photo.jpg#joomlaImage://...?crop=0.2,0.1,0.6,0.4&zoom=1.33';
        $info = SmartCropHelper::getFocalPointAndScale($uri);

        $this->assertTrue(is_array($info));
        // focal_x = (0.2 + 0.6/2) * 100 = 50%
        // focal_y = (0.1 + 0.4/2) * 100 = 30%
        $this->assertSame(50.0, $info['focal_x']);
        $this->assertSame(30.0, $info['focal_y']);
        $this->assertSame(1.33, $info['zoom']);
        $this->assertSame('4:3', $info['ratio']);
        $this->assertTrue(str_contains($info['css'], 'object-position: 50% 30%;'));
    }
}

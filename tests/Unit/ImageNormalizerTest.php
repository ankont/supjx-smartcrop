<?php

declare(strict_types=1);

namespace SuperSoftJx\Plugin\Content\SmartCrop\Tests\Unit;

use SuperSoftJx\Plugin\Content\SmartCrop\Service\ImageNormalizer;

final class ImageNormalizerTest
{
    public function runAll(): void
    {
        $this->testPlainPath();
        $this->testLeadingAndBackslashes();
        $this->testJoomlaFragmentStripping();
        $this->testJsonStringsAndArrays();
        $this->testSameSiteAbsoluteUrl();
        $this->testSubfolderUrl();
        $this->testUrlDecoding();
        $this->testMatches();
        $this->testToUrl();
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

    private function testPlainPath(): void
    {
        $this->assertSame('images/sample.jpg', ImageNormalizer::normalize('images/sample.jpg'));
    }

    private function testLeadingAndBackslashes(): void
    {
        $this->assertSame('images/sample.jpg', ImageNormalizer::normalize('/images/sample.jpg'));
        $this->assertSame('images/sample.jpg', ImageNormalizer::normalize('images\\sample.jpg'));
        $this->assertSame('images/sample.jpg', ImageNormalizer::normalize('\\images\\sample.jpg'));
    }

    private function testJoomlaFragmentStripping(): void
    {
        $withFragment = 'images/sample.jpg#joomlaImage://local-images/sample.jpg?width=1200&height=800';
        $this->assertSame('images/sample.jpg', ImageNormalizer::normalize($withFragment));

        $fragmentOnly = '#joomlaImage://local-images/sample.jpg?width=1200&height=800';
        $this->assertSame('images/sample.jpg', ImageNormalizer::normalize($fragmentOnly));

        $localImagesScheme = 'local-images:/sample.jpg';
        $this->assertSame('images/sample.jpg', ImageNormalizer::normalize($localImagesScheme));
    }

    private function testJsonStringsAndArrays(): void
    {
        $json = '{"imagefile":"images/sample.jpg","alt_text":""}';
        $this->assertSame('images/sample.jpg', ImageNormalizer::normalize($json));

        $arr = ['imagefile' => 'images/sample.jpg'];
        $this->assertSame('images/sample.jpg', ImageNormalizer::normalize($arr));

        $arrSrc = ['src' => 'images/sample.jpg'];
        $this->assertSame('images/sample.jpg', ImageNormalizer::normalize($arrSrc));
    }

    private function testSameSiteAbsoluteUrl(): void
    {
        // Host in bootstrap mock is example.com
        $url = 'https://example.com/images/sample.jpg';
        $this->assertSame('images/sample.jpg', ImageNormalizer::normalize($url));

        // External host remains external URL
        $external = 'https://other-domain.org/photos/flower.jpg';
        $this->assertSame('https://other-domain.org/photos/flower.jpg', ImageNormalizer::normalize($external));
    }

    private function testSubfolderUrl(): void
    {
        // Test query string removal on local path
        $this->assertSame('images/sample.jpg', ImageNormalizer::normalize('images/sample.jpg?v=12345'));
    }

    private function testUrlDecoding(): void
    {
        $this->assertSame('images/summer holiday.jpg', ImageNormalizer::normalize('images/summer%20holiday.jpg'));
    }

    private function testMatches(): void
    {
        $path1 = 'images/sample.jpg';
        $path2 = 'images/sample.jpg#joomlaImage://local-images/sample.jpg?width=1200&height=800';
        $path3 = 'https://example.com/images/sample.jpg';
        $path4 = '{"imagefile":"images/sample.jpg"}';

        $this->assertTrue(ImageNormalizer::matches($path1, $path2));
        $this->assertTrue(ImageNormalizer::matches($path1, $path3));
        $this->assertTrue(ImageNormalizer::matches($path1, $path4));
        $this->assertTrue(ImageNormalizer::matches($path2, $path4));

        $this->assertFalse(ImageNormalizer::matches('images/a.jpg', 'images/b.jpg'));
        $this->assertFalse(ImageNormalizer::matches('', 'images/a.jpg'));
    }

    private function testToUrl(): void
    {
        $this->assertSame('https://example.com/images/sample.jpg', ImageNormalizer::toUrl('images/sample.jpg'));
        $this->assertSame('https://cdn.example.org/photo.jpg', ImageNormalizer::toUrl('https://cdn.example.org/photo.jpg'));
        $this->assertSame('', ImageNormalizer::toUrl(''));
    }
}

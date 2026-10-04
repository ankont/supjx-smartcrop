<?php

declare(strict_types=1);

namespace SuperSoftJx\Plugin\Content\SmartCrop\Tests\Unit;

use SuperSoftJx\Plugin\Content\SmartCrop\Service\CropValidator;

final class CropValidatorTest
{
    public function runAll(): void
    {
        $this->testValidCrop();
        $this->testInvalidInputs();
        $this->testRatioCheck();
        $this->testOutOfBoundsRejection();
        $this->testClamping();
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

    private function testValidCrop(): void
    {
        $input = [
            'version'  => 1,
            'profiles' => [
                'default' => [
                    'source' => 'images/sample.jpg#fragment',
                    'ratio'  => ['width' => 4, 'height' => 3],
                    'crop'   => ['x' => 0.1, 'y' => 0.2, 'width' => 0.8, 'height' => 0.6],
                    'source_dimensions' => ['width' => 1200, 'height' => 900],
                ]
            ]
        ];

        $cleaned = CropValidator::validateAndClean($input, 4.0, 3.0);
        $this->assertTrue(is_array($cleaned));
        $this->assertSame(1, $cleaned['version']);
        $this->assertSame('images/sample.jpg', $cleaned['profiles']['default']['source']);
        $this->assertSame(0.1, $cleaned['profiles']['default']['crop']['x']);
        $this->assertSame(0.8, $cleaned['profiles']['default']['crop']['width']);
        $this->assertSame(1200, $cleaned['profiles']['default']['source_dimensions']['width']);
    }

    private function testInvalidInputs(): void
    {
        $this->assertNull(CropValidator::validateAndClean(null));
        $this->assertNull(CropValidator::validateAndClean('invalid-json'));
        $this->assertNull(CropValidator::validateAndClean([]));
        $this->assertNull(CropValidator::validateAndClean(['profiles' => []]));
    }

    private function testRatioCheck(): void
    {
        $cropData = [
            'version'  => 1,
            'profiles' => [
                'default' => [
                    'source' => 'images/sample.jpg',
                    'ratio'  => ['width' => 4, 'height' => 3],
                    'crop'   => ['x' => 0, 'y' => 0, 'width' => 1, 'height' => 1],
                ]
            ]
        ];

        // Matches 4:3
        $this->assertTrue(CropValidator::isRatioMatching(['width' => 4, 'height' => 3], 4, 3));
        $this->assertTrue(CropValidator::isRatioMatching(['width' => 8, 'height' => 6], 4, 3));

        // Mismatches 16:9
        $this->assertFalse(CropValidator::isRatioMatching(['width' => 4, 'height' => 3], 16, 9));

        // validateAndClean rejects ratio mismatch if expected ratio given
        $this->assertNull(CropValidator::validateAndClean($cropData, 16.0, 9.0));
    }

    private function testOutOfBoundsRejection(): void
    {
        $badCrop = [
            'version'  => 1,
            'profiles' => [
                'default' => [
                    'source' => 'images/sample.jpg',
                    'ratio'  => ['width' => 4, 'height' => 3],
                    'crop'   => ['x' => 0.5, 'y' => 0.5, 'width' => 0.8, 'height' => 0.8], // 0.5 + 0.8 = 1.3 > 1.0!
                ]
            ]
        ];

        $this->assertNull(CropValidator::validateAndClean($badCrop));
    }

    private function testClamping(): void
    {
        $slightDriftCrop = [
            'version'  => 1,
            'profiles' => [
                'default' => [
                    'source' => 'images/sample.jpg',
                    'ratio'  => ['width' => 4, 'height' => 3],
                    'crop'   => ['x' => 0.0, 'y' => 0.0, 'width' => 1.0001, 'height' => 1.0001],
                ]
            ]
        ];

        $cleaned = CropValidator::validateAndClean($slightDriftCrop);
        $this->assertTrue(is_array($cleaned));
        $this->assertSame(1.0, $cleaned['profiles']['default']['crop']['width']);
        $this->assertSame(1.0, $cleaned['profiles']['default']['crop']['height']);
    }
}

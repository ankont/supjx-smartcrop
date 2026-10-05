<?php

declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/Unit/ImageNormalizerTest.php';
require_once __DIR__ . '/Unit/CropValidatorTest.php';
require_once __DIR__ . '/Unit/VisualResolverTest.php';
require_once __DIR__ . '/Unit/SmartCropHelperTest.php';
require_once __DIR__ . '/Integration/FormAndStorageTest.php';

use SuperSoftJx\Plugin\Content\SmartCrop\Tests\Unit\ImageNormalizerTest;
use SuperSoftJx\Plugin\Content\SmartCrop\Tests\Unit\CropValidatorTest;
use SuperSoftJx\Plugin\Content\SmartCrop\Tests\Unit\VisualResolverTest;
use SuperSoftJx\Plugin\Content\SmartCrop\Tests\Unit\SmartCropHelperTest;
use SuperSoftJx\Plugin\Content\SmartCrop\Tests\Integration\FormAndStorageTest;

echo "============================================================\n";
echo "SuperSoftJx SmartCrop (plg_content_smartcrop) - Test Suite\n";
echo "Target: Joomla 5.4.x / 6.x | Version: 1.0.0-beta2\n";
echo "============================================================\n\n";

$suites = [
    'Image Normalization & Source Identity'  => new ImageNormalizerTest(),
    'Crop Rectangle & Ratio Validation'      => new CropValidatorTest(),
    'Effective Visual Resolution & Fallback' => new VisualResolverTest(),
    'Public Template API & CSS Presentation' => new SmartCropHelperTest(),
    'Form Injection & Article Storage (JSON)'=> new FormAndStorageTest(),
];

$passedSuites = 0;
$totalSuites  = count($suites);

foreach ($suites as $name => $suite) {
    echo "Running Suite: {$name}...\n";
    try {
        $suite->runAll();
        echo "Suite {$name}: OK\n\n";
        $passedSuites++;
    } catch (\Throwable $e) {
        echo "\n[FAIL] Exception in {$name}: " . $e->getMessage() . "\n";
        echo $e->getTraceAsString() . "\n\n";
        exit(1);
    }
}

echo "============================================================\n";
echo "All {$passedSuites}/{$totalSuites} test suites PASSED successfully!\n";
echo "============================================================\n";

<?php

declare(strict_types=1);

namespace SuperSoftJx\Plugin\Content\SmartCrop\Tests\Integration;

use Joomla\CMS\Form\Form;
use SuperSoftJx\Plugin\Content\SmartCrop\Extension\SmartCrop;
use SuperSoftJx\Plugin\Content\SmartCrop\Helper\SmartCropHelper;

final class FormAndStorageTest
{
    public function runAll(): void
    {
        $this->testContentPrepareFormExecution();
        $this->testOnContentPrepareWithUriCrop();
        $this->testOnContentPrepareWithoutCrop();
        $this->testOnContentPrepareBothIntroAndFulltext();
        $this->testOnContentPrepareWithEventObject();
        $this->testSubscribedEvents();
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

    private function testSubscribedEvents(): void
    {
        $events = SmartCrop::getSubscribedEvents();
        $this->assertTrue(isset($events['onContentPrepare']));
        $this->assertTrue(isset($events['onContentPrepareForm']));
        $this->assertSame('onContentPrepare', $events['onContentPrepare']);
        $this->assertSame('onContentPrepareForm', $events['onContentPrepareForm']);
    }

    private function testContentPrepareFormExecution(): void
    {
        $plugin = new SmartCrop();
        $form = new Form('com_content.article');

        // Verify executing onContentPrepareForm does not throw
        $plugin->onContentPrepareForm($form);
        $this->assertTrue(true);
    }

    private function testOnContentPrepareWithUriCrop(): void
    {
        $plugin = new SmartCrop();

        $item = (object) [
            'id' => 42,
            'title' => 'Article with Cropped Intro',
            'images' => json_encode([
                'image_intro' => 'images/banners/intro.jpg#joomlaImage://local-images/banners/intro.jpg?width=1200&height=800&crop=0.1000,0.2000,0.8000,0.6000&ratio=4:3&zoom=1.25',
                'image_fulltext' => '',
            ]),
        ];

        $params = null;
        $plugin->onContentPrepare('com_content.article', $item, $params);

        $this->assertTrue(!empty($item->smartcrop_intro_style));
        $this->assertTrue(str_contains($item->smartcrop_intro_style, 'object-position: 50% 50%;'));
        $this->assertTrue(str_contains($item->smartcrop_intro_style, 'transform-origin: 50% 50%;'));
        $this->assertTrue(str_contains($item->smartcrop_intro_style, 'width: 125%'));

        // Also attached to item->images (which remains a valid JSON string)
        $this->assertTrue(is_string($item->images));
        $decodedImages = json_decode($item->images);
        $this->assertTrue(isset($decodedImages->intro_style));
        $this->assertSame($item->smartcrop_intro_style, $decodedImages->intro_style);
    }

    private function testOnContentPrepareWithoutCrop(): void
    {
        $plugin = new SmartCrop();

        $item = (object) [
            'id' => 99,
            'title' => 'Standard Image without Crop',
            'images' => json_encode([
                'image_intro' => 'images/photos/nature.jpg',
                'image_fulltext' => '',
            ]),
        ];

        $params = null;
        $plugin->onContentPrepare('com_content.article', $item, $params);

        $this->assertSame('', $item->smartcrop_intro_style);
        $this->assertSame('', $item->smartcrop_fulltext_style);
    }

    private function testOnContentPrepareBothIntroAndFulltext(): void
    {
        $plugin = new SmartCrop();

        $item = (object) [
            'id' => 101,
            'title' => 'Dual Cropped Article',
            'images' => [
                'image_intro' => 'images/intro.jpg#joomlaImage://...?crop=0.2,0.1,0.6,0.4&zoom=1.33',
                'image_fulltext' => 'images/full.jpg#joomlaImage://...?crop=0.0,0.0,1.0,0.75&zoom=1.0',
            ],
        ];

        $params = null;
        $plugin->onContentPrepare('com_content.article', $item, $params);

        $this->assertTrue(!empty($item->smartcrop_intro_style));
        $this->assertTrue(str_contains($item->smartcrop_intro_style, 'object-position: 50% 30%;'));
        $this->assertTrue(str_contains($item->smartcrop_intro_style, 'width: 166.6667%'));

        $this->assertTrue(!empty($item->smartcrop_fulltext_style));
        $this->assertTrue(str_contains($item->smartcrop_fulltext_style, 'object-position: 50% 37.5%;'));
        $this->assertTrue(str_contains($item->smartcrop_fulltext_style, 'height: 133.3333%'));
    }

    private function testOnContentPrepareWithEventObject(): void
    {
        $plugin = new SmartCrop();

        $item = (object) [
            'id' => 102,
            'title' => 'Article Dispatched Via Joomla 5 ContentPrepareEvent',
            'images' => [
                'image_intro' => 'images/intro.jpg#joomlaImage://...?crop=0.1,0.1,0.8,0.6&zoom=1.5',
            ],
        ];

        $event = new \Joomla\CMS\Event\Content\ContentPrepareEvent('com_content.article', $item);
        $plugin->onContentPrepare($event);

        $this->assertTrue(!empty($item->smartcrop_intro_style));
        $this->assertTrue(str_contains($item->smartcrop_intro_style, 'width: 125%'));
    }
}


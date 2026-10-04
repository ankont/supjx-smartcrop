<?php

declare(strict_types=1);

namespace SuperSoftJx\Plugin\Content\SmartCrop\Tests\Integration;

use Joomla\CMS\Event\Model\BeforeSaveEvent;
use Joomla\CMS\Event\Model\BeforeValidateDataEvent;
use Joomla\CMS\Event\Model\PrepareFormEvent;
use Joomla\CMS\Form\Form;
use Joomla\CMS\Form\FormHelper;
use SuperSoftJx\Plugin\Content\SmartCrop\Extension\SmartCrop;

final class FormAndStorageTest
{
    public function runAll(): void
    {
        $this->testFormInjection();
        $this->testBeforeValidateDataConvertsJsonString();
        $this->testBeforeValidateDataMergesIntroAndFulltextProfiles();
        $this->testStorageAsNestedJsonPreservingExistingKeys();
        $this->testSaveAsCopyPreservesMetadata();
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

    private function testFormInjection(): void
    {
        $plugin = new SmartCrop();
        $form = new Form('com_content.article');

        $plugin->onContentPrepareForm($form);

        $this->assertTrue(in_array('SuperSoftJx\\Plugin\\Content\\SmartCrop\\Field', FormHelper::$prefixes, true));
        $this->assertTrue(count($form->loadedFiles) > 0);
        $this->assertTrue(str_contains(end($form->loadedFiles), 'article_smartcrop.xml'));
    }

    private function testBeforeValidateDataConvertsJsonString(): void
    {
        $plugin = new SmartCrop();
        $form = new Form('com_content.article');

        $rawJsonString = json_encode([
            'version'  => 1,
            'profiles' => [
                'default' => [
                    'source' => 'images/sample.jpg',
                    'ratio'  => ['width' => 4, 'height' => 3],
                    'crop'   => ['x' => 0.1, 'y' => 0.2, 'width' => 0.7, 'height' => 0.5]
                ]
            ]
        ]);

        $data = [
            'title'  => 'Test Article',
            'images' => [
                'image_intro' => 'images/sample.jpg',
                'smartcrop'   => $rawJsonString,
            ]
        ];

        $event = new BeforeValidateDataEvent('onContentBeforeValidateData', [
            'subject' => $form,
            'data'    => $data,
        ]);

        $plugin->onContentBeforeValidateData($event);

        $updatedData = $event->getData();
        $this->assertTrue(is_array($updatedData['images']['smartcrop']), 'smartcrop must be converted from string to array');
        $this->assertSame('images/sample.jpg', $updatedData['images']['smartcrop']['profiles']['default']['source']);
    }

    private function testBeforeValidateDataMergesIntroAndFulltextProfiles(): void
    {
        $plugin = new SmartCrop();
        $form = new Form('com_content.article');

        $introPayload = json_encode([
            'source' => 'images/intro.jpg',
            'ratio'  => ['width' => 4, 'height' => 3],
            'crop'   => ['x' => 0.1, 'y' => 0.1, 'width' => 0.8, 'height' => 0.6]
        ]);

        $fullPayload = json_encode([
            'source' => 'images/full.jpg',
            'ratio'  => ['width' => 4, 'height' => 3],
            'crop'   => ['x' => 0.05, 'y' => 0.05, 'width' => 0.9, 'height' => 0.675]
        ]);

        $data = [
            'title'  => 'Dual Crop Article',
            'images' => [
                'image_intro'         => 'images/intro.jpg',
                'image_fulltext'      => 'images/full.jpg',
                'smartcrop_intro'     => $introPayload,
                'smartcrop_fulltext'  => $fullPayload,
            ]
        ];

        $event = new BeforeValidateDataEvent('onContentBeforeValidateData', [
            'subject' => $form,
            'data'    => $data,
        ]);

        $plugin->onContentBeforeValidateData($event);

        $updatedData = $event->getData();
        $this->assertTrue(is_array($updatedData['images']['smartcrop']));
        $profiles = $updatedData['images']['smartcrop']['profiles'];

        $this->assertTrue(isset($profiles['intro']), 'intro profile must be present');
        $this->assertTrue(isset($profiles['fulltext']), 'fulltext profile must be present');
        $this->assertTrue(isset($profiles['default']), 'default profile must be present and match intro');
        $this->assertSame('images/intro.jpg', $profiles['intro']['source']);
        $this->assertSame('images/full.jpg', $profiles['fulltext']['source']);
        $this->assertSame('images/intro.jpg', $profiles['default']['source']);

        // Form temporary fields must be unset
        $this->assertTrue(!isset($updatedData['images']['smartcrop_intro']));
        $this->assertTrue(!isset($updatedData['images']['smartcrop_fulltext']));
    }

    private function testStorageAsNestedJsonPreservingExistingKeys(): void
    {
        $plugin = new SmartCrop();

        $table = new \stdClass();
        $table->images = json_encode([
            'image_intro'          => 'images/sample.jpg',
            'image_intro_alt'      => 'Alt Text',
            'float_intro'          => 'float-start',
            'image_fulltext'       => 'images/full.jpg',
            'smartcrop' => [
                'version' => 1,
                'profiles' => [
                    'default' => [
                        'source' => 'images/sample.jpg#joomlaImage://...',
                        'ratio'  => ['width' => 4, 'height' => 3],
                        'crop'   => ['x' => 0.15, 'y' => 0.1, 'width' => 0.7, 'height' => 0.525],
                    ]
                ]
            ]
        ]);

        $event = new BeforeSaveEvent('com_content.article', $table, false);
        $plugin->onContentBeforeSave($event);

        // Verify stored images string
        $decoded = json_decode($table->images, true);
        $this->assertTrue(is_array($decoded));

        // Existing keys must be completely preserved
        $this->assertSame('images/sample.jpg', $decoded['image_intro']);
        $this->assertSame('Alt Text', $decoded['image_intro_alt']);
        $this->assertSame('float-start', $decoded['float_intro']);
        $this->assertSame('images/full.jpg', $decoded['image_fulltext']);

        // smartcrop must be a true nested object/array
        $this->assertTrue(is_array($decoded['smartcrop']));
        $this->assertSame(1, $decoded['smartcrop']['version']);
        $this->assertSame('images/sample.jpg', $decoded['smartcrop']['profiles']['default']['source']);
        $this->assertSame(0.15, $decoded['smartcrop']['profiles']['default']['crop']['x']);

        // Verify it is NOT an escaped string like "{\"version\":1...}"
        $this->assertTrue(!is_string($decoded['smartcrop']));
    }

    private function testSaveAsCopyPreservesMetadata(): void
    {
        $plugin = new SmartCrop();

        // Save as Copy creates a new table row with isNew = true
        $table = new \stdClass();
        $table->id = 0;
        $table->images = json_encode([
            'image_intro' => 'images/sample.jpg',
            'smartcrop'   => [
                'version' => 1,
                'profiles' => [
                    'default' => [
                        'source' => 'images/sample.jpg',
                        'ratio'  => ['width' => 4, 'height' => 3],
                        'crop'   => ['x' => 0.2, 'y' => 0.2, 'width' => 0.6, 'height' => 0.45],
                    ]
                ]
            ]
        ]);

        $event = new BeforeSaveEvent('com_content.article', $table, true);
        $plugin->onContentBeforeSave($event);

        $decoded = json_decode($table->images, true);
        $this->assertTrue(is_array($decoded));
        $this->assertSame(0.2, $decoded['smartcrop']['profiles']['default']['crop']['x']);
    }
}

<?php

declare(strict_types=1);

namespace SuperSoftJx\Plugin\Content\SmartCrop\Tests\Unit;

use Joomla\CMS\Factory;
use SuperSoftJx\Plugin\Content\SmartCrop\Service\VisualResolver;

final class VisualResolverTest
{
    public function runAll(): void
    {
        $this->testIntroPrecedenceOverFulltext();
        $this->testFulltextFallbackWhenIntroEmpty();
        $this->testEmptyWhenNoImages();
        $this->testSmartVisualsDecoration();
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

    private function testIntroPrecedenceOverFulltext(): void
    {
        $article = [
            'id' => 10,
            'images' => [
                'image_intro'    => 'images/intro.jpg#joomlaImage://...',
                'image_fulltext' => 'images/full.jpg',
            ]
        ];

        $resolved = VisualResolver::resolve($article);
        $this->assertSame('images/intro.jpg', $resolved);
    }

    private function testFulltextFallbackWhenIntroEmpty(): void
    {
        $article = [
            'id' => 10,
            'images' => [
                'image_intro'    => '',
                'image_fulltext' => 'images/full.jpg',
            ]
        ];

        $resolved = VisualResolver::resolve($article);
        $this->assertSame('images/full.jpg', $resolved);
    }

    private function testEmptyWhenNoImages(): void
    {
        $article = [
            'id' => 10,
            'images' => [
                'image_intro'    => '',
                'image_fulltext' => '',
            ]
        ];

        $resolved = VisualResolver::resolve($article);
        $this->assertSame('', $resolved);
    }

    private function testSmartVisualsDecoration(): void
    {
        // Mock a SmartVisuals provider registering on onSmartVisualsDecorateResources
        $app = Factory::getApplication();
        $dispatcher = $app->getDispatcher();

        $dispatcher->listeners['onSmartVisualsDecorateResources'] = [
            function ($event) {
                $resources = $event->getArgument('resources');
                $decorations = $event->getArgument('decorations');
                foreach ($resources as $res) {
                    if ($res['id'] === 'article:42') {
                        $decorations['article:42'] = [
                            'image' => 'images/smartvisuals-fallback.jpg'
                        ];
                    }
                }
                $event->setArgument('decorations', $decorations);
            }
        ];

        // Article 42 has no native images
        $article = [
            'id' => 42,
            'images' => '{}'
        ];

        $resolved = VisualResolver::resolve($article);
        $this->assertSame('images/smartvisuals-fallback.jpg', $resolved);

        // Clean up mock listener
        unset($dispatcher->listeners['onSmartVisualsDecorateResources']);
    }
}

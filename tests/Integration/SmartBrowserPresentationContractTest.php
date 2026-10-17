<?php

declare(strict_types=1);

namespace SuperSoft\Plugin\Content\SmartCrop\Tests\Integration;

use SuperSoft\Plugin\Content\SmartCrop\Extension\SmartCrop;
use SuperSoft\Plugin\Content\SmartCrop\Helper\SmartCropHelper;

final class SmartBrowserPresentationContractTest
{
    public function runAll(): void
    {
        $this->testSubscribedEventRegistration();
        $this->testPhpProviderAppliesCropAndAspectRatio();
        $this->testPhpProviderPreservesUnrelatedInlineStylesAndOuterDom();
        $this->testPhpProviderSkipsStaleCropOnImageOrThumbnailOverrideChange();
        $this->testPhpProviderAppliesThumbnailOverrideOwnCrop();
        $this->testPhpProviderBackwardCompatibilityWithAllStoredPayloads();
        $this->testPhpProviderRespectsExplicitResetCleanup();
        $this->testJsPresentationProviderContractInNode();
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
            throw new \RuntimeException('Assertion failed: expected true. ' . $message);
        }
    }

    private function assertFalse(bool $condition, string $message = ''): void
    {
        if ($condition) {
            throw new \RuntimeException('Assertion failed: expected false. ' . $message);
        }
    }

    /**
     * Helper to build a realistic SmartBrowser visual DOM structure with frame, link, pin/badge, and primary image.
     *
     * @param   string  $src
     * @param   string  $style
     * @return  array{doc: \DOMDocument, frame: \DOMElement, link: \DOMElement, badge: \DOMElement, img: \DOMElement}
     */
    private function createVisualDom(string $src = '/images/sample.jpg', string $style = ''): array
    {
        $doc = new \DOMDocument('1.0', 'UTF-8');
        $frame = $doc->createElement('div');
        $frame->setAttribute('class', 'sb-visual-frame custom-frame');
        $frame->setAttribute('style', 'border: 2px solid red;');

        $link = $doc->createElement('a');
        $link->setAttribute('href', '/article-link');
        $link->setAttribute('class', 'sb-visual-link');

        $img = $doc->createElement('img');
        $img->setAttribute('src', $src);
        $img->setAttribute('alt', 'Sample');
        $img->setAttribute('data-sb-primary-image', '1');
        if ($style !== '') {
            $img->setAttribute('style', $style);
        }

        $badge = $doc->createElement('span');
        $badge->setAttribute('class', 'sb-visual-pin badge');
        $badge->textContent = 'PIN';

        $link->appendChild($img);
        $frame->appendChild($link);
        $frame->appendChild($badge);
        $doc->appendChild($frame);

        return [
            'doc'   => $doc,
            'frame' => $frame,
            'link'  => $link,
            'badge' => $badge,
            'img'   => $img,
        ];
    }

    private function createPresentationEvent(\DOMElement $img, array $context): object
    {
        return new class ($img, $context) {
            public function __construct(
                private \DOMElement $imageElement,
                private array $context
            ) {
            }

            public function getArgument(string $name, mixed $default = null): mixed
            {
                return match ($name) {
                    'imageElement' => $this->imageElement,
                    'context'      => $this->context,
                    default        => $default,
                };
            }
        };
    }

    private function testSubscribedEventRegistration(): void
    {
        $events = SmartCrop::getSubscribedEvents();
        $this->assertTrue(isset($events['onSmartBrowserPrepareImagePresentation']), 'Must subscribe to onSmartBrowserPrepareImagePresentation');
        $this->assertSame('onSmartBrowserPrepareImagePresentation', $events['onSmartBrowserPrepareImagePresentation']);
    }

    /**
     * Requirement 1: Application of crop and aspect-ratio in PHP via onSmartBrowserPrepareImagePresentation.
     */
    private function testPhpProviderAppliesCropAndAspectRatio(): void
    {
        $plugin = new SmartCrop();
        $dom = $this->createVisualDom('/images/banners/hero.jpg');
        $img = $dom['img'];

        $context = [
            'resource' => [
                'id'    => 'article:42',
                'type'  => 'article',
                'image' => 'images/banners/hero.jpg',
            ],
            'usage' => [
                'ext.smartcrop.crop' => [
                    'source' => 'images/banners/hero.jpg',
                    'crop'   => ['x' => 0.1, 'y' => 0.2, 'width' => 0.5, 'height' => 0.4],
                    'ratio'  => ['width' => 16, 'height' => 9],
                    'zoom'   => 1.5,
                ],
            ],
            'imageUrl'   => '/images/banners/hero.jpg',
            'purpose'    => 'output',
            'isReadOnly' => true,
        ];

        $event = $this->createPresentationEvent($img, $context);
        $plugin->onSmartBrowserPrepareImagePresentation($event);

        $style = $img->getAttribute('style');
        $this->assertTrue(str_contains($style, 'aspect-ratio: 16 / 9'), 'Must apply aspect-ratio: 16 / 9');
        $this->assertTrue(str_contains($style, 'position: absolute'), 'Must apply position: absolute');
        $this->assertTrue(str_contains($style, 'left: -20%'), 'Must apply left: -20%');
        $this->assertTrue(str_contains($style, 'top: -50%'), 'Must apply top: -50%');
        $this->assertTrue(str_contains($style, 'width: 200%'), 'Must apply width: 200%');
        $this->assertTrue(str_contains($style, 'height: 250%'), 'Must apply height: 250%');
        $this->assertTrue(str_contains($style, 'max-width: none'), 'Must apply max-width: none');
        $this->assertTrue(str_contains($style, 'max-height: none'), 'Must apply max-height: none');
        $this->assertTrue(str_contains($style, 'object-fit: fill'), 'Must apply object-fit: fill');
        $this->assertTrue(str_contains($style, 'pointer-events: none'), 'Must apply pointer-events: none');
    }

    /**
     * Requirement 2 & 8: Preserves unrelated inline styles on $image and never alters outer frames, pins/badges, or links.
     */
    private function testPhpProviderPreservesUnrelatedInlineStylesAndOuterDom(): void
    {
        $plugin = new SmartCrop();
        $dom = $this->createVisualDom(
            '/images/sample.jpg',
            'filter: grayscale(80%); opacity: 0.92; width: 100%; border-radius: 6px;'
        );
        $img   = $dom['img'];
        $frame = $dom['frame'];
        $link  = $dom['link'];
        $badge = $dom['badge'];

        $context = [
            'imageUrl' => '/images/sample.jpg',
            'usage'    => [
                'ext.smartcrop.crop' => [
                    'source' => 'images/sample.jpg',
                    'crop'   => ['x' => 0.25, 'y' => 0.25, 'width' => 0.5, 'height' => 0.5],
                    'ratio'  => ['width' => 1, 'height' => 1],
                ],
            ],
        ];

        $plugin->onSmartBrowserPrepareImagePresentation($this->createPresentationEvent($img, $context));

        $style = $img->getAttribute('style');
        $this->assertTrue(str_contains($style, 'filter: grayscale(80%)'), 'Must preserve unrelated filter inline style');
        $this->assertTrue(str_contains($style, 'opacity: 0.92'), 'Must preserve unrelated opacity inline style');
        $this->assertTrue(str_contains($style, 'border-radius: 6px'), 'Must preserve unrelated border-radius inline style');
        $this->assertTrue(str_contains($style, 'aspect-ratio: 1 / 1'), 'Must apply aspect-ratio: 1 / 1');
        $this->assertTrue(str_contains($style, 'width: 200%'), 'Managed width must override old width: 100%');
        $this->assertFalse(str_contains($style, 'width: 100%'), 'Old width: 100% must not be duplicated');

        // Verify outer frame, link, and badge were not altered
        $this->assertSame('sb-visual-frame custom-frame', $frame->getAttribute('class'));
        $this->assertSame('border: 2px solid red;', $frame->getAttribute('style'));
        $this->assertSame('/article-link', $link->getAttribute('href'));
        $this->assertSame('sb-visual-pin badge', $badge->getAttribute('class'));
        $this->assertSame('PIN', $badge->textContent);
        $this->assertTrue($img->parentNode === $link, 'Image must remain inside its original link parent');
    }

    /**
     * Requirement 3: Image change or thumbnailOverride change prevents stale crop from applying.
     */
    private function testPhpProviderSkipsStaleCropOnImageOrThumbnailOverrideChange(): void
    {
        $plugin = new SmartCrop();

        // Case A: Article Intro Image changed from old.jpg to new.jpg, stale ext.smartcrop.crop still references old.jpg
        $domA = $this->createVisualDom('/images/new.jpg', 'opacity: 0.85;');
        $contextA = [
            'resource' => [
                'id'    => 'article:10',
                'image' => 'images/new.jpg',
            ],
            'imageUrl' => '/images/new.jpg',
            'usage'    => [
                'ext.smartcrop.crop' => [
                    'source' => 'images/old.jpg',
                    'crop'   => ['x' => 0.1, 'y' => 0.1, 'width' => 0.5, 'height' => 0.5],
                    'ratio'  => ['width' => 16, 'height' => 9],
                ],
            ],
        ];
        $plugin->onSmartBrowserPrepareImagePresentation($this->createPresentationEvent($domA['img'], $contextA));
        $this->assertSame('opacity: 0.85;', $domA['img']->getAttribute('style'), 'Stale crop for old.jpg must not apply to new.jpg');

        // Case B: Article has indigenous crop on images/article-intro.jpg, but visual.thumbnailOverride points to uncropped images/override.jpg
        $domB = $this->createVisualDom('/images/override.jpg');
        $contextB = [
            'resource' => [
                'id'        => 'article:11',
                'image'     => 'images/article-intro.jpg#joomlaImage://local-images/article-intro.jpg?crop=0.1,0.1,0.5,0.5&ratio=16:9',
                'imageCrop' => [
                    'crop'  => ['x' => 0.1, 'y' => 0.1, 'width' => 0.5, 'height' => 0.5],
                    'ratio' => ['width' => 16, 'height' => 9],
                ],
            ],
            'usage' => [
                'visual.thumbnailOverride' => 'file:com_media/0:images/override.jpg',
            ],
            'resolvedImage' => [
                'id'    => 'images/override.jpg',
                'type'  => 'image',
                'image' => 'images/override.jpg',
            ],
            'imageAddress' => 'file:com_media/0:images/override.jpg',
            'imageUrl'     => '/images/override.jpg',
        ];
        $plugin->onSmartBrowserPrepareImagePresentation($this->createPresentationEvent($domB['img'], $contextB));
        $this->assertSame('', $domB['img']->getAttribute('style'), 'Indigenous article crop must not leak onto uncropped thumbnailOverride');
    }

    /**
     * Requirement 4: thumbnailOverride carrying its own crop applies accurately.
     */
    private function testPhpProviderAppliesThumbnailOverrideOwnCrop(): void
    {
        $plugin = new SmartCrop();

        // Case A: thumbnailOverride has crop via compound address (crop=c&c.coords=...) even when resource had a different indigenous crop
        $domA = $this->createVisualDom('/images/override.jpg');
        $contextA = [
            'resource' => [
                'id'        => 'article:20',
                'image'     => 'images/indigenous.jpg',
                'imageCrop' => [
                    'source' => 'images/indigenous.jpg',
                    'crop'   => ['x' => 0.0, 'y' => 0.0, 'width' => 0.8, 'height' => 0.8],
                    'ratio'  => ['width' => 1, 'height' => 1],
                ],
            ],
            'usage' => [
                'visual.thumbnailOverride' => 'file:com_media/0:images/override.jpg',
                'ext.selectionAddress'     => [
                    'compounds' => [
                        'visual.thumbnailOverride' => 'file:com_media/0:images/override.jpg?crop=c&c.coords=0.2,0.1,0.5,0.5&c.ratio=16:9&c.zoom=1.4',
                    ],
                ],
            ],
            'imageAddress' => 'file:com_media/0:images/override.jpg?crop=c&c.coords=0.2,0.1,0.5,0.5&c.ratio=16:9&c.zoom=1.4',
            'imageUrl'     => '/images/override.jpg',
        ];
        $plugin->onSmartBrowserPrepareImagePresentation($this->createPresentationEvent($domA['img'], $contextA));
        $styleA = $domA['img']->getAttribute('style');
        $this->assertTrue(str_contains($styleA, 'aspect-ratio: 16 / 9'), 'Must apply override crop aspect-ratio 16 / 9');
        $this->assertTrue(str_contains($styleA, 'left: -40%'), 'Must apply override crop left: -40%');
        $this->assertTrue(str_contains($styleA, 'top: -20%'), 'Must apply override crop top: -20%');
        $this->assertTrue(str_contains($styleA, 'width: 200%'), 'Must apply override crop width: 200%');

        // Case B: thumbnailOverride has crop in resolvedImage.imageCrop
        $domB = $this->createVisualDom('/images/override2.jpg');
        $contextB = [
            'resource' => [
                'id'    => 'article:21',
                'image' => 'images/indigenous.jpg',
            ],
            'usage' => [
                'visual.thumbnailOverride' => 'file:com_media/0:images/override2.jpg',
            ],
            'resolvedImage' => [
                'id'        => 'images/override2.jpg',
                'type'      => 'image',
                'image'     => 'images/override2.jpg',
                'imageCrop' => [
                    'crop'  => ['x' => 0.1, 'y' => 0.1, 'width' => 0.4, 'height' => 0.5],
                    'ratio' => ['width' => 4, 'height' => 3],
                ],
            ],
            'imageUrl' => '/images/override2.jpg',
        ];
        $plugin->onSmartBrowserPrepareImagePresentation($this->createPresentationEvent($domB['img'], $contextB));
        $styleB = $domB['img']->getAttribute('style');
        $this->assertTrue(str_contains($styleB, 'aspect-ratio: 4 / 3'), 'Must apply resolvedImage.imageCrop aspect-ratio');
        $this->assertTrue(str_contains($styleB, 'width: 250%'), 'Must apply resolvedImage.imageCrop width: 250%');
    }

    /**
     * Requirement 5: Compatibility with all existing stored payloads (#joomlaImage://, smartcrop=sc, crop=c, legacy article images JSON).
     */
    private function testPhpProviderBackwardCompatibilityWithAllStoredPayloads(): void
    {
        $plugin = new SmartCrop();

        // 1. Native Joomla #joomlaImage:// URI with crop query parameters
        $dom1 = $this->createVisualDom('/images/headers/blue-flower.jpg');
        $context1 = [
            'resource' => [
                'id'    => 'images/headers/blue-flower.jpg#joomlaImage://local-images/headers/blue-flower.jpg?width=700&height=180&crop=0.25,0.2,0.5,0.5&ratio=16:9&zoom=1.3',
                'type'  => 'image',
                'image' => 'images/headers/blue-flower.jpg#joomlaImage://local-images/headers/blue-flower.jpg?width=700&height=180&crop=0.25,0.2,0.5,0.5&ratio=16:9&zoom=1.3',
            ],
            'imageUrl' => '/images/headers/blue-flower.jpg',
        ];
        $plugin->onSmartBrowserPrepareImagePresentation($this->createPresentationEvent($dom1['img'], $context1));
        $this->assertTrue(str_contains($dom1['img']->getAttribute('style'), 'aspect-ratio: 16 / 9'), 'Must support #joomlaImage:// URI crop');
        $this->assertTrue(str_contains($dom1['img']->getAttribute('style'), 'left: -50%'), 'Must compute left: -50% from #joomlaImage:// URI');

        // 2. Selection Address with smartcrop=sc codec
        $dom2 = $this->createVisualDom('/images/sample.jpg');
        $context2 = [
            'selection' => [
                'address' => 'article:com_content/0:42?smartcrop=sc&sc.coords=0.1000,0.2000,0.5000,0.5000&sc.ratio=3:2&sc.zoom=1.20&sc.src=images%2Fsample.jpg',
            ],
            'imageUrl' => '/images/sample.jpg',
        ];
        $plugin->onSmartBrowserPrepareImagePresentation($this->createPresentationEvent($dom2['img'], $context2));
        $this->assertTrue(str_contains($dom2['img']->getAttribute('style'), 'aspect-ratio: 3 / 2'), 'Must support smartcrop=sc selection address codec');

        // 3. Legacy Article images JSON with smartcrop.profiles.default
        $dom3 = $this->createVisualDom('/images/legacy-intro.jpg');
        $context3 = [
            'resource' => [
                'id'     => 77,
                'type'   => 'article',
                'images' => json_encode([
                    'image_intro' => 'images/legacy-intro.jpg',
                    'smartcrop'   => [
                        'version'  => 1,
                        'profiles' => [
                            'default' => [
                                'source' => 'images/legacy-intro.jpg',
                                'crop'   => ['x' => 0.0, 'y' => 0.1, 'width' => 0.8, 'height' => 0.8],
                                'ratio'  => ['width' => 4, 'height' => 3],
                            ],
                        ],
                    ],
                ]),
            ],
            'imageUrl' => '/images/legacy-intro.jpg',
        ];
        $plugin->onSmartBrowserPrepareImagePresentation($this->createPresentationEvent($dom3['img'], $context3));
        $this->assertTrue(str_contains($dom3['img']->getAttribute('style'), 'aspect-ratio: 4 / 3'), 'Must support legacy article images.smartcrop.profiles.default');
        $this->assertTrue(str_contains($dom3['img']->getAttribute('style'), 'width: 125%'), 'Must compute width: 125% from legacy article profile');

        // 4. New unescaped URI format (crop=x-y-w-h&ratio=WxH) including negative zoom-out coordinates
        $dom4 = $this->createVisualDom('/images/headers/walden-pond.jpg');
        $context4 = [
            'resource' => [
                'id'    => 'images/headers/walden-pond.jpg#joomlaImage://local-images/headers/walden-pond.jpg?width=700&height=200&crop=-0.1000--0.2000-1.2500-1.2500&ratio=16x9&zoom=0.80',
                'type'  => 'image',
                'image' => 'images/headers/walden-pond.jpg#joomlaImage://local-images/headers/walden-pond.jpg?width=700&height=200&crop=-0.1000--0.2000-1.2500-1.2500&ratio=16x9&zoom=0.80',
            ],
            'imageUrl' => '/images/headers/walden-pond.jpg',
        ];
        $plugin->onSmartBrowserPrepareImagePresentation($this->createPresentationEvent($dom4['img'], $context4));
        $this->assertTrue(str_contains($dom4['img']->getAttribute('style'), 'aspect-ratio: 16 / 9'), 'Must support unescaped ratio=16x9');
        $this->assertTrue(str_contains($dom4['img']->getAttribute('style'), 'width: 80%'), 'Must support dash-separated negative zoom-out coordinates');

        // 5. New unescaped Selection Address codec format (sc.coords=x-y-w-h&sc.ratio=WxH)
        $dom5 = $this->createVisualDom('/images/sample.jpg');
        $context5 = [
            'selection' => [
                'address' => 'article:com_content/0:42?smartcrop=sc&sc.coords=0.1000-0.2000-0.5000-0.5000&sc.ratio=16x9&sc.zoom=1.20&sc.src=images/sample.jpg',
            ],
            'imageUrl' => '/images/sample.jpg',
        ];
        $plugin->onSmartBrowserPrepareImagePresentation($this->createPresentationEvent($dom5['img'], $context5));
        $this->assertTrue(str_contains($dom5['img']->getAttribute('style'), 'aspect-ratio: 16 / 9'), 'Must support unescaped sc.coords=x-y-w-h&sc.ratio=16x9');
    }

    /**
     * Requirement 6 (PHP side): Explicit reset (ext.smartcrop.crop = null) prevents fallback to resource.imageCrop.
     */
    private function testPhpProviderRespectsExplicitResetCleanup(): void
    {
        $plugin = new SmartCrop();
        $dom = $this->createVisualDom('/images/sample.jpg');
        $context = [
            'resource' => [
                'id'        => 'article:50',
                'image'     => 'images/sample.jpg',
                'imageCrop' => [
                    'source' => 'images/sample.jpg',
                    'crop'   => ['x' => 0.1, 'y' => 0.1, 'width' => 0.5, 'height' => 0.5],
                    'ratio'  => ['width' => 16, 'height' => 9],
                ],
            ],
            'usage' => [
                'ext.smartcrop.crop' => null,
            ],
            'imageUrl' => '/images/sample.jpg',
        ];
        $plugin->onSmartBrowserPrepareImagePresentation($this->createPresentationEvent($dom['img'], $context));
        $this->assertSame('', $dom['img']->getAttribute('style'), 'Explicit null ext.smartcrop.crop must suppress indigenous resource.imageCrop');
    }

    /**
     * Requirements 2, 3, 4, 5, 6, 7, 8 (JavaScript side):
     * Executes smartcrop-editor.js in Node with a mock DOM and SmartBrowserPicker registry.
     */
    private function testJsPresentationProviderContractInNode(): void
    {
        $jsFile = dirname(__DIR__, 2) . '/plugin/media/js/smartcrop-editor.js';
        $this->assertTrue(is_file($jsFile), 'smartcrop-editor.js must exist');

        $nodeCheck = @shell_exec('node -v 2>&1');
        if (!is_string($nodeCheck) || !str_starts_with(trim($nodeCheck), 'v')) {
            return;
        }

        $runnerScript = <<<'JS'
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

function createMockElement(tagName = 'IMG', initialAttrs = {}) {
    const attrs = { ...initialAttrs };
    const styleMap = new Map();
    if (attrs.style) {
        attrs.style.split(';').forEach(chunk => {
            const idx = chunk.indexOf(':');
            if (idx !== -1) {
                const k = chunk.slice(0, idx).trim().toLowerCase();
                const v = chunk.slice(idx + 1).trim();
                if (k && v) styleMap.set(k, v);
            }
        });
    }
    const style = {
        setProperty(prop, val) {
            styleMap.set(String(prop).toLowerCase(), String(val));
        },
        getPropertyValue(prop) {
            return styleMap.get(String(prop).toLowerCase()) || '';
        },
        removeProperty(prop) {
            styleMap.delete(String(prop).toLowerCase());
        },
        _dump() {
            return Object.fromEntries(styleMap.entries());
        }
    };
    return {
        tagName: tagName.toUpperCase(),
        style,
        dataset: {},
        classList: { add() {}, remove() {}, contains() { return false; } },
        get src() { return attrs.src || ''; },
        set src(v) { attrs.src = v; },
        getAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null; },
        setAttribute(name, val) { attrs[name] = String(val); },
        removeAttribute(name) { delete attrs[name]; },
        hasAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs, name); },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        closest() { return null; },
        appendChild() {},
        addEventListener() {},
        getBoundingClientRect() { return { left: 0, top: 0, width: 200, height: 150 }; }
    };
}

let registeredPresentation = null;
let registeredOverlay = null;
let registeredCodec = null;
let registeredProperty = null;

const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    URL,
    Math,
    Number,
    String,
    Object,
    Array,
    JSON,
    Map,
    Set,
    WeakMap,
    Promise,
    encodeURIComponent,
    decodeURIComponent,
    parseFloat,
    parseInt,
    isNaN,
    requestAnimationFrame: (cb) => cb(),
};

sandbox.document = {
    readyState: 'complete',
    head: { appendChild() {} },
    body: { appendChild() {}, classList: { add() {}, remove() {} } },
    documentElement: { appendChild() {} },
    createElement: (tag) => createMockElement(tag),
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    addEventListener: () => {},
};

sandbox.window = sandbox;
sandbox.window.location = {
    origin: 'http://localhost',
    hostname: 'localhost',
    pathname: '/administrator/index.php',
};
sandbox.window.getComputedStyle = () => ({
    paddingTop: '0', paddingBottom: '0', paddingLeft: '0', paddingRight: '0',
    height: '150px', width: '200px', boxSizing: 'border-box'
});
sandbox.window.SmartBrowser = {
    SelectionAddress: {
        registerCodec(name, codec) { registeredCodec = { name, codec }; },
        registerProperty(prop) { registeredProperty = prop; }
    }
};
sandbox.window.SmartBrowserPicker = {
    registerImagePresentation(provider) { registeredPresentation = provider; },
    registerVisualOverlay(overlay) { registeredOverlay = overlay; }
};

const code = fs.readFileSync(process.argv[2], 'utf8');
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

assert(registeredPresentation, 'registerImagePresentation must be called');
assert.strictEqual(registeredPresentation.id, 'smartcrop.presentation');
assert(Array.isArray(registeredPresentation.styles), 'Provider must declare styles array');
assert(registeredPresentation.styles.includes('aspect-ratio'), 'Declared styles must include aspect-ratio');
assert(registeredOverlay, 'registerVisualOverlay must be called');
assert(registeredCodec && registeredCodec.name === 'smartcrop', 'SelectionAddress codec smartcrop must be registered');
assert(registeredProperty && registeredProperty.key === 'ext.smartcrop.crop', 'SelectionAddress property ext.smartcrop.crop must be registered');

// Test 2 & 8: JS apply() sets aspect-ratio & crop styles on imageElement, preserves unrelated inline styles, and calls notifyPresentationChange
{
    const img = createMockElement('IMG', {
        src: '/images/banners/hero.jpg',
        style: 'filter: sepia(0.4); opacity: 0.95;'
    });
    let notified = null;
    const ctx = {
        resource: { id: 'article:42', type: 'article', image: 'images/banners/hero.jpg' },
        imageUrl: '/images/banners/hero.jpg',
        getImageElement: () => img,
        getMetadata: (k) => k === 'smartcrop.crop' ? {
            source: 'images/banners/hero.jpg',
            crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.4 },
            ratio: { width: 16, height: 9 },
            zoom: 1.5
        } : null,
        notifyPresentationChange: (payload) => { notified = payload; }
    };

    assert.strictEqual(registeredPresentation.applies(ctx), true, 'applies() must return true for matching crop');
    assert.strictEqual(registeredPresentation.hasChanges(ctx), true, 'hasChanges() must return true for matching crop');

    registeredPresentation.apply(img, ctx);
    assert.strictEqual(img.style.getPropertyValue('aspect-ratio'), '16 / 9', 'JS apply must set aspect-ratio');
    assert.strictEqual(img.style.getPropertyValue('position'), 'absolute');
    assert.strictEqual(img.style.getPropertyValue('left'), '-20.0000%');
    assert.strictEqual(img.style.getPropertyValue('top'), '-50.0000%');
    assert.strictEqual(img.style.getPropertyValue('width'), '200.0000%');
    assert.strictEqual(img.style.getPropertyValue('height'), '250.0000%');
    assert.strictEqual(img.style.getPropertyValue('filter'), 'sepia(0.4)', 'Must preserve unrelated filter style');
    assert.strictEqual(img.style.getPropertyValue('opacity'), '0.95', 'Must preserve unrelated opacity style');
    assert(notified && notified.reason === 'aspect-ratio', 'Must call notifyPresentationChange');
}

// Test 3: JS skips stale crop when image or thumbnailOverride changes
{
    const img = createMockElement('IMG', { src: '/images/override.jpg' });
    const ctx = {
        resource: {
            id: 'article:42',
            type: 'article',
            image: 'images/original.jpg',
            thumbnail: '/images/original.jpg',
            imageCrop: {
                crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
                ratio: { width: 16, height: 9 }
            }
        },
        getValues: () => ({
            'visual.thumbnailOverride': 'file:com_media/0:images/override.jpg',
            'ext.smartcrop.crop': {
                source: 'images/original.jpg',
                crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
                ratio: { width: 16, height: 9 }
            }
        }),
        getImageElement: () => img
    };
    assert.strictEqual(registeredPresentation.applies(ctx), false, 'JS applies() must return false when thumbnailOverride changed to different image');
}

// Test 4: JS applies thumbnailOverride's own crop (via compound address or resolvedImage)
{
    const img = createMockElement('IMG', { src: '/images/override.jpg' });
    const ctx = {
        resource: {
            id: 'article:42',
            type: 'article',
            image: 'images/original.jpg',
            thumbnail: '/images/original.jpg'
        },
        getValues: () => ({
            'visual.thumbnailOverride': 'file:com_media/0:images/override.jpg',
            'ext.selectionAddress': {
                compounds: {
                    'visual.thumbnailOverride': 'file:com_media/0:images/override.jpg?crop=c&c.coords=0.25,0.25,0.5,0.5&c.ratio=1:1'
                }
            }
        }),
        getImageElement: () => img
    };
    assert.strictEqual(registeredPresentation.applies(ctx), true, 'JS applies() must recognize thumbnailOverride compound crop');
    registeredPresentation.apply(img, ctx);
    assert.strictEqual(img.style.getPropertyValue('aspect-ratio'), '1 / 1');
    assert.strictEqual(img.style.getPropertyValue('left'), '-50.0000%');
    assert.strictEqual(img.style.getPropertyValue('width'), '200.0000%');
}

// Test 5: JS supports SelectionAddress smartcrop=sc codec in getAddress() (both legacy and new unescaped format)
{
    const img = createMockElement('IMG', { src: '/images/sample.jpg' });
    const ctx = {
        resource: { id: 'article:55', type: 'article', image: 'images/sample.jpg' },
        getAddress: () => 'article:com_content/0:55?smartcrop=sc&sc.coords=0.1-0.2-0.5-0.5&sc.ratio=3x2&sc.src=images/sample.jpg',
        getImageElement: () => img
    };
    assert.strictEqual(registeredPresentation.applies(ctx), true, 'JS applies() must support unescaped smartcrop=sc address');
    registeredPresentation.apply(img, ctx);
    assert.strictEqual(img.style.getPropertyValue('aspect-ratio'), '3 / 2');

    // Verify URI encoder produces unescaped - and x format
    const generatedUri = sandbox.window.SmartCropManager.appendCropToJoomlaUri(
        'images/headers/walden-pond.jpg#joomlaImage://local-images/headers/walden-pond.jpg?width=700&height=200',
        0.1, 0.2, 0.5, 0.5, 1.25, 16, 9
    );
    assert(generatedUri.includes('crop=0.1-0.2-0.5-0.5'), 'Generated URI must use - separator for coordinates');
    assert(generatedUri.includes('ratio=16x9'), 'Generated URI must use x separator for ratio');
    assert(!generatedUri.split('?')[1].includes(','), 'Generated URI query string must not contain commas');
    assert(!generatedUri.split('?')[1].includes(':'), 'Generated URI query string must not contain colons');

    // Verify SelectionAddress codec encode/decode uses - and x and supports negative zoom-out coords
    const encodedParts = registeredCodec.codec.encode({
        source: 'images/sample.jpg',
        crop: { x: -0.1, y: -0.2, width: 1.25, height: 1.25 },
        ratio: { width: 16, height: 9 },
        zoom: 0.8
    });
    const encodedMap = Object.fromEntries(encodedParts);
    assert.strictEqual(encodedMap.coords, '-0.1000--0.2000-1.2500-1.2500', 'Codec must encode coordinates with - separator');
    assert.strictEqual(encodedMap.ratio, '16x9', 'Codec must encode ratio with x separator');
    const decoded = registeredCodec.codec.decode(encodedParts);
    assert.strictEqual(decoded.value.crop.x, -0.1);
    assert.strictEqual(decoded.value.crop.y, -0.2);
    assert.strictEqual(decoded.value.crop.width, 1.25);
    assert.strictEqual(decoded.value.ratio.width, 16);
    assert.strictEqual(decoded.value.ratio.height, 9);
}

// Test 6 & 7: Server-rendered presentation (data-sb-image-presentation="server") is skipped until local reset/change
(async () => {
    const img = createMockElement('IMG', {
        src: '/images/sample.jpg',
        'data-sb-image-presentation': 'server',
        style: 'aspect-ratio: 16 / 9; position: absolute; width: 200%;'
    });
    const calls = { setMetadata: [], setValue: [], setAddress: [], notified: [] };
    const ctx = {
        resource: {
            id: 'images/sample.jpg#joomlaImage://local-images/sample.jpg?crop=0.1,0.1,0.5,0.5&ratio=16:9',
            type: 'image',
            image: 'images/sample.jpg'
        },
        imageUrl: '/images/sample.jpg',
        getImageElement: () => img,
        getAddress: () => 'images/sample.jpg#joomlaImage://local-images/sample.jpg?crop=0.1,0.1,0.5,0.5&ratio=16:9',
        getMetadata: () => ({
            'smartcrop.crop': {
                source: 'images/sample.jpg',
                crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
                ratio: { width: 16, height: 9 }
            }
        }),
        setMetadata: async (k, v) => { calls.setMetadata.push([k, v]); },
        setValue: async (k, v) => { calls.setValue.push([k, v]); },
        setAddress: async (addr) => { calls.setAddress.push(addr); },
        notifyPresentationChange: (p) => { calls.notified.push(p); }
    };

    // Must skip client apply while data-sb-image-presentation="server" is set
    assert.strictEqual(registeredPresentation.applies(ctx), false, 'applies() must return false when data-sb-image-presentation="server" is present');
    registeredPresentation.apply(img, ctx);
    assert.strictEqual(img.style.getPropertyValue('width'), '200%', 'apply() must not overwrite server-rendered image');

    // Local reset() must clear data-sb-image-presentation, call setMetadata("smartcrop.crop", null), setAddress(cleanUri), and notifyPresentationChange
    await registeredPresentation.reset(ctx);
    assert.strictEqual(img.getAttribute('data-sb-image-presentation'), null, 'reset() must remove data-sb-image-presentation attribute');
    assert.strictEqual(calls.setMetadata.length, 1, 'reset() must call setMetadata once');
    assert.deepStrictEqual(calls.setMetadata[0], ['smartcrop.crop', null]);
    assert.strictEqual(calls.setValue.length, 0, 'reset() must not call setValue when setMetadata is present');
    assert.strictEqual(calls.setAddress.length, 1, 'reset() must clean crop from image resource address');
    assert(!calls.setAddress[0].includes('crop='), 'Cleaned address must not contain crop=');
    assert.strictEqual(calls.notified.length, 1, 'reset() must call notifyPresentationChange');
    console.log('JS_CONTRACT_TESTS_OK');
})().catch(err => {
    console.error(err);
    process.exit(1);
});
JS;

        $tmpScript = sys_get_temp_dir() . '/smartcrop_js_contract_test_' . uniqid() . '.js';
        file_put_contents($tmpScript, $runnerScript);
        try {
            $cmd = sprintf('node %s %s 2>&1', escapeshellarg($tmpScript), escapeshellarg($jsFile));
            $output = (string) shell_exec($cmd);
            $this->assertTrue(
                str_contains($output, 'JS_CONTRACT_TESTS_OK'),
                'Node JS presentation contract test failed: ' . $output
            );
        } finally {
            @unlink($tmpScript);
        }
    }
}

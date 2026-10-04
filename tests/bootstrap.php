<?php

declare(strict_types=1);

namespace {
    define('_JEXEC', 1);

    // Autoloader for plugin classes
    spl_autoload_register(function (string $class): void {
        $prefix = 'SuperSoftJx\\Plugin\\Content\\SmartCrop\\';
        if (str_starts_with($class, $prefix)) {
            $relativeClass = substr($class, strlen($prefix));
            $file = __DIR__ . '/../plugin/src/' . str_replace('\\', '/', $relativeClass) . '.php';
            if (file_exists($file)) {
                require_once $file;
            }
        }
    });
}

namespace Joomla\CMS\Uri {
    class Uri
    {
        private static ?Uri $instance = null;
        public static string $mockHost = 'example.com';
        public static string $mockRoot = 'https://example.com/';
        public static string $mockRootRelative = '';

        public static function getInstance(?string $uri = 'none'): Uri
        {
            if (self::$instance === null) {
                self::$instance = new self();
            }
            return self::$instance;
        }

        public function getHost(): string
        {
            return self::$mockHost;
        }

        public static function root(bool $pathOnly = false): string
        {
            return $pathOnly ? self::$mockRootRelative : self::$mockRoot;
        }

        public static function base(bool $pathOnly = false): string
        {
            return self::root($pathOnly);
        }
    }
}

namespace Joomla\CMS\Language {
    class Text
    {
        public static function _(string $string, mixed $jsSafe = false): string
        {
            return $string;
        }

        public static function sprintf(string $string, mixed ...$args): string
        {
            return sprintf($string, ...$args);
        }

        public static function script(string $string): void
        {
        }
    }
}

namespace Joomla\CMS\Plugin {
    abstract class CMSPlugin
    {
        protected array $params = [];
        protected $app = null;

        public function __construct(mixed $subject = null, array $config = [])
        {
            if (is_array($subject)) {
                $this->params = $subject;
            } else {
                $this->params = $config;
            }
        }

        public function loadLanguage(string $extension = '', string $basePath = ''): bool
        {
            return true;
        }

        public function setApplication($app): void
        {
            $this->app = $app;
        }

        public function getApplication()
        {
            return $this->app;
        }
    }

    class PluginHelper
    {
        public static array $mockPlugins = [];

        public static function getPlugin(string $type, ?string $plugin = null): mixed
        {
            if ($plugin === null) {
                return self::$mockPlugins[$type] ?? [];
            }
            return self::$mockPlugins[$type][$plugin] ?? null;
        }

        public static function importPlugin(string $type, ?string $plugin = null, bool $autocreate = true, mixed $dispatcher = null): bool
        {
            return true;
        }
    }
}

namespace Joomla\Event {
    interface SubscriberInterface
    {
        public static function getSubscribedEvents(): array;
    }

    class Event
    {
        private string $name;
        private array $arguments;

        public function __construct(string $name, array $arguments = [])
        {
            $this->name = $name;
            $this->arguments = $arguments;
        }

        public function getName(): string
        {
            return $this->name;
        }

        public function getArgument(string $name, mixed $default = null): mixed
        {
            return $this->arguments[$name] ?? $default;
        }

        public function setArgument(string $name, mixed $value): void
        {
            $this->arguments[$name] = $value;
        }
    }
}

namespace Joomla\CMS {
    class Factory
    {
        public static mixed $application = null;
        public static mixed $container = null;

        public static function getApplication(): mixed
        {
            if (self::$application === null) {
                self::$application = new class {
                    private $dispatcher;

                    public function __construct()
                    {
                        $this->dispatcher = new class {
                            public array $listeners = [];

                            public function dispatch(string $name, mixed $event): mixed
                            {
                                if (isset($this->listeners[$name])) {
                                    foreach ($this->listeners[$name] as $listener) {
                                        $listener($event);
                                    }
                                }
                                return $event;
                            }
                        };
                    }

                    public function getDispatcher()
                    {
                        return $this->dispatcher;
                    }

                    public function getLanguage()
                    {
                        return new class {
                            public function load(string $extension, string $basePath = ''): bool
                            {
                                return true;
                            }
                        };
                    }

                    public function getDocument()
                    {
                        return null;
                    }
                };
            }
            return self::$application;
        }

        public static function getContainer(): mixed
        {
            if (self::$container === null) {
                self::$container = new class {
                    public array $services = [];

                    public function get(string $id): mixed
                    {
                        return $this->services[$id] ?? null;
                    }
                };
            }
            return self::$container;
        }
    }
}

namespace Joomla\CMS\Form {
    class FormHelper
    {
        public static array $prefixes = [];

        public static function addFieldPrefix(string $prefix): void
        {
            self::$prefixes[] = $prefix;
        }
    }

    class Form
    {
        private string $name;
        public array $loadedFiles = [];
        public array $values = [];

        public function __construct(string $name = 'com_content.article')
        {
            $this->name = $name;
        }

        public function getName(): string
        {
            return $this->name;
        }

        public function loadFile(string $file, bool $reset = true): bool
        {
            $this->loadedFiles[] = $file;
            return true;
        }

        public function getValue(string $name, ?string $group = null, mixed $default = null): mixed
        {
            $key = $group ? $group . '.' . $name : $name;
            return $this->values[$key] ?? $default;
        }
    }
}

namespace Joomla\CMS\Event\Model {
    use Joomla\CMS\Form\Form;

    class BeforeSaveEvent
    {
        private string $context;
        private object $item;
        private bool $isNew;

        public function __construct(string $context, object $item, bool $isNew = false)
        {
            $this->context = $context;
            $this->item = $item;
            $this->isNew = $isNew;
        }

        public function getContext(): string
        {
            return $this->context;
        }

        public function getItem(): object
        {
            return $this->item;
        }

        public function getIsNew(): bool
        {
            return $this->isNew;
        }
    }

    class BeforeValidateDataEvent
    {
        private mixed $subject;
        private array $data;

        public function __construct(string $name, array $arguments = [])
        {
            $this->subject = $arguments['subject'] ?? null;
            $this->data = $arguments['data'] ?? [];
        }

        public function getSubject(): mixed
        {
            return $this->subject;
        }

        public function getData(): array
        {
            return $this->data;
        }

        public function setData(array $data): void
        {
            $this->data = $data;
        }

        public function getArgument(string $name, mixed $default = null): mixed
        {
            return $name === 'data' ? $this->data : $default;
        }
    }
}

namespace Joomla\CMS\Event\Content {
    class ContentPrepareEvent
    {
        private string $context;
        private object $item;

        public function __construct(string $context, object $item)
        {
            $this->context = $context;
            $this->item = $item;
        }

        public function getContext(): string
        {
            return $this->context;
        }

        public function getItem(): object
        {
            return $this->item;
        }
    }
}


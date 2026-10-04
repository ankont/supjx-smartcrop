<?php

defined('_JEXEC') or die;

use Joomla\CMS\Application\CMSApplicationInterface;
use Joomla\CMS\Extension\PluginInterface;
use Joomla\CMS\Factory;
use Joomla\CMS\Plugin\PluginHelper;
use Joomla\DI\Container;
use Joomla\DI\ServiceProviderInterface;
use SuperSoftJx\Plugin\Content\SmartCrop\Extension\SmartCrop;
use SuperSoftJx\Plugin\Content\SmartCrop\Helper\SmartCropHelper;

return new class () implements ServiceProviderInterface {
    /**
     * Registers the service provider with a DI container.
     *
     * @param   Container  $container  The DI container.
     *
     * @return  void
     */
    public function register(Container $container): void
    {
        $container->set(
            PluginInterface::class,
            static function (Container $container) {
                if (!class_exists(SmartCrop::class)) {
                    if (class_exists(\JLoader::class)) {
                        \JLoader::registerNamespace('SuperSoftJx\\Plugin\\Content\\SmartCrop', dirname(__DIR__) . '/src');
                    }
                }

                $plugin = new SmartCrop(
                    (array) PluginHelper::getPlugin('content', 'smartcrop')
                );

                /** @var CMSApplicationInterface $app */
                $app = Factory::getApplication();
                $plugin->setApplication($app);

                // Register alias for template ease of use if not already registered
                if (!class_exists('SmartCrop', false)) {
                    class_alias(SmartCropHelper::class, 'SmartCrop');
                }

                return $plugin;
            }
        );
    }
};

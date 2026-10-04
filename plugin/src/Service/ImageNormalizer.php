<?php

declare(strict_types=1);

namespace SuperSoftJx\Plugin\Content\SmartCrop\Service;

defined('_JEXEC') or die;

use Joomla\CMS\Uri\Uri;

final class ImageNormalizer
{
    /**
     * Normalizes an image path or URL into a canonical source identity.
     *
     * Handles:
     * - Joomla media paths ("images/sample.jpg")
     * - Media fragments ("images/sample.jpg#joomlaImage://local-images/sample.jpg?width=1200&height=800")
     * - JSON strings and arrays from media fields
     * - Root-relative URLs ("/images/sample.jpg", "/subfolder/images/sample.jpg")
     * - Same-site absolute URLs ("https://example.com/images/sample.jpg")
     * - Local query strings and backslashes
     *
     * @param   mixed  $value  Raw image value
     *
     * @return  string  Canonical normalized source identity
     */
    public static function normalize(mixed $value): string
    {
        if (is_array($value)) {
            $extracted = $value['imagefile'] ?? $value['src'] ?? $value['url'] ?? reset($value);
            return self::normalize(is_string($extracted) ? $extracted : '');
        }

        $raw = trim((string) $value);
        if ($raw === '') {
            return '';
        }

        // Decode JSON representation if present
        if (($raw[0] === '{' || $raw[0] === '[') && ($decoded = json_decode($raw, true)) && is_array($decoded)) {
            return self::normalize($decoded);
        }

        // Handle Joomla media field fragment (e.g. images/sample.jpg#joomlaImage://... or #joomlaImage://local-images/sample.jpg?width=1200&height=800)
        if (($hashPos = strpos($raw, '#')) !== false) {
            $beforeHash = trim(substr($raw, 0, $hashPos));
            if ($beforeHash !== '') {
                $raw = $beforeHash;
            } else {
                $afterHash = substr($raw, $hashPos + 1);
                $afterHash = preg_replace('#^joomlaImage://#i', '', $afterHash);
                $afterHash = preg_replace('#^local-[^/:]+[/:]*#i', 'images/', $afterHash);
                $raw = $afterHash;
            }
        }

        $raw = trim(str_replace('\\', '/', $raw));
        $raw = preg_replace('#^local-[^/:]+[/:]*#i', 'images/', $raw);
        if ($raw === '') {
            return '';
        }

        // URL-decode for canonical path comparison
        $raw = rawurldecode($raw);

        // Parse URL components
        $parsed = parse_url($raw);
        $host   = $parsed['host'] ?? null;
        $path   = $parsed['path'] ?? $raw;

        if ($host !== null) {
            $siteHost = null;
            try {
                $siteHost = Uri::getInstance()->getHost();
            } catch (\Throwable) {
                $siteHost = $_SERVER['HTTP_HOST'] ?? null;
            }

            // If same-site absolute URL, strip scheme and host to normalize as local path
            if ($siteHost !== null && strcasecmp($host, $siteHost) === 0) {
                $raw = $path;
            } else {
                // External image URL: return normalized canonical external URL (without fragment)
                $query  = isset($parsed['query']) ? '?' . $parsed['query'] : '';
                $scheme = isset($parsed['scheme']) ? $parsed['scheme'] . '://' : '//';
                $port   = isset($parsed['port']) ? ':' . $parsed['port'] : '';

                return $scheme . $host . $port . $path . $query;
            }
        }

        // Strip local query string if any
        if (($queryPos = strpos($raw, '?')) !== false) {
            $raw = substr($raw, 0, $queryPos);
        }

        // Strip site subfolder base path if Joomla is hosted in a subfolder
        $cleanPath = ltrim($raw, '/');
        $basePath  = '';

        try {
            $basePath = trim((string) Uri::root(true), '/');
        } catch (\Throwable) {
        }

        if ($basePath !== '' && str_starts_with($cleanPath, $basePath . '/')) {
            $cleanPath = substr($cleanPath, strlen($basePath) + 1);
        }

        return trim($cleanPath, '/');
    }

    /**
     * Checks if two image source representations refer to the same canonical image.
     *
     * @param   mixed  $sourceA
     * @param   mixed  $sourceB
     *
     * @return  bool
     */
    public static function matches(mixed $sourceA, mixed $sourceB): bool
    {
        $normA = self::normalize($sourceA);
        $normB = self::normalize($sourceB);

        if ($normA === '' || $normB === '') {
            return false;
        }

        return $normA === $normB;
    }

    /**
     * Converts a normalized image source into a browser-loadable URL.
     *
     * @param   mixed  $value
     *
     * @return  string
     */
    public static function toUrl(mixed $value): string
    {
        $normalized = self::normalize($value);

        if ($normalized === '') {
            return '';
        }

        if (preg_match('#^(?:https?:)?//#i', $normalized)) {
            return $normalized;
        }

        try {
            $root = preg_replace('#/index\.php/?$#i', '/', (string) Uri::root());
            return rtrim($root, '/') . '/' . ltrim($normalized, '/');
        } catch (\Throwable) {
            return '/' . ltrim($normalized, '/');
        }
    }
}

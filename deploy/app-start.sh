#!/bin/sh
set -e
cd /app
# storage/ is a volume; make sure its folders exist and PHP-FPM can write them.
mkdir -p storage/framework/cache/data storage/framework/sessions storage/framework/views storage/logs storage/app/public
chown -R www-data:www-data storage bootstrap/cache
php artisan migrate --force
php artisan config:cache
php artisan route:cache
php artisan view:cache
exec php-fpm

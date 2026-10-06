FROM composer:2 AS vendor
WORKDIR /app
COPY backend/composer.json backend/composer.lock ./
RUN composer install --no-dev --no-interaction --prefer-dist --no-scripts --no-autoloader --ignore-platform-reqs
COPY backend/ ./
RUN rm -f .env database/database.sqlite \
 && composer dump-autoload --no-dev --optimize --classmap-authoritative

FROM php:8.4-fpm
RUN apt-get update \
 && apt-get install -y --no-install-recommends libpq-dev ffmpeg libpng-dev \
 && docker-php-ext-install opcache pdo_pgsql gd \
 && rm -rf /var/lib/apt/lists/*
COPY deploy/php.ini /usr/local/etc/php/conf.d/zz-app.ini
COPY deploy/app-start.sh /usr/local/bin/start-app
WORKDIR /app
COPY --from=vendor --chown=www-data:www-data /app /app
RUN chmod +x /usr/local/bin/start-app
CMD ["start-app"]

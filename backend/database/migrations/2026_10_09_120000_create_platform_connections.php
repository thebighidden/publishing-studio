<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        // An account connected through a platform's official API: an Instagram professional
        // account or a Facebook Page (both through Meta), or an X account. Tokens are encrypted.
        Schema::create('account_connections', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('account_id')->nullable()->constrained()->nullOnDelete();
            $table->string('provider'); // meta | x
            $table->string('kind'); // instagram | facebook_page | x
            $table->string('external_id'); // the IG user id, the Page id, the X user id
            $table->string('name')->nullable();
            $table->string('username')->nullable();
            $table->text('access_token');
            $table->text('refresh_token')->nullable();
            $table->timestamp('token_expires_at')->nullable();
            $table->json('scopes')->nullable();
            $table->json('meta')->nullable();
            $table->string('status')->default('ok'); // ok | expired | error
            $table->string('error')->nullable();
            $table->timestamp('checked_at')->nullable();
            $table->timestamps();

            $table->unique(['user_id', 'kind', 'external_id']);
        });

        Schema::table('accounts', function (Blueprint $table) {
            // auto: through the API when connected, else the phone. api | phone force one.
            $table->string('publish_via')->default('auto');
        });

        Schema::table('posts', function (Blueprint $table) {
            $table->string('external_id')->nullable(); // the platform's id for the published post
            $table->string('published_via')->nullable(); // api | phone
        });

        // The latest engagement of a published post, from the platform's API or read off a phone.
        Schema::create('post_metrics', function (Blueprint $table) {
            $table->id();
            $table->foreignId('post_id')->unique()->constrained()->cascadeOnDelete();
            $table->unsignedInteger('likes')->nullable();
            $table->unsignedInteger('comments')->nullable();
            $table->unsignedInteger('shares')->nullable();
            $table->unsignedInteger('saves')->nullable();
            $table->unsignedBigInteger('views')->nullable();
            $table->unsignedBigInteger('reach')->nullable();
            $table->json('reactions')->nullable(); // Facebook: like, love, haha, wow, sad, angry
            $table->string('source')->default('api'); // api | phone
            $table->string('error')->nullable();
            $table->timestamp('fetched_at')->nullable();
            $table->timestamps();
        });

        Schema::table('comments', function (Blueprint $table) {
            $table->string('external_id')->nullable()->index(); // the platform's comment id
            $table->foreignId('post_id')->nullable()->constrained()->nullOnDelete();
            $table->timestamp('posted_at')->nullable();
            $table->string('reply_external_id')->nullable();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('comments', function (Blueprint $table) {
            $table->dropIndex(['external_id']);
            $table->dropConstrainedForeignId('post_id');
            $table->dropColumn(['external_id', 'posted_at', 'reply_external_id']);
        });
        Schema::dropIfExists('post_metrics');
        Schema::table('posts', fn (Blueprint $table) => $table->dropColumn(['external_id', 'published_via']));
        Schema::table('accounts', fn (Blueprint $table) => $table->dropColumn('publish_via'));
        Schema::dropIfExists('account_connections');
    }
};

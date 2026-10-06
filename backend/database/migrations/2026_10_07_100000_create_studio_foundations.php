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
        // The media library: uploads, generated images and videos, and phone screenshots.
        Schema::create('assets', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('kind'); // image | video
            $table->string('source')->default('upload'); // upload | generated | screenshot | intake
            $table->string('name')->nullable();
            $table->string('path');
            $table->string('poster_path')->nullable();
            $table->string('mime');
            $table->unsignedBigInteger('size')->default(0);
            $table->unsignedInteger('width')->nullable();
            $table->unsignedInteger('height')->nullable();
            $table->decimal('duration', 8, 2)->nullable(); // seconds, videos only
            $table->json('meta')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'kind']);
        });

        // Phones that publish. The driver says how they're reached: the built-in simulator,
        // or the HTTP phone-control service by its device ID.
        Schema::create('devices', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->string('driver')->default('simulator'); // simulator | http
            $table->string('ref')->nullable();
            $table->string('status')->default('idle'); // idle | busy | offline | error
            // Simulator only: how reliable the virtual phone is (reliable | flaky | broken).
            $table->string('profile')->default('reliable');
            // One job per phone: the run holding it, set and cleared atomically.
            $table->unsignedBigInteger('booked_run_id')->nullable();
            $table->timestamp('booked_at')->nullable();
            $table->timestamp('paused_at')->nullable();
            $table->timestamp('last_seen_at')->nullable();
            $table->string('last_screenshot')->nullable();
            $table->json('meta')->nullable();
            $table->timestamps();
        });

        // The accounts the studio posts to, each on one platform and, for automated publishing,
        // linked to the phone where its app is logged in.
        Schema::create('accounts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('platform');
            $table->string('handle');
            $table->string('name')->nullable();
            $table->string('timezone')->nullable();
            $table->foreignId('device_id')->nullable()->constrained()->nullOnDelete();
            // Automated publishing is off until someone confirms this is an account it may run on.
            $table->boolean('automation')->default(false);
            $table->string('autonomy')->default('approve_all'); // approve_all (mode A) | rules (mode B)
            // Never two automated posts on this account closer together than this.
            $table->unsignedInteger('min_gap_minutes')->default(60);
            $table->json('profile')->nullable(); // editorial profile: tone, topics, style, do, avoid
            $table->timestamps();

            $table->unique(['user_id', 'platform', 'handle']);
        });

        Schema::table('posts', function (Blueprint $table) {
            $table->foreignId('account_id')->nullable()->after('user_id')->constrained()->nullOnDelete();
            $table->string('placement')->nullable()->after('format');
            $table->timestamp('approved_at')->nullable()->after('status');
            $table->foreignId('approved_by')->nullable()->after('approved_at')->constrained('users')->nullOnDelete();
            // Proof it went live: set only with evidence (a run, or someone taking over by hand).
            $table->string('post_url')->nullable()->after('published_at');
            $table->text('error')->nullable()->after('post_url');
        });

        Schema::create('post_assets', function (Blueprint $table) {
            $table->id();
            $table->foreignId('post_id')->constrained()->cascadeOnDelete();
            $table->foreignId('asset_id')->constrained()->cascadeOnDelete();
            $table->unsignedSmallInteger('position')->default(0);
        });

        // Who did what, and why it was allowed: a person, an agent, or a rule.
        Schema::create('action_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('actor'); // you | agent:<name> | rule:<id> | system
            $table->string('action');
            $table->nullableMorphs('subject');
            $table->string('decision')->nullable(); // approved | auto | blocked | queued
            $table->string('summary');
            $table->json('meta')->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->index(['user_id', 'created_at']);
        });

        Schema::create('ai_usages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->nullable()->constrained()->cascadeOnDelete();
            $table->string('provider');
            $table->string('model');
            $table->string('purpose')->nullable();
            $table->unsignedInteger('input_tokens')->default(0);
            $table->unsignedInteger('output_tokens')->default(0);
            $table->decimal('cost', 10, 6)->default(0);
            $table->nullableMorphs('context');
            $table->timestamp('created_at')->useCurrent();

            $table->index(['user_id', 'created_at']);
        });

        Schema::table('users', function (Blueprint $table) {
            // The stop button: while set, nothing publishes automatically.
            $table->timestamp('publishing_paused_at')->nullable();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('users', fn (Blueprint $table) => $table->dropColumn('publishing_paused_at'));
        Schema::dropIfExists('ai_usages');
        Schema::dropIfExists('action_logs');
        Schema::dropIfExists('post_assets');
        Schema::table('posts', function (Blueprint $table) {
            $table->dropConstrainedForeignId('account_id');
            $table->dropConstrainedForeignId('approved_by');
            $table->dropColumn(['placement', 'approved_at', 'post_url', 'error']);
        });
        Schema::dropIfExists('accounts');
        Schema::dropIfExists('devices');
        Schema::dropIfExists('assets');
    }
};

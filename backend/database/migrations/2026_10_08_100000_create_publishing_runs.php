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
        // One row per publishing run: the run record the hand-in asks for, kept as it happens.
        Schema::create('publishing_runs', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique(); // the run_id in the exported record
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('post_id')->constrained()->cascadeOnDelete();
            $table->foreignId('device_id')->nullable()->constrained()->nullOnDelete();
            $table->unsignedTinyInteger('attempt')->default(1);
            // running | confirmed | failed | uncertain. "uncertain" is an honest answer, not a cop-out:
            // the phone was told to post, but nothing proves it went live.
            $table->string('status')->default('running');
            $table->text('goal');
            $table->json('steps')->nullable(); // [{n, action, ok, ms, note?}]
            $table->json('evidence')->nullable(); // {kind: post_url | screenshot, ref, note}
            $table->foreignId('screenshot_id')->nullable()->constrained('assets')->nullOnDelete();
            $table->decimal('spend', 10, 4)->default(0);
            $table->text('error')->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('ended_at')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'created_at']);
            $table->index(['status', 'updated_at']);
        });

        // The automation service (the Python agent) signs its calls with this token.
        Schema::table('users', function (Blueprint $table) {
            $table->string('agent_token', 64)->nullable()->unique();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('users', fn (Blueprint $table) => $table->dropColumn('agent_token'));
        Schema::dropIfExists('publishing_runs');
    }
};

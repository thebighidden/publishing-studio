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
        // A project: a canvas of notes, drafts, images and videos, laid out by hand.
        Schema::create('projects', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->json('canvas')->nullable(); // {nodes: [...], edges: [...], view: {x, y, zoom}}
            $table->timestamps();
        });

        // Every request to a model for text, an image or a video, and what came back.
        Schema::create('generations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('project_id')->nullable()->constrained()->nullOnDelete();
            $table->string('kind'); // text | image | video
            $table->string('model'); // registry id, e.g. higgsfield/ideogram-4
            $table->text('prompt');
            $table->json('params')->nullable();
            $table->json('input_asset_ids')->nullable();
            $table->string('status')->default('queued'); // queued | running | succeeded | failed | canceled
            $table->string('external_id')->nullable();
            $table->string('status_url')->nullable();
            $table->longText('output_text')->nullable();
            $table->json('output_asset_ids')->nullable();
            $table->text('error')->nullable();
            // Retry, switch model or edit prompt: a new generation pointing at the one it replaces.
            $table->foreignId('retry_of')->nullable()->constrained('generations')->nullOnDelete();
            // Media recipes chain generations: each step's output feeds the next.
            $table->string('recipe')->nullable();
            $table->unsignedTinyInteger('recipe_step')->nullable();
            $table->foreignId('parent_id')->nullable()->constrained('generations')->nullOnDelete();
            $table->decimal('cost', 10, 4)->default(0);
            $table->timestamp('started_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'created_at']);
        });

        // The last time each connector was tried, and how it went.
        Schema::create('connector_tests', function (Blueprint $table) {
            $table->id();
            $table->string('provider');
            $table->boolean('ok');
            $table->string('message');
            $table->unsignedInteger('latency_ms')->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->index(['provider', 'created_at']);
        });

        // Scores from the built-in eval suite, per model and task.
        Schema::create('model_evals', function (Blueprint $table) {
            $table->id();
            $table->string('model');
            $table->string('task');
            $table->unsignedTinyInteger('score'); // 0–100
            $table->text('detail')->nullable();
            $table->text('output')->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->index(['model', 'created_at']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('model_evals');
        Schema::dropIfExists('connector_tests');
        Schema::dropIfExists('generations');
        Schema::dropIfExists('projects');
    }
};

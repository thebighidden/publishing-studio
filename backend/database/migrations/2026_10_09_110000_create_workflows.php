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
        // A saved chain of studio steps: image → upscale → video → voiceover → caption → post draft.
        Schema::create('workflows', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->json('steps');
            $table->timestamps();
        });

        // One run of a workflow, with the steps as they were when it started.
        Schema::create('workflow_runs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('workflow_id')->nullable()->constrained()->nullOnDelete();
            $table->string('name');
            $table->json('steps');
            $table->text('prompt')->nullable();
            $table->unsignedBigInteger('start_asset_id')->nullable();
            $table->unsignedBigInteger('board_id')->nullable();
            $table->string('status')->default('running'); // running | succeeded | failed
            $table->unsignedSmallInteger('step')->default(0);
            $table->json('outputs')->nullable(); // per step: generation, files, text, post
            $table->text('error')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->timestamps();
        });

        Schema::table('generations', function (Blueprint $table) {
            $table->unsignedBigInteger('workflow_run_id')->nullable()->index();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('generations', function (Blueprint $table) {
            $table->dropIndex(['workflow_run_id']);
            $table->dropColumn('workflow_run_id');
        });
        Schema::dropIfExists('workflow_runs');
        Schema::dropIfExists('workflows');
    }
};

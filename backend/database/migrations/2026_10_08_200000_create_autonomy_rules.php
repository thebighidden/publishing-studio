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
        // Mode B: rules the operator approved let matching actions run on their own.
        // Anything no rule covers waits for a person (the exception queue).
        Schema::create('autonomy_rules', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->constrained()->cascadeOnDelete();
            // The action kind the rule governs, e.g. profile.apply_ai_change, comment.send_reply.
            $table->string('action', 40);
            // allow: matching actions run. A deny rule lets the operator carve out exceptions.
            $table->boolean('allow')->default(true);
            // Optional narrowers, e.g. {"max_per_day": 5}. Empty matches everything of that kind.
            $table->json('conditions')->nullable();
            $table->foreignId('created_by')->constrained('users')->cascadeOnDelete();
            $table->timestamps();

            $table->index(['account_id', 'action']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('autonomy_rules');
    }
};

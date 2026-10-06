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
        // Area 12: one pass of collect → compare → validate → report over what the studio
        // claims happened (posts, runs, phones) and what the evidence actually shows.
        Schema::create('investigations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('account_id')->nullable()->constrained()->nullOnDelete(); // null = the whole studio
            $table->string('title');
            // running | done | failed
            $table->string('status', 20)->default('running');
            $table->string('stage', 20)->default('collect'); // which pipeline stage it's in
            $table->json('stages')->nullable(); // [{name, summary, ms}]
            $table->json('findings')->nullable(); // [{rule, severity, subject, detail, verdict, note}]
            $table->json('counts')->nullable(); // {posts, runs, devices, issues}
            $table->text('report')->nullable(); // the markdown report
            $table->text('error')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'created_at']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('investigations');
    }
};

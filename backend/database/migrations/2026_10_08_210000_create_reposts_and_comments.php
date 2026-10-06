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
        // Area 02: an X post picked for reuse on Instagram. Permission is recorded by a person
        // before any adaptation; the adapted caption always credits the original author.
        Schema::create('reposts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('account_id')->constrained()->cascadeOnDelete(); // the Instagram account it goes to
            $table->string('source_url', 500);
            $table->string('author', 120); // the X handle it came from
            $table->text('source_text');
            // pending | allowed | denied — plus the why, recorded by the operator.
            $table->string('permission', 20)->default('pending');
            $table->string('permission_note', 500)->nullable();
            // captured | adapted | scheduled | dropped
            $table->string('status', 20)->default('captured');
            $table->text('caption')->nullable();
            $table->json('hashtags')->nullable();
            $table->boolean('attribution')->default(true); // credit the original author
            $table->foreignId('post_id')->nullable()->constrained()->nullOnDelete(); // the post it became
            $table->timestamps();

            $table->index(['user_id', 'status']);
        });

        // Area 11: a comment on one of the account's posts. AI triages (reply / ignore / human);
        // a human approves every reply before it's sent, unless a mode-B rule covers it.
        Schema::create('comments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('account_id')->constrained()->cascadeOnDelete();
            $table->string('author', 120);
            $table->text('body');
            $table->string('post_ref', 300)->nullable(); // what they commented on
            // new | drafted | sent | ignored | human
            $table->string('status', 20)->default('new');
            $table->json('triage')->nullable(); // {decision: reply|ignore|human, reason}
            $table->text('draft')->nullable(); // the AI's suggested reply
            $table->text('reply')->nullable(); // what actually went out
            $table->timestamp('sent_at')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'status']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('comments');
        Schema::dropIfExists('reposts');
    }
};

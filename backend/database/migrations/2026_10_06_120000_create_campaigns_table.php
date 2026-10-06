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
        Schema::create('campaigns', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            // quick | full: how many questions the person signed up for.
            $table->string('depth');
            // ai | script: Claude runs the interview, or the fixed question list does.
            $table->string('mode');
            $table->json('fields');
            $table->json('messages');
            // The answer chips (and whether to offer a photo upload) under the open question.
            $table->json('prompt')->nullable();
            // Script mode: the field the open question fills.
            $table->string('pending')->nullable();
            $table->unsignedSmallInteger('asked')->default(0);
            $table->timestamp('completed_at')->nullable();
            $table->longText('kit')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'updated_at']);
        });

        Schema::create('campaign_photos', function (Blueprint $table) {
            $table->id();
            $table->foreignId('campaign_id')->constrained()->cascadeOnDelete();
            $table->string('path');
            $table->string('mime');
            // person | product | place | other, once Claude has looked at it.
            $table->string('kind')->nullable();
            $table->string('title')->nullable();
            $table->text('description')->nullable();
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('campaign_photos');
        Schema::dropIfExists('campaigns');
    }
};

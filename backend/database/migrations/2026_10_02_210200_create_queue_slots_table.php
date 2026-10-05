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
        // Recurring weekly posting times. "Add to queue" drops a post into the next free one.
        Schema::create('queue_slots', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            // ISO weekday: 1 = Monday … 7 = Sunday, in the user's own timezone.
            $table->unsignedTinyInteger('weekday');
            $table->string('time', 5);
            $table->timestamps();

            $table->unique(['user_id', 'weekday', 'time']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('queue_slots');
    }
};

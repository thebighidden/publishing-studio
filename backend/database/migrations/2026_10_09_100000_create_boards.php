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
        // Boards: named shelves in the Creative Lab gallery. An asset sits on one board or none.
        Schema::create('boards', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->timestamps();
        });

        // Plain columns: SQLite can't add a foreign key to an existing table. Deleting a board
        // moves its assets back to "no board" in BoardController.
        Schema::table('assets', function (Blueprint $table) {
            $table->unsignedBigInteger('board_id')->nullable()->index();
        });
        // Where a generation's results land.
        Schema::table('generations', function (Blueprint $table) {
            $table->unsignedBigInteger('board_id')->nullable();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('generations', fn (Blueprint $table) => $table->dropColumn('board_id'));
        Schema::table('assets', function (Blueprint $table) {
            $table->dropIndex(['board_id']);
            $table->dropColumn('board_id');
        });
        Schema::dropIfExists('boards');
    }
};

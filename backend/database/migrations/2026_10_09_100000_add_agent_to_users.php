<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * The studio's phone agent, as it last described itself: where its live view and device scan
     * are served, which computer it runs on, and whether adb and scrcpy are there.
     */
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->json('agent')->nullable()->after('agent_token');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('agent');
        });
    }
};

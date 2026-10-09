<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Email confirmation is gone: accounts that signed up before and never clicked the link
 * count as confirmed, so nothing (AI writing, generation, the interview) stays locked.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('users')->whereNull('email_verified_at')->update(['email_verified_at' => now()]);
    }

    public function down(): void
    {
        // Which accounts were confirmed for real isn't recorded, so there's nothing to undo.
    }
};

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
        // A campaign is now the whole run: brief → plan (gate 6A) → production → review (gate 6B) → schedule.
        Schema::table('campaigns', function (Blueprint $table) {
            $table->string('name')->nullable()->after('user_id');
            $table->string('source')->default('intake')->after('name'); // intake | form
            // The short brief form: goal, audience, message, key_facts, deadline.
            $table->json('brief')->nullable()->after('fields');
            // brief | planning | plan_review | producing | content_review | scheduled
            $table->string('stage')->default('brief')->after('source');
            // A campaign can only make autonomy stricter than its accounts': null, or approve_all.
            $table->string('autonomy')->nullable()->after('stage');
            $table->json('account_ids')->nullable();
            $table->date('period_start')->nullable();
            $table->date('period_end')->nullable();
            $table->json('plan')->nullable(); // the big idea and pillars
            $table->timestamp('plan_approved_at')->nullable();
            $table->foreignId('plan_approved_by')->nullable()->constrained('users')->nullOnDelete();
        });

        // One master piece of content in a campaign.
        Schema::create('campaign_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('campaign_id')->constrained()->cascadeOnDelete();
            $table->unsignedSmallInteger('position')->default(0);
            $table->string('title');
            $table->string('pillar')->nullable();
            $table->string('format')->default('image'); // text | image | video | carousel
            $table->text('message')->nullable(); // what it has to say
            $table->text('hook')->nullable();
            $table->text('caption')->nullable(); // the master copy
            $table->text('visual')->nullable(); // the visual concept
            $table->json('prompts')->nullable(); // image prompts from the visual director
            $table->unsignedSmallInteger('reference_photo')->nullable(); // which intake photo it builds on
            $table->json('shots')->nullable(); // video: [{description, camera, duration, still_id, video_id, asset_id, status}]
            $table->json('asset_ids')->nullable(); // the master media, in order
            $table->json('account_ids')->nullable(); // where it goes
            $table->string('source')->default('ai'); // ai | upload
            // planned | producing | needs_media | ready | failed
            $table->string('status')->default('planned');
            $table->text('error')->nullable();
            $table->timestamps();
        });

        // The item, as it goes to one account: the same content, or its own version.
        Schema::create('item_variants', function (Blueprint $table) {
            $table->id();
            $table->foreignId('campaign_item_id')->constrained()->cascadeOnDelete();
            $table->foreignId('account_id')->constrained()->cascadeOnDelete();
            $table->string('mode')->default('adapted'); // shared | adapted
            $table->text('caption')->nullable();
            $table->string('placement')->nullable();
            $table->json('asset_ids')->nullable();
            $table->json('checks')->nullable(); // the pre-export check
            $table->json('qa')->nullable(); // {status: pass|warn|fail, issues: [...]}
            $table->string('status')->default('draft'); // draft | approved | rejected
            $table->text('feedback')->nullable(); // why it was rejected
            $table->timestamp('approved_at')->nullable();
            $table->foreignId('approved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['campaign_item_id', 'account_id']);
        });

        // The pipeline's visible log: each agent's turn, what it made, what it cost.
        Schema::create('agent_steps', function (Blueprint $table) {
            $table->id();
            $table->foreignId('campaign_id')->constrained()->cascadeOnDelete();
            $table->string('agent'); // writer | visual_director | media | adapter | qa | scheduler | publisher
            $table->string('status')->default('running'); // running | done | failed
            $table->string('summary')->nullable();
            $table->json('output')->nullable();
            $table->string('model')->nullable();
            $table->decimal('cost', 10, 4)->default(0);
            $table->text('error')->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->timestamps();
        });

        // What each account remembers, kept apart by kind.
        Schema::create('account_memories', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->constrained()->cascadeOnDelete();
            $table->string('kind'); // instruction | example | history
            $table->text('content');
            $table->string('source')->nullable(); // operator | liked | published
            $table->json('meta')->nullable();
            $table->timestamps();

            $table->index(['account_id', 'kind']);
        });

        // Changes to an account's editorial profile wait for approval.
        Schema::create('profile_changes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->constrained()->cascadeOnDelete();
            $table->string('field');
            $table->text('from')->nullable();
            $table->text('to')->nullable();
            $table->text('reason')->nullable();
            $table->string('source')->default('operator'); // operator | ai
            $table->string('status')->default('pending'); // pending | approved | rejected
            $table->foreignId('decided_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('decided_at')->nullable();
            $table->timestamps();
        });

        Schema::table('posts', function (Blueprint $table) {
            $table->foreignId('campaign_id')->nullable()->after('account_id')->constrained()->nullOnDelete();
            $table->foreignId('variant_id')->nullable()->after('campaign_id')->constrained('item_variants')->nullOnDelete();
        });

        Schema::table('generations', function (Blueprint $table) {
            $table->foreignId('campaign_item_id')->nullable()->after('project_id')->constrained()->nullOnDelete();
            $table->unsignedTinyInteger('shot')->nullable()->after('campaign_item_id');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('generations', function (Blueprint $table) {
            $table->dropConstrainedForeignId('campaign_item_id');
            $table->dropColumn('shot');
        });
        Schema::table('posts', function (Blueprint $table) {
            $table->dropConstrainedForeignId('variant_id');
            $table->dropConstrainedForeignId('campaign_id');
        });
        Schema::dropIfExists('profile_changes');
        Schema::dropIfExists('account_memories');
        Schema::dropIfExists('agent_steps');
        Schema::dropIfExists('item_variants');
        Schema::dropIfExists('campaign_items');
        Schema::table('campaigns', function (Blueprint $table) {
            $table->dropConstrainedForeignId('plan_approved_by');
            $table->dropColumn(['name', 'source', 'brief', 'stage', 'autonomy', 'account_ids', 'period_start', 'period_end', 'plan', 'plan_approved_at']);
        });
    }
};

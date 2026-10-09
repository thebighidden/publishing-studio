<?php

namespace App\Services\Ai\Media;

/**
 * Builds InvokeAI node graphs. Text to image is the graph Invoke's own Compose tab sends for a
 * model family; edits follow its canvas: inpaint (regenerate the masked area) and outpaint
 * (fill transparent edges after infilling them), each blended back over the original so only
 * the masked area changes.
 *
 * Every graph ends in a node called `canvas_output`, which is where the result is read from,
 * and has a `denoise_latents` node whose seed is set per run.
 */
class InvokeGraphs
{
    /** Model families FlowAI has graphs for. Others are listed but can't run. */
    public const FAMILIES = ['z-image'];

    /** The registry id (after "invoke/") of Invoke's built-in Real-ESRGAN upscaler. */
    public const UPSCALER = 'esrgan';

    private array $nodes = [];

    private array $edges = [];

    public static function supports(?string $base): bool
    {
        return in_array($base, self::FAMILIES, true);
    }

    /**
     * @param  array<string, mixed>  $model  the model's full config from Invoke
     * @return array<string, mixed>
     */
    public function textToImage(array $model, string $prompt, ?string $negative, int $width, int $height, int $steps, float $cfg): array
    {
        $this->base($model, $prompt, $negative, $width, $height, $steps, $cfg);
        $this->node('canvas_output', 'z_image_l2i', ['is_intermediate' => false, 'use_cache' => false]);
        $this->edge('model_loader', 'vae', 'canvas_output', 'vae');
        $this->edge('denoise_latents', 'latents', 'canvas_output', 'latents');

        return $this->graph();
    }

    /**
     * Regenerate the masked part of an image, or (outpaint) fill its transparent edges too.
     *
     * @param  array<string, mixed>  $model
     * @param  string  $image  the image on the server; for outpaint, padded with transparency
     * @param  string  $mask  the painted mask on the server: opaque where it should change
     * @param  array{0: int, 1: int}  $size  the image's size
     * @param  array{0: int, 1: int}  $processing  the size the model works at
     * @return array<string, mixed>
     */
    public function edit(array $model, string $prompt, ?string $negative, string $image, string $mask, array $size, array $processing, int $steps, float $cfg, float $strength, bool $outpaint): array
    {
        [$width, $height] = $size;
        $resize = $size !== $processing;
        $this->base($model, $prompt, $negative, $processing[0], $processing[1], $steps, $cfg);
        $this->nodes['denoise_latents']['denoising_start'] = round(1 - max(0.05, min(1, $strength)), 3);

        // The decoded result is intermediate here: what's kept is the blend over the original.
        $this->node('canvas_l2i', 'z_image_l2i');
        $this->edge('model_loader', 'vae', 'canvas_l2i', 'vae');
        $this->edge('denoise_latents', 'latents', 'canvas_l2i', 'latents');

        // Invoke's masks are black where the model may paint: the painted area (opaque) inverted.
        $this->node('user_mask', 'tomask', ['image' => ['image_name' => $mask], 'invert' => true]);
        if ($resize) {
            $this->node('canvas_resize_initial_to_processing', 'img_resize', ['image' => ['image_name' => $image], 'width' => $processing[0], 'height' => $processing[1]]);
        }
        $start = $resize ? ['canvas_resize_initial_to_processing', 'image'] : null;

        if ($outpaint) {
            // Fill the empty edges with something plausible first, then let the model repaint
            // them along with anything painted.
            $this->node('infill', 'infill_patchmatch', ['downscale' => 1] + ($start ? [] : ['image' => ['image_name' => $image]]));
            if ($start) {
                $this->link($start, 'infill', 'image');
            }
            $this->node('image_alpha_to_mask', 'tomask', ['image' => ['image_name' => $image]]);
            $this->node('mask_combine', 'mask_combine');
            $this->edge('user_mask', 'image', 'mask_combine', 'mask1');
            $this->edge('image_alpha_to_mask', 'image', 'mask_combine', 'mask2');
            $maskEdge = ['mask_combine', 'image'];
            $latentsFrom = ['infill', 'image'];
            $gradientImage = $resize ? ['infill', 'image'] : null;
        } else {
            $maskEdge = ['user_mask', 'image'];
            $latentsFrom = $start;
            $gradientImage = $start;
        }
        if ($resize) {
            $this->node('canvas_resize_mask_to_processing', 'img_resize', ['width' => $processing[0], 'height' => $processing[1]]);
            $this->link($maskEdge, 'canvas_resize_mask_to_processing', 'image');
            $maskEdge = ['canvas_resize_mask_to_processing', 'image'];
        }

        $this->node('i2l', 'z_image_i2l', $latentsFrom ? [] : ['image' => ['image_name' => $image]]);
        if ($latentsFrom) {
            $this->link($latentsFrom, 'i2l', 'image');
        }
        $this->edge('model_loader', 'vae', 'i2l', 'vae');
        $this->edge('i2l', 'latents', 'denoise_latents', 'latents');

        $this->node('create_gradient_mask', 'create_gradient_mask', [
            'coherence_mode' => 'Gaussian Blur', 'edge_radius' => 16, 'minimum_denoise' => 0, 'fp32' => false,
        ] + ($gradientImage ? [] : ['image' => ['image_name' => $image]]));
        if ($gradientImage) {
            $this->link($gradientImage, 'create_gradient_mask', 'image');
        }
        $this->link($maskEdge, 'create_gradient_mask', 'mask');
        $this->edge('model_loader', 'vae', 'create_gradient_mask', 'vae');
        $this->edge('create_gradient_mask', 'denoise_mask', 'denoise_latents', 'denoise_mask');

        $this->node('expand_mask', 'expand_mask_with_fade', ['fade_size_px' => 16]);
        $this->edge('create_gradient_mask', 'expanded_mask_area', 'expand_mask', 'mask');

        $generated = ['canvas_l2i', 'image'];
        $blendMask = ['expand_mask', 'image'];
        if ($resize) {
            $this->node('canvas_resize_generated_to_bbox', 'img_resize', ['width' => $width, 'height' => $height]);
            $this->link($generated, 'canvas_resize_generated_to_bbox', 'image');
            $this->node('canvas_resize_output_mask_to_bbox', 'img_resize', ['width' => $width, 'height' => $height]);
            $this->link($blendMask, 'canvas_resize_output_mask_to_bbox', 'image');
            $generated = ['canvas_resize_generated_to_bbox', 'image'];
            $blendMask = ['canvas_resize_output_mask_to_bbox', 'image'];
        }

        $this->node('canvas_output', 'invokeai_img_blend', ['layer_base' => ['image_name' => $image], 'is_intermediate' => false, 'use_cache' => false]);
        $this->link($generated, 'canvas_output', 'layer_upper');
        $this->link($blendMask, 'canvas_output', 'mask');

        return $this->graph();
    }

    /**
     * Make an image 2× or 4× larger with Real-ESRGAN. Invoke fetches the weights itself on first
     * use, so nothing has to be installed; no prompt and no main model are involved.
     *
     * @return array<string, mixed>
     */
    public function upscale(string $image, int $scale): array
    {
        $this->nodes = [];
        $this->edges = [];
        $this->node('canvas_output', 'esrgan', [
            'image' => ['image_name' => $image],
            'model_name' => $scale === 2 ? 'RealESRGAN_x2plus.pth' : 'RealESRGAN_x4plus.pth',
            'tile_size' => 400,
            'is_intermediate' => false, 'use_cache' => false,
        ]);

        return $this->graph();
    }

    /**
     * The size a model works at for an aspect ratio: its native area, on its grid.
     *
     * @return array{0: int, 1: int}
     */
    public static function fit(float $ratio, int $area, int $grid): array
    {
        $width = sqrt($area * $ratio);
        $height = $width / $ratio;
        $snap = fn (float $v) => max($grid, (int) round($v / $grid) * $grid);

        return [$snap($width), $snap($height)];
    }

    /**
     * Prompt, model and the denoise step, shared by every graph.
     *
     * @param  array<string, mixed>  $model
     */
    private function base(array $model, string $prompt, ?string $negative, int $width, int $height, int $steps, float $cfg): void
    {
        $this->nodes = [];
        $this->edges = [];
        $this->node('model_loader', 'z_image_model_loader', ['model' => $model, 'qwen3_source_model' => $model]);
        $this->node('pos_cond', 'z_image_text_encoder', ['prompt' => $prompt]);
        $this->node('pos_cond_collect', 'collect');
        $this->node('denoise_latents', 'z_image_denoise', [
            'width' => $width, 'height' => $height, 'steps' => $steps, 'guidance_scale' => $cfg,
            'scheduler' => $model['default_settings']['scheduler'] ?? 'euler',
            'denoising_start' => 0, 'denoising_end' => 1, 'seed' => 0,
        ]);
        $this->edge('model_loader', 'transformer', 'denoise_latents', 'transformer');
        $this->edge('model_loader', 'qwen3_encoder', 'pos_cond', 'qwen3_encoder');
        $this->edge('model_loader', 'vae', 'denoise_latents', 'vae');
        $this->edge('pos_cond', 'conditioning', 'pos_cond_collect', 'item');
        $this->edge('pos_cond_collect', 'collection', 'denoise_latents', 'positive_conditioning');

        // A negative prompt only counts when guidance is above 1.
        if (filled($negative) && $cfg > 1) {
            $this->node('neg_cond', 'z_image_text_encoder', ['prompt' => $negative]);
            $this->node('neg_cond_collect', 'collect');
            $this->edge('model_loader', 'qwen3_encoder', 'neg_cond', 'qwen3_encoder');
            $this->edge('neg_cond', 'conditioning', 'neg_cond_collect', 'item');
            $this->edge('neg_cond_collect', 'collection', 'denoise_latents', 'negative_conditioning');
        }
    }

    /**
     * @param  array<string, mixed>  $fields
     */
    private function node(string $id, string $type, array $fields = []): void
    {
        $this->nodes[$id] = ['id' => $id, 'type' => $type, 'is_intermediate' => true, 'use_cache' => true, ...$fields];
    }

    /**
     * @param  array{0: string, 1: string}  $from  a node and its output field
     */
    private function link(array $from, string $to, string $toField): void
    {
        $this->edge($from[0], $from[1], $to, $toField);
    }

    private function edge(string $from, string $fromField, string $to, string $toField): void
    {
        $this->edges[] = ['source' => ['node_id' => $from, 'field' => $fromField], 'destination' => ['node_id' => $to, 'field' => $toField]];
    }

    /**
     * @return array<string, mixed>
     */
    private function graph(): array
    {
        return ['id' => 'flowai-'.bin2hex(random_bytes(6)), 'nodes' => $this->nodes, 'edges' => $this->edges];
    }
}

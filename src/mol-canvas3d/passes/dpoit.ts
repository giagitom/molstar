/**
 * Copyright (c) 2020 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Gianluca Tomasello <giagitom@gmail.com>
 *
 * Adapted from https://github.com/tsherif/webgl2examples, The MIT License, Copyright © 2017 Tarek Sherif, Shuai Shao 
 */

import { QuadSchema, QuadValues } from '../../mol-gl/compute/util';
import { ComputeRenderable, createComputeRenderable } from '../../mol-gl/renderable';
import { TextureSpec, UniformSpec, Values } from '../../mol-gl/renderable/schema';
import { ShaderCode } from '../../mol-gl/shader-code';
import { WebGLContext } from '../../mol-gl/webgl/context';
import { createComputeRenderItem } from '../../mol-gl/webgl/render-item';
import { Texture } from '../../mol-gl/webgl/texture';
import { ValueCell } from '../../mol-util';
import { quad_vert } from '../../mol-gl/shader/quad.vert';
import { evaluateDpoit_frag } from '../../mol-gl/shader/evaluate-dpoit.frag';
import { blendBackDpoit_frag } from '../../mol-gl/shader/blend-back-dpoit.frag';
import { Framebuffer } from '../../mol-gl/webgl/framebuffer';
import { Vec2 } from '../../mol-math/linear-algebra';
import { isDebugMode, isTimingMode } from '../../mol-util/debug';

const BlendBackDpoitSchema = {
    ...QuadSchema,
    tDpoitBackColor: TextureSpec('texture', 'rgba', 'float', 'nearest'),
    uTexSize: UniformSpec('v2'),
};
const BlendBackDpoitShaderCode = ShaderCode('blend-back-dpoit', quad_vert, blendBackDpoit_frag);
type BlendBackDpoitRenderable = ComputeRenderable<Values<typeof BlendBackDpoitSchema>>

function getBlendBackDpoitRenderable(ctx: WebGLContext, dopitBlendBackTexture: Texture): BlendBackDpoitRenderable {
    const values: Values<typeof BlendBackDpoitSchema> = {
        ...QuadValues,
        tDpoitBackColor: ValueCell.create(dopitBlendBackTexture),
        uTexSize: ValueCell.create(Vec2.create(dopitBlendBackTexture.getWidth(), dopitBlendBackTexture.getHeight())),
    };

    const schema = { ...BlendBackDpoitSchema };
    const renderItem = createComputeRenderItem(ctx, 'triangles', BlendBackDpoitShaderCode, schema, values);

    return createComputeRenderable(renderItem, values);
}

const EvaluateDpoitSchema = {
    ...QuadSchema,
    tDpoitFrontColor: TextureSpec('texture', 'rgba', 'float', 'nearest'),
    tDpoitBlendBackColor: TextureSpec('texture', 'rgba', 'float', 'nearest'),
    uTexSize: UniformSpec('v2'),
};
const EvaluateDpoitShaderCode = ShaderCode('evaluate-dpoit', quad_vert, evaluateDpoit_frag);
type EvaluateDpoitRenderable = ComputeRenderable<Values<typeof EvaluateDpoitSchema>>

function getEvaluateDpoitRenderable(ctx: WebGLContext, dpoitFrontColorTexture: Texture, dopitBlendBackTexture: Texture): EvaluateDpoitRenderable {
    const values: Values<typeof EvaluateDpoitSchema> = {
        ...QuadValues,
        tDpoitFrontColor: ValueCell.create(dpoitFrontColorTexture),
        tDpoitBlendBackColor: ValueCell.create(dopitBlendBackTexture),
        uTexSize: ValueCell.create(Vec2.create(dpoitFrontColorTexture.getWidth(), dpoitFrontColorTexture.getHeight())),
    };

    const schema = { ...EvaluateDpoitSchema };
    const renderItem = createComputeRenderItem(ctx, 'triangles', EvaluateDpoitShaderCode, schema, values);

    return createComputeRenderable(renderItem, values);
}

export class DpoitPass {

    private readonly DEPTH_CLEAR_VALUE = -99999.0;
    private readonly MAX_DEPTH = 1.0;
    private readonly MIN_DEPTH = 0.0;

    private passCount = 0;
    private writeId: number;
    private readId: number;

    private readonly blendBackRenderable: BlendBackDpoitRenderable;
    private readonly renderable: EvaluateDpoitRenderable;

    private readonly depthFramebuffers: Framebuffer[];
    private readonly colorFramebuffers: Framebuffer[];
    private readonly blendBackFramebuffer: Framebuffer;

    private readonly depthTextures: Texture[];
    private readonly colorFrontTextures: Texture[];
    private readonly colorBackTextures: Texture[];
    private readonly blendBackTexture: Texture;

    private _supported = false;
    get supported() {
        return this._supported;
    }

    bind() {
        const { state, gl, extensions: { blendMinMax, drawBuffers } } = this.webgl;

        // initialize
        this.passCount = 0;

        this.blendBackFramebuffer.bind();
        state.clearColor(0, 0, 0, 0); // correct blending when texture is cleared with background color (for example state.clearColor(1,1,1,0) on white background)
        gl.clear(gl.COLOR_BUFFER_BIT);

        this.depthFramebuffers[0].bind();
        drawBuffers!.drawBuffers([gl.NONE, gl.NONE, drawBuffers!.COLOR_ATTACHMENT2]);
        state.clearColor(this.DEPTH_CLEAR_VALUE, this.DEPTH_CLEAR_VALUE, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        this.depthFramebuffers[1].bind();
        state.clearColor(-this.MIN_DEPTH, this.MAX_DEPTH, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        this.colorFramebuffers[0].bind();
        state.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        this.colorFramebuffers[1].bind();
        state.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        this.depthFramebuffers[0].bind();
        // rawBuffers!.drawBuffers([gl.NONE, gl.NONE, drawBuffers!.COLOR_ATTACHMENT2]);
        state.blendEquation(blendMinMax!.MAX);

        return { depth: this.depthTextures[1], frontColor: this.colorFrontTextures[1], backColor: this.colorBackTextures[1] };
    }

    bindDualDepthPeeling() {
        const { state, gl, extensions: { blendMinMax, drawBuffers } } = this.webgl;

        this.readId = this.passCount % 2;
        this.writeId = 1 - this.readId; // ping-pong: 0 or 1

        this.passCount += 1; // increment for next pass

        this.depthFramebuffers[this.writeId].bind();
        drawBuffers!.drawBuffers([gl.NONE, gl.NONE, drawBuffers!.COLOR_ATTACHMENT2]);
        state.clearColor(this.DEPTH_CLEAR_VALUE, this.DEPTH_CLEAR_VALUE, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        this.colorFramebuffers[this.writeId].bind();
        state.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        this.depthFramebuffers[this.writeId].bind();
        drawBuffers!.drawBuffers([drawBuffers!.COLOR_ATTACHMENT0, drawBuffers!.COLOR_ATTACHMENT1, drawBuffers!.COLOR_ATTACHMENT2]);
        state.blendEquation(blendMinMax!.MAX);

        return { depth: this.depthTextures[this.readId], frontColor: this.colorFrontTextures[this.readId], backColor: this.colorBackTextures[this.readId] };
    }

    bindBlendBack() {
        const { state, gl } = this.webgl;

        this.blendBackFramebuffer.bind();
        state.blendEquation(gl.FUNC_ADD);
    }

    renderBlendBack() {
        if (isTimingMode) this.webgl.timer.mark('DpoitPass.renderBlendBack');
        const { state, gl } = this.webgl;

        state.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

        ValueCell.update(this.blendBackRenderable.values.tDpoitBackColor, this.colorBackTextures[this.writeId]);

        this.blendBackRenderable.update();
        this.blendBackRenderable.render();
        if (isTimingMode) this.webgl.timer.markEnd('DpoitPass.renderBlendBack');
    }

    render() {
        if (isTimingMode) this.webgl.timer.mark('DpoitPass.render');
        const { state, gl } = this.webgl;

        state.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

        ValueCell.update(this.renderable.values.tDpoitFrontColor, this.colorFrontTextures[this.writeId]);
        ValueCell.update(this.renderable.values.tDpoitBlendBackColor, this.blendBackTexture);

        this.renderable.update();
        this.renderable.render();
        if (isTimingMode) this.webgl.timer.markEnd('DpoitPass.render');
    }

    setSize(width: number, height: number) {
        const [w, h] = this.renderable.values.uTexSize.ref.value;
        if (width !== w || height !== h) {
            for (let i = 0; i < 2; i++) {
                this.depthTextures[i].define(width, height);
                this.colorFrontTextures[i].define(width, height);
                this.colorBackTextures[i].define(width, height);
            }
            this.blendBackTexture.define(width, height);
            ValueCell.update(this.renderable.values.uTexSize, Vec2.set(this.renderable.values.uTexSize.ref.value, width, height));
            ValueCell.update(this.blendBackRenderable.values.uTexSize, Vec2.set(this.blendBackRenderable.values.uTexSize.ref.value, width, height));
        }
    }

    reset() {
        if (this._supported) this._init();
    }

    private _init() {
        const { extensions: { drawBuffers } } = this.webgl;
        for (let i = 0; i < 2; i++) {
            // depth
            this.depthFramebuffers[i].bind();
            this.depthTextures[i].attachFramebuffer(this.depthFramebuffers[i], 'color2');
            this.colorFrontTextures[i].attachFramebuffer(this.depthFramebuffers[i], 'color0');
            this.colorBackTextures[i].attachFramebuffer(this.depthFramebuffers[i], 'color1');

            // color
            this.colorFramebuffers[i].bind();
            drawBuffers!.drawBuffers([drawBuffers!.COLOR_ATTACHMENT0, drawBuffers!.COLOR_ATTACHMENT1]);
            this.colorFrontTextures[i].attachFramebuffer(this.colorFramebuffers[i], 'color0');
            this.colorBackTextures[i].attachFramebuffer(this.colorFramebuffers[i], 'color1');
        }

        // blend back
        this.blendBackFramebuffer.bind();
        drawBuffers!.drawBuffers([drawBuffers!.COLOR_ATTACHMENT0]);
        this.blendBackTexture.attachFramebuffer(this.blendBackFramebuffer, 'color0');
    }

    static isSupported(webgl: WebGLContext) {
        const { extensions: { drawBuffers, textureFloat, colorBufferFloat, blendMinMax } } = webgl;
        if (!textureFloat || !colorBufferFloat || !drawBuffers || !blendMinMax) {
            if (isDebugMode) {
                const missing: string[] = [];
                if (!textureFloat) missing.push('textureFloat');
                if (!colorBufferFloat) missing.push('colorBufferFloat');
                if (!drawBuffers) missing.push('drawBuffers');
                if (!blendMinMax) missing.push('blendMinMax');
                console.log(`Missing "${missing.join('", "')}" extensions required for "dpoit"`);
            }
            return false;
        } else {
            return true;
        }
    }

    constructor(private webgl: WebGLContext, width: number, height: number) {
        if (!DpoitPass.isSupported(webgl)) return;

        const { resources } = webgl;

        // textures
        this.depthTextures = [
            resources.texture('image-float32', 'rg', 'float', 'nearest'),
            resources.texture('image-float32', 'rg', 'float', 'nearest')
        ];
        this.depthTextures[0].define(width, height);
        this.depthTextures[1].define(width, height);

        this.colorFrontTextures = [
            resources.texture('image-float32', 'rgba', 'float', 'nearest'),
            resources.texture('image-float32', 'rgba', 'float', 'nearest')
        ];
        this.colorFrontTextures[0].define(width, height);
        this.colorFrontTextures[1].define(width, height);

        this.colorBackTextures = [
            resources.texture('image-float32', 'rgba', 'float', 'nearest'),
            resources.texture('image-float32', 'rgba', 'float', 'nearest')
        ];
        this.colorBackTextures[0].define(width, height);
        this.colorBackTextures[1].define(width, height);

        this.blendBackTexture = resources.texture('image-float32', 'rgba', 'float', 'nearest');
        this.blendBackTexture.define(width, height);

        // framebuffers
        this.depthFramebuffers = [resources.framebuffer(), resources.framebuffer()];
        this.colorFramebuffers = [resources.framebuffer(), resources.framebuffer()];
        this.blendBackFramebuffer = resources.framebuffer();

        this.blendBackRenderable = getBlendBackDpoitRenderable(webgl, this.colorBackTextures[0]);

        this.renderable = getEvaluateDpoitRenderable(webgl, this.colorFrontTextures[0], this.blendBackTexture);

        this._supported = true;
        this._init();
    }
}
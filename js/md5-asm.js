/* 
 * md5Mesh.js - Parses MD5 Mesh and Animation files (idTech 4) for use in WebGL
 */
 
/*
 * Copyright (c) 2011 Brandon Jones
 * Copyright (c) 2015 Ningxin Hu
 *
 * This software is provided 'as-is', without any express or implied
 * warranty. In no event will the authors be held liable for any damages
 * arising from the use of this software.
 *
 * Permission is granted to anyone to use this software for any purpose,
 * including commercial applications, and to alter it and redistribute it
 * freely, subject to the following restrictions:
 *
 *    1. The origin of this software must not be misrepresented; you must not
 *    claim that you wrote the original software. If you use this software
 *    in a product, an acknowledgment in the product documentation would be
 *    appreciated but is not required.
 *
 *    2. Altered source versions must be plainly marked as such, and must not
 *    be misrepresented as being the original software.
 *
 *    3. This notice may not be removed or altered from any source
 *    distribution.
 */

define([
    "util/gl-util",
    "util/gl-matrix-min"
], function(glUtil) {

    "use strict";

    var BASE_PATH = "root/"
    var MAX_WEIGHTS = 6;
    var VERTEX_ELEMENTS = 11; // 3 Pos, 2 UV, 3 Norm, 3 Tangent
    var VERTEX_STRIDE = 44;

    var useSIMD = false;

    var setSIMD = function(set) {
        useSIMD = set;
    }
    
    var Md5Mesh = function() {
        this.simd = false
        this.joints = null;
        this.meshes = null;
        this.pos = vec3.create([0.0, 0.0, 0.0]);
        this.mesh_texture_loaded = 0;
        this.buffer = new ArrayBuffer(1 * 1024 * 1024);
        this.f32Array = new Float32Array(this.buffer);
        this.i32Array = new Int32Array(this.buffer);
        this.asmSkin = _asmjsModule(window, null, this.buffer).asmSkin;
        this.asmSkinSIMD = _asmjsModule(window, null, this.buffer).asmSkinSIMD;
        this.asmGetFrameJoints = _asmjsModule(window, null, this.buffer).asmGetFrameJoints;
        this.jointsArray = null;
        this.jointsArrayOffset = 0;
        this.animationBase = 0;
    }; 

    Md5Mesh.prototype.load = function(gl, url, callback) {
        this.joints = new Array();
        this.meshes = new Array();
        
        var self = this;
        
        var request = new XMLHttpRequest();
        request.addEventListener("load", function() {
            self._parse(request.responseText);
            self._initializeTextures(gl, function() {
                self._initializeBuffers(gl);
                if(callback) callback(self);
            });
        });
        request.open('GET', BASE_PATH + url, true);
        request.overrideMimeType('text/plain');
        request.setRequestHeader('Content-Type', 'text/plain');
        request.send(null);

        return this;
    };

    /*
     * Md5Mesh
     */

    Md5Mesh.prototype._parse = function(src) {
        var model = this;
        var jointsOffset = 0;
        src.replace(/joints \{([^}]*)\}/m, function($0, jointSrc) {
            jointSrc.replace(/\"(.+)\"\s(.+) \( (.+) (.+) (.+) \) \( (.+) (.+) (.+) \)/g, function($0, name, parent, x, y, z, ox, oy, oz) {
                model.joints.push({
                    name: name,
                    parent: parseInt(parent), 
                    pos: [parseFloat(x), parseFloat(y), parseFloat(z)], 
                    orient: quat4.calculateW([parseFloat(ox), parseFloat(oy), parseFloat(oz), 0]),
                });
            });
        });

        src.replace(/mesh \{([^}]*)\}/mg, function($0, meshSrc) {
            var mesh = {
                shader: '',
                verts: new Array(),
                tris: new Array(),
                weights: new Array(),
                vertBuffer: null,
                indexBuffer: null,
                vertArray: null,
                elementCount: 0
            };

            meshSrc.replace(/shader \"(.+)\"/, function($0, shader) {
                mesh.shader = shader;
            });

            meshSrc.replace(/vert .+ \( (.+) (.+) \) (.+) (.+)/g, function($0, u, v, weightIndex, weightCount) {
                mesh.verts.push({
                    pos: [0, 0, 0],
                    normal: [0, 0, 0],
                    tangent: [0, 0, 0],
                    texCoord: new Float32Array([parseFloat(u), parseFloat(v), 0, 0]),
                    weight: {
                        index: parseInt(weightIndex), 
                        count: parseInt(weightCount)
                    }
                });
            });

            mesh.tris = new Array();
            meshSrc.replace(/tri .+ (.+) (.+) (.+)/g, function($0, i1, i2, i3) {
                mesh.tris.push(parseInt(i1));
                mesh.tris.push(parseInt(i2));
                mesh.tris.push(parseInt(i3));
            });
            mesh.elementCount = mesh.tris.length;

            var weightsOffset = 0;
            meshSrc.replace(/weight .+ (.+) (.+) \( (.+) (.+) (.+) \)/g, function($0, joint, bias, x, y, z) {
                mesh.weights.push({
                    joint: parseInt(joint), 
                    bias: parseFloat(bias), 
                    pos: [parseFloat(x), parseFloat(y), parseFloat(z)],
                    normal: [0, 0, 0],
                    tangent: [0, 0, 0],
                });
            });

            model._compile(mesh);

            model.meshes.push(mesh);
        });
    };
    
    Md5Mesh.prototype._compile = function(mesh) {
        var joints = this.joints;
        var rotatedPos = [0, 0, 0];

        // Calculate transformed vertices in the bind pose
        for(var i = 0; i < mesh.verts.length; ++i) {
            var vert = mesh.verts[i];

            vert.pos = [0, 0, 0];
            for (var j = 0; j < vert.weight.count; ++j) {
                var weight = mesh.weights[vert.weight.index + j];
                var joint = joints[weight.joint];

                // Rotate position
                quat4.multiplyVec3(joint.orient, weight.pos, rotatedPos);

                // Translate position
                // The sum of all weight biases should be 1.0
                vert.pos[0] += (joint.pos[0] + rotatedPos[0]) * weight.bias;
                vert.pos[1] += (joint.pos[1] + rotatedPos[1]) * weight.bias;
                vert.pos[2] += (joint.pos[2] + rotatedPos[2]) * weight.bias;
            }
        }

        // Calculate normals/tangents
        var a = [0, 0, 0], b = [0, 0, 0];
        var triNormal = [0, 0, 0];
        var triTangent = [0, 0, 0];
        for(var i = 0; i < mesh.tris.length; i+=3) {
            var vert1 = mesh.verts[mesh.tris[i]];
            var vert2 = mesh.verts[mesh.tris[i+1]];
            var vert3 = mesh.verts[mesh.tris[i+2]];

            // Normal
            vec3.subtract(vert2.pos, vert1.pos, a);
            vec3.subtract(vert3.pos, vert1.pos, b);

            vec3.cross(b, a, triNormal);
            vec3.add(vert1.normal, triNormal);
            vec3.add(vert2.normal, triNormal);
            vec3.add(vert3.normal, triNormal);

            // Tangent
            var c2c1t = vert2.texCoord[0] - vert1.texCoord[0];
            var c2c1b = vert2.texCoord[1] - vert1.texCoord[1];
            var c3c1t = vert3.texCoord[0] - vert1.texCoord[0];
            var c3c1b = vert3.texCoord[0] - vert1.texCoord[1];

            triTangent = [c3c1b * a[0] - c2c1b * b[0], c3c1b * a[1] - c2c1b * b[1], c3c1b * a[2] - c2c1b * b[2]];
            vec3.add(vert1.tangent, triTangent);
            vec3.add(vert2.tangent, triTangent);
            vec3.add(vert3.tangent, triTangent);
        }

        var invOrient = [0, 0, 0, 0];
        // Get the "weighted" normal and tangent
        for(var i = 0; i < mesh.verts.length; ++i) {
            var vert = mesh.verts[i];

            vec3.normalize(vert.normal);
            vec3.normalize(vert.tangent);

            for (var j = 0; j < vert.weight.count; ++j) {
                var weight = mesh.weights[vert.weight.index + j];
                if(weight.bias != 0) {
                    var joint = joints[weight.joint];

                    // Rotate position
                    quat4.inverse(joint.orient, invOrient);
                    quat4.multiplyVec3(invOrient, vert.normal, weight.normal);
                    quat4.multiplyVec3(invOrient, vert.tangent, weight.tangent);
                }
            }
        }
    };
    
    Md5Mesh.prototype._initializeTextures = function(gl, callback) {
        var self = this;
        var mesh_texture_loaded = 0;
        for(var i = 0; i < this.meshes.length; ++i) {
            var mesh = this.meshes[i];

            // Set defaults
            mesh.diffuseMap = glUtil.createSolidTexture(gl, [200, 200, 200, 255]);
            mesh.specularMap = glUtil.createSolidTexture(gl, [0, 0, 0, 255]);
            mesh.normalMap = glUtil.createSolidTexture(gl, [0, 0, 255, 255]);
            
            this._loadMeshTextures(gl, mesh, function() {
                mesh_texture_loaded++;
                if (mesh_texture_loaded == self.meshes.length) {
                    if (callback) callback();
                }
            });
        }
    };
    
    // Finds the meshes texures
    // Confession: Okay, so this function is a big giant cheat... 
    // but have you SEEN how those mtr files are structured?
    Md5Mesh.prototype._loadMeshTextures = function(gl, mesh, callback) {
        // Attempt to load actual textures
        var simd = '';
        if (this.simd)
            simd = '_simd';
        glUtil.loadTexture(gl, BASE_PATH + mesh.shader + simd + '.png', function(texture) {
            mesh.diffuseMap = texture;
            glUtil.loadTexture(gl, BASE_PATH + mesh.shader + '_s.png', function(texture) {
                mesh.specularMap = texture;
                glUtil.loadTexture(gl, BASE_PATH + mesh.shader + '_local.png', function(texture) {
                    mesh.normalMap = texture;
                    if (callback) callback();
                });
            });
        });
    };

    Md5Mesh.prototype._initializeArrayBuffer = function() {
        var f32Array = this.f32Array;
        var i32Array = this.i32Array;
        var numOfVerts = 0;
        // layout: meshesBase, meshesLength, jointsBase, jointsLength, vertArrayBase
        const MESHES_BASE = 5;
        i32Array[0] = MESHES_BASE; // meshes base
        i32Array[1] = this.meshes.length;
        i32Array[2] = 0; // joints base
        i32Array[3] = this.joints.length;
        i32Array[4] = 0; // vertArray base
        // layout: base of each mesh
        var offset = MESHES_BASE + this.meshes.length; // bases of each mesh
        for(var i = 0; i < this.meshes.length; ++i) {
            var mesh = this.meshes[i];
            // set base of mesh
            i32Array[MESHES_BASE + i] = offset;
            // layout: vertOffset, vertsBase, vertsLength, weightsBase, weightsLength
            i32Array[offset++] = mesh.offset;
            var vertsBaseOffset = offset++;
            i32Array[offset++] = mesh.verts.length;
            var weightsBaseOffset = offset++;
            i32Array[offset++] = mesh.weights.length;
            i32Array[vertsBaseOffset] = offset;
            for(var j = 0; j < mesh.verts.length; ++j) {
                numOfVerts++;
                var vert = mesh.verts[j];
                f32Array[offset++] = vert.texCoord[0];
                f32Array[offset++] = vert.texCoord[1];
                i32Array[offset++] = vert.weight.index;
                i32Array[offset++] = vert.weight.count;
            }
            i32Array[weightsBaseOffset] = offset;
            for (var j = 0; j < mesh.weights.length; ++j) {
                var weight = mesh.weights[j];
                i32Array[offset++] = weight.joint;
                f32Array[offset++] = weight.bias;
                f32Array[offset++] = weight.pos[0];
                f32Array[offset++] = weight.pos[1];
                f32Array[offset++] = weight.pos[2];
                f32Array[offset++] = 0;
                f32Array[offset++] = weight.normal[0];
                f32Array[offset++] = weight.normal[1];
                f32Array[offset++] = weight.normal[2];
                f32Array[offset++] = 0;
                f32Array[offset++] = weight.tangent[0];
                f32Array[offset++] = weight.tangent[1];
                f32Array[offset++] = weight.tangent[2];
                f32Array[offset++] = 0;
            }
        }

        i32Array[2] = offset; // joints base;
        this.jointsArrayOffset = offset;
        this.jointsArray = new Float32Array(this.buffer, offset * 4);

        i32Array[offset++] = this.joints.length;
        for (var i = 0; i < this.joints.length; ++i) {
            var joint = this.joints[i];
            f32Array[offset++] = joint.pos[0];
            f32Array[offset++] = joint.pos[1];
            f32Array[offset++] = joint.pos[2];
            f32Array[offset++] = 0;
            f32Array[offset++] = joint.orient[0];
            f32Array[offset++] = joint.orient[1];
            f32Array[offset++] = joint.orient[2];
            f32Array[offset++] = joint.orient[3];
        }

        i32Array[4] = offset; // vertArray base;
        f32Array[offset] = 1;
        f32Array[offset+1] = 2;
        f32Array[offset+2] = 3;
        this.vertArray = new Float32Array(this.buffer, offset * 4, numOfVerts * VERTEX_ELEMENTS);
        
        this.animationBase = offset + numOfVerts * VERTEX_ELEMENTS + 1;
    }
        
    // Creates the model's gl buffers and populates them with the bind-pose mesh
    Md5Mesh.prototype._initializeBuffers = function(gl) {
        var meshes = this.meshes;
        var i;
        
        var vertBufferLength = 0;
        var indexBufferLength = 0;
        for(i = 0; i < meshes.length; ++i) {
            var mesh = meshes[i];
            mesh.offset = vertBufferLength;
            vertBufferLength += VERTEX_ELEMENTS * mesh.verts.length;
            
            mesh.indexOffset = indexBufferLength;
            indexBufferLength += mesh.elementCount;
        } 

        this._initializeArrayBuffer();

        this.vertBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.vertArray, gl.STATIC_DRAW);
        
        // Fill the index buffer
        var indexArray = new Uint16Array(indexBufferLength);
        for(i = 0; i < meshes.length; ++i) {
            var mesh = meshes[i];
            indexArray.set(mesh.tris, mesh.indexOffset);
        }
        this.indexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indexArray, gl.STATIC_DRAW);
    };

    function _asmjsModule (global, imp, buffer) {
        "use asm";
        var f32Array = new global.Float32Array(buffer);
        var i32Array = new global.Int32Array(buffer);
        var u8Array = new global.Uint8Array(buffer);
        var imul = global.Math.imul;
        var toF = global.Math.fround;
        var sqrt = global.Math.sqrt;
        var abs = global.Math.abs;
        // TODO(ningxin): uncommet to once scalar version is done
        /*
        var SIMD_float32x4 = global.SIMD.float32x4;
        var SIMD_float32x4_load = SIMD_float32x4.load;
        var SIMD_float32x4_store = SIMD_float32x4.store;
        var SIMD_float32x4_mul = SIMD_float32x4.mul;
        var SIMD_float32x4_add = SIMD_float32x4.add;
        var SIMD_float32x4_sub = SIMD_float32x4.sub;
        var SIMD_float32x4_swizzle = SIMD_float32x4.swizzle;
        var SIMD_float32x4_loadX = SIMD_float32x4.loadX;
        var SIMD_float32x4_splat = SIMD_float32x4.splat;
        */
        const VERTEX_ELEMENTS = 11; // 3 Pos, 2 UV, 3 Norm, 3 Tangent
        const MESH_VERTEX_ELEMENTS = 4; // texCoord(f2), weight index (i1), weight count (i1)
        const MESH_WEIGHT_ELEMENTS = 14; // joint (i1), bias (f1), pos (f4), normal (f4), tangent (f4)
        const JOINT_ELEMENTS = 8; // pos (f4), orient (f4)
        
        const HIERARCHY_ELEMENTS = 3; // parent (i), flags (i), index (i)
        const BASEFRAME_ELEMENTS = 8; // pos (f4), orient (f4)
        const FRAME_ELEMENTS = 1; // value (f)

        function asmSkin() {
            var i = 0, j = 0, k = 0;
            var vx = toF(0), vy = toF(0), vz = toF(0),
                nx = toF(0), ny = toF(0), nz = toF(0),
                tx = toF(0), ty = toF(0), tz = toF(0),
                rx = toF(0), ry = toF(0), rz = toF(0),
                x = toF(0), y = toF(0), z = toF(0),
                qx = toF(0), qy = toF(0), qz = toF(0), qw = toF(0),
                ix = toF(0), iy = toF(0), iz = toF(0), iw = toF(0);

            var meshesBase = 0, meshesLength = 0,
                jointsBase = 0, jointsLength = 0,
                vertArrayBase = 0;

            var meshBase = 0, meshOffset = 0, vertsBase = 0, vertsLength = 0,
                weightsBase = 0, weightsLength = 0, vert = 0, vertWeightsCount = 0,
                vertWeightsIndex = 0, weight = 0, joint = 0, offset = 0,
                weightBias = toF(0), jointIndex = 0;

            meshesBase = i32Array[0]|0; meshesLength = i32Array[1]|0;
            jointsBase = i32Array[2]|0; jointsLength = i32Array[3]|0;
            vertArrayBase = i32Array[4]|0;
            
            for(i = 0; (i|0) < (meshesLength|0); i = (i + 1)|0) {
                meshBase = i32Array[((meshesBase + i)<<2)>>2]|0;
                meshOffset = ((i32Array[((meshBase)<<2)>>2]|0) + (vertArrayBase|0))|0;
                vertsBase = i32Array[((meshBase + 1)<<2)>>2]|0;
                vertsLength = i32Array[((meshBase + 2)<<2)>>2]|0
                weightsBase = i32Array[((meshBase + 3)<<2)>>2]|0;
                weightsLength = i32Array[((meshBase + 4)<<2)>>2]|0;

                // Calculate transformed vertices in the bind pose
                for(j = 0; (j|0) < (vertsLength|0); j = (j + 1)|0) {
                    offset = ((imul(j, VERTEX_ELEMENTS)|0) + (meshOffset|0))|0;
                    vert = ((vertsBase|0) + (imul(j, MESH_VERTEX_ELEMENTS)|0))|0;

                    vx = toF(0); vy = toF(0); vz = toF(0);
                    nx = toF(0); ny = toF(0); nz = toF(0);
                    tx = toF(0); ty = toF(0); tz = toF(0);

                    vertWeightsIndex = i32Array[((vert + 2)<<2)>>2]|0;
                    vertWeightsCount = i32Array[((vert + 3)<<2)>>2]|0;
                    for (k = 0; (k|0) < (vertWeightsCount|0); k = (k + 1)|0) {
                        weight = weightsBase + imul(k + vertWeightsIndex, MESH_WEIGHT_ELEMENTS)|0;
                        jointIndex = i32Array[((weight + 0)<<2)>>2]|0;
                        joint = jointsBase + imul(jointIndex, JOINT_ELEMENTS)|0;

                        // Rotate position
                        x = toF(f32Array[((weight + 2)<<2)>>2]);
                        y = toF(f32Array[((weight + 3)<<2)>>2]);
                        z = toF(f32Array[((weight + 4)<<2)>>2]);
                        qx = toF(f32Array[((joint + 4)<<2)>>2]);
                        qy = toF(f32Array[((joint + 5)<<2)>>2]);
                        qz = toF(f32Array[((joint + 6)<<2)>>2]);
                        qw = toF(f32Array[((joint + 7)<<2)>>2]);

                        // calculate quat * vec
                        ix = toF(toF(toF(toF(qw) * toF(x)) + toF(toF(qy) * toF(z))) - toF(toF(qz) * toF(y)));
                        iy = toF(toF(toF(toF(qw) * toF(y)) + toF(toF(qz) * toF(x))) - toF(toF(qx) * toF(z)));
                        iz = toF(toF(toF(toF(qw) * toF(z)) + toF(toF(qx) * toF(y))) - toF(toF(qy) * toF(x)));
                        iw = toF(toF(toF(toF(-qx) * toF(x)) - toF(toF(qy) * toF(y))) - toF(toF(qz) * toF(z)));

                        // calculate result * inverse quat
                        rx = toF(toF(toF(toF(ix) * toF(qw)) + toF(toF(iw) * toF(-qx))) + toF(toF(toF(iy) * toF(-qz)) - toF(toF(iz) * toF(-qy))));
                        ry = toF(toF(toF(toF(iy) * toF(qw)) + toF(toF(iw) * toF(-qy))) + toF(toF(toF(iz) * toF(-qx)) - toF(toF(ix) * toF(-qz))));
                        rz = toF(toF(toF(toF(iz) * toF(qw)) + toF(toF(iw) * toF(-qz))) + toF(toF(toF(ix) * toF(-qy)) - toF(toF(iy) * toF(-qx))));

                        // Translate position
                        weightBias = toF(f32Array[((weight + 1)<<2)>>2]);
                        vx = toF(toF(toF(toF(f32Array[((joint + 0)<<2)>>2]) + toF(rx)) * toF(weightBias)) + toF(vx));
                        vy = toF(toF(toF(toF(f32Array[((joint + 1)<<2)>>2]) + toF(ry)) * toF(weightBias)) + toF(vy));
                        vz = toF(toF(toF(toF(f32Array[((joint + 2)<<2)>>2]) + toF(rz)) * toF(weightBias)) + toF(vz));

                        // Rotate Normal
                        x = toF(f32Array[((weight + 6)<<2)>>2]);
                        y = toF(f32Array[((weight + 7)<<2)>>2]);
                        z = toF(f32Array[((weight + 8)<<2)>>2]);

                        // calculate quat * vec
                        ix = toF(toF(toF(toF(qw) * toF(x)) + toF(toF(qy) * toF(z))) - toF(toF(qz) * toF(y)));
                        iy = toF(toF(toF(toF(qw) * toF(y)) + toF(toF(qz) * toF(x))) - toF(toF(qx) * toF(z)));
                        iz = toF(toF(toF(toF(qw) * toF(z)) + toF(toF(qx) * toF(y))) - toF(toF(qy) * toF(x)));
                        iw = toF(toF(toF(toF(-qx) * toF(x)) - toF(toF(qy) * toF(y))) - toF(toF(qz) * toF(z)));

                        // calculate result * inverse quat
                        rx = toF(toF(toF(toF(ix) * toF(qw)) + toF(toF(iw) * toF(-qx))) + toF(toF(toF(iy) * toF(-qz)) - toF(toF(iz) * toF(-qy))));
                        ry = toF(toF(toF(toF(iy) * toF(qw)) + toF(toF(iw) * toF(-qy))) + toF(toF(toF(iz) * toF(-qx)) - toF(toF(ix) * toF(-qz))));
                        rz = toF(toF(toF(toF(iz) * toF(qw)) + toF(toF(iw) * toF(-qz))) + toF(toF(toF(ix) * toF(-qy)) - toF(toF(iy) * toF(-qx))));

                        nx = toF(toF(toF(rx) * toF(weightBias)) + toF(nx));
                        ny = toF(toF(toF(ry) * toF(weightBias)) + toF(ny));
                        nz = toF(toF(toF(rz) * toF(weightBias)) + toF(nz));

                        // Rotate Tangent
                        x = toF(f32Array[((weight + 10)<<2)>>2]);
                        y = toF(f32Array[((weight + 11)<<2)>>2]);
                        z = toF(f32Array[((weight + 12)<<2)>>2]);

                        // calculate quat * vec
                        ix = toF(toF(toF(toF(qw) * toF(x)) + toF(toF(qy) * toF(z))) - toF(toF(qz) * toF(y)));
                        iy = toF(toF(toF(toF(qw) * toF(y)) + toF(toF(qz) * toF(x))) - toF(toF(qx) * toF(z)));
                        iz = toF(toF(toF(toF(qw) * toF(z)) + toF(toF(qx) * toF(y))) - toF(toF(qy) * toF(x)));
                        iw = toF(toF(toF(toF(-qx) * toF(x)) - toF(toF(qy) * toF(y))) - toF(toF(qz) * toF(z)));

                        // calculate result * inverse quat
                        rx = toF(toF(toF(toF(ix) * toF(qw)) + toF(toF(iw) * toF(-qx))) + toF(toF(toF(iy) * toF(-qz)) - toF(toF(iz) * toF(-qy))));
                        ry = toF(toF(toF(toF(iy) * toF(qw)) + toF(toF(iw) * toF(-qy))) + toF(toF(toF(iz) * toF(-qx)) - toF(toF(ix) * toF(-qz))));
                        rz = toF(toF(toF(toF(iz) * toF(qw)) + toF(toF(iw) * toF(-qz))) + toF(toF(toF(ix) * toF(-qy)) - toF(toF(iy) * toF(-qx))));

                        tx = toF(toF(toF(rx) * toF(weightBias)) + toF(tx));
                        ty = toF(toF(toF(ry) * toF(weightBias)) + toF(ty));
                        tz = toF(toF(toF(rz) * toF(weightBias)) + toF(tz));
                    }

                    // Position
                    f32Array[((offset)<<2)>>2] = vx;
                    f32Array[((offset+1)<<2)>>2] = vy;
                    f32Array[((offset+2)<<2)>>2] = vz;

                    // TexCoord
                    f32Array[((offset+3)<<2)>>2] = f32Array[((vert + 0)<<2)>>2];
                    f32Array[((offset+4)<<2)>>2] = f32Array[((vert + 1)<<2)>>2];

                    // Normal
                    f32Array[((offset+5)<<2)>>2] = nx;
                    f32Array[((offset+6)<<2)>>2] = ny;
                    f32Array[((offset+7)<<2)>>2] = nz;

                    // Tangent
                    f32Array[((offset+8)<<2)>>2] = tx;
                    f32Array[((offset+9)<<2)>>2] = ty;
                    f32Array[((offset+10)<<2)>>2] = tz;
                }
            }
        }

        function asmSkinSIMD() {
            // TODO(nhu): uncomment once scalar version is done
            /*
            var i = 0, j = 0, k = 0;
            var meshesBase = 0, meshesLength = 0,
                jointsBase = 0, jointsLength = 0,
                vertArrayBase = 0;

            var meshBase = 0, meshOffset = 0, vertsBase = 0, vertsLength = 0,
                weightsBase = 0, weightsLength = 0, vert = 0, vertWeightsCount = 0,
                vertWeightsIndex = 0, weight = 0, joint = 0, offset = 0, jointIndex = 0;

                
            var rotatedPos = SIMD_float32x4(0, 0, 0, 0), jointOrient = SIMD_float32x4(0, 0, 0, 0),
                weightPos = SIMD_float32x4(0, 0, 0, 0), ix4 = SIMD_float32x4(0, 0, 0, 0),
                jointPos = SIMD_float32x4(0, 0, 0, 0), weightBias = SIMD_float32x4(0, 0, 0, 0),
                vx4 = SIMD_float32x4(0, 0, 0, 0), weightNormal = SIMD_float32x4(0, 0, 0, 0),
                nx4 = SIMD_float32x4(0, 0, 0, 0), weightTangent = SIMD_float32x4(0, 0, 0, 0),
                tempx4 = SIMD_float32x4(1, 1, 1, -1), tx4 = SIMD_float32x4(0, 0, 0, 0);

            meshesBase = i32Array[0]|0; meshesLength = i32Array[1]|0;
            jointsBase = i32Array[2]|0; jointsLength = i32Array[3]|0;
            vertArrayBase = i32Array[4]|0;
            
            for(i = 0; (i|0) < (meshesLength|0); i = (i + 1)|0) {
                meshBase = i32Array[((meshesBase + i)<<2)>>2]|0;
                meshOffset = ((i32Array[((meshBase)<<2)>>2]|0) + (vertArrayBase|0))|0;
                vertsBase = i32Array[((meshBase + 1)<<2)>>2]|0;
                vertsLength = i32Array[((meshBase + 2)<<2)>>2]|0;
                weightsBase = i32Array[((meshBase + 3)<<2)>>2]|0;
                weightsLength = i32Array[((meshBase + 4)<<2)>>2]|0;
                
                // Calculate transformed vertices in the bind pose
                for(j = 0; (j|0) < (vertsLength|0); j = (j + 1)|0) {
                    offset = ((imul(j, VERTEX_ELEMENTS)|0) + (meshOffset|0))|0;
                    vert = ((vertsBase|0) + (imul(j, MESH_VERTEX_ELEMENTS)|0))|0;
                    
                    vx4 = SIMD_float32x4_splat(toF(0));
                    nx4 = SIMD_float32x4_splat(toF(0));
                    tx4 = SIMD_float32x4_splat(toF(0));

                    vertWeightsIndex = i32Array[((vert + 2)<<2)>>2]|0;
                    vertWeightsCount = i32Array[((vert + 3)<<2)>>2]|0;
                    for (k = 0; (k|0) < (vertWeightsCount|0); k = (k + 1)|0) {
                        weight = weightsBase + imul(k + vertWeightsIndex, MESH_WEIGHT_ELEMENTS)|0;
                        jointIndex = i32Array[((weight + 0)<<2)>>2]|0;
                        joint = jointsBase + imul(jointIndex, JOINT_ELEMENTS)|0;

                        // Rotate position
                        jointOrient = SIMD_float32x4_load(u8Array, (joint + 4)<<2);
                        weightPos = SIMD_float32x4_load(u8Array, (weight + 2)<<2);
                        ix4 = SIMD_float32x4_sub(
                            SIMD_float32x4_add(
                                SIMD_float32x4_mul(SIMD_float32x4_mul(SIMD_float32x4_swizzle(jointOrient, 3, 3, 3, 0), tempx4),
                                                   SIMD_float32x4_swizzle(weightPos, 0, 1, 2, 0)),
                                SIMD_float32x4_mul(SIMD_float32x4_mul(SIMD_float32x4_swizzle(jointOrient, 1, 2, 0, 1), tempx4),
                                                   SIMD_float32x4_swizzle(weightPos, 2, 0, 1, 1))),
                            SIMD_float32x4_mul(SIMD_float32x4_swizzle(jointOrient, 2, 0, 1, 2),
                                               SIMD_float32x4_swizzle(weightPos, 1, 2, 0, 2)));
    
                        rotatedPos = SIMD_float32x4_add(
                            SIMD_float32x4_sub(SIMD_float32x4_mul(ix4, SIMD_float32x4_swizzle(jointOrient, 3, 3, 3, 0)),
                                               SIMD_float32x4_mul(SIMD_float32x4_swizzle(ix4, 3, 3, 3, 0), jointOrient)),
                            SIMD_float32x4_sub(SIMD_float32x4_mul(SIMD_float32x4_swizzle(ix4, 2, 0, 1, 0), SIMD_float32x4_swizzle(jointOrient, 1, 2, 0, 0)),
                                               SIMD_float32x4_mul(SIMD_float32x4_swizzle(ix4, 1, 2, 0, 0), SIMD_float32x4_swizzle(jointOrient, 2, 0, 1, 0))));
    
                        jointPos = SIMD_float32x4_load(u8Array, (joint + 0)<<2);
                        weightBias = SIMD_float32x4_swizzle(SIMD_float32x4_loadX(u8Array, (weight + 1)<<2), 0, 0, 0, 0);
    
                        // Translate position
                        vx4 = SIMD_float32x4_add(vx4, SIMD_float32x4_mul(SIMD_float32x4_add(jointPos, rotatedPos), weightBias));
    
                        // Rotate Normal
                        weightNormal = SIMD_float32x4_load(u8Array, (weight + 6)<<2);
                        ix4 = SIMD_float32x4_sub(
                            SIMD_float32x4_add(
                                SIMD_float32x4_mul(SIMD_float32x4_mul(SIMD_float32x4_swizzle(jointOrient, 3, 3, 3, 0), tempx4),
                                                   SIMD_float32x4_swizzle(weightNormal, 0, 1, 2, 0)),
                                SIMD_float32x4_mul(SIMD_float32x4_mul(SIMD_float32x4_swizzle(jointOrient, 1, 2, 0, 1), tempx4),
                                                   SIMD_float32x4_swizzle(weightNormal, 2, 0, 1, 1))),
                            SIMD_float32x4_mul(SIMD_float32x4_swizzle(jointOrient, 2, 0, 1, 2),
                                               SIMD_float32x4_swizzle(weightNormal, 1, 2, 0, 2)));
    
                        rotatedPos = SIMD_float32x4_add(
                            SIMD_float32x4_sub(SIMD_float32x4_mul(ix4, SIMD_float32x4_swizzle(jointOrient, 3, 3, 3, 0)),
                                               SIMD_float32x4_mul(SIMD_float32x4_swizzle(ix4, 3, 3, 3, 0), jointOrient)),
                            SIMD_float32x4_sub(SIMD_float32x4_mul(SIMD_float32x4_swizzle(ix4, 2, 0, 1, 0), SIMD_float32x4_swizzle(jointOrient, 1, 2, 0, 0)),
                                               SIMD_float32x4_mul(SIMD_float32x4_swizzle(ix4, 1, 2, 0, 0), SIMD_float32x4_swizzle(jointOrient, 2, 0, 1, 0))));
    
                        nx4 = SIMD_float32x4_add(nx4, SIMD_float32x4_mul(rotatedPos, weightBias))
    
                        // Rotate Tangent
                        weightTangent = SIMD_float32x4_load(u8Array, (weight + 10)<<2);
                        ix4 = SIMD_float32x4_sub(
                            SIMD_float32x4_add(
                                SIMD_float32x4_mul(SIMD_float32x4_mul(SIMD_float32x4_swizzle(jointOrient, 3, 3, 3, 0), tempx4),
                                                   SIMD_float32x4_swizzle(weightTangent, 0, 1, 2, 0)),
                                SIMD_float32x4_mul(SIMD_float32x4_mul(SIMD_float32x4_swizzle(jointOrient, 1, 2, 0, 1), tempx4),
                                                   SIMD_float32x4_swizzle(weightTangent, 2, 0, 1, 1))),
                            SIMD_float32x4_mul(SIMD_float32x4_swizzle(jointOrient, 2, 0, 1, 2),
                                               SIMD_float32x4_swizzle(weightTangent, 1, 2, 0, 2)));
    
                        rotatedPos = SIMD_float32x4_add(
                            SIMD_float32x4_sub(SIMD_float32x4_mul(ix4, SIMD_float32x4_swizzle(jointOrient, 3, 3, 3, 0)),
                                               SIMD_float32x4_mul(SIMD_float32x4_swizzle(ix4, 3, 3, 3, 0), jointOrient)),
                            SIMD_float32x4_sub(SIMD_float32x4_mul(SIMD_float32x4_swizzle(ix4, 2, 0, 1, 0), SIMD_float32x4_swizzle(jointOrient, 1, 2, 0, 0)),
                                               SIMD_float32x4_mul(SIMD_float32x4_swizzle(ix4, 1, 2, 0, 0), SIMD_float32x4_swizzle(jointOrient, 2, 0, 1, 0))));
    
                        tx4 = SIMD_float32x4_add(tx4, SIMD_float32x4_mul(rotatedPos, weightBias))
                    }
    
                    // Position
                    SIMD_float32x4_store(u8Array, offset<<2, vx4);
    
                    // TexCoord
                    SIMD_float32x4_store(u8Array, (offset + 3)<<2, SIMD_float32x4_load(u8Array, (vert + 0)<<2));
    
                    // Normal
                    SIMD_float32x4_store(u8Array, (offset + 5)<<2, nx4);
    
                    // Tangent
                    SIMD_float32x4_store(u8Array, (offset + 8)<<2, tx4);
                }
            }
            */
        }
        
        function asmGetFrameJoints(frame, animationBase, jointsBase) {
            frame = frame|0;
            animationBase = animationBase|0;
            jointsBase = jointsBase|0;
            
            var i = 0, j = 0,
                baseFrameLength = 0, baseFrameBase = 0,
                hierarchyLength = 0, hierarchyBase = 0,
                framesArrayLength = 0, framesArrayBase = 0, framesBase = 0,
                baseJointOffset = 0, hierarchyOffset = 0, frameIndex = 0, parentIndex = 0,
                flags = 0,
                posX = toF(0.0), posY = toF(0.0), posZ = toF(0.0), parentPosX = toF(0.0), parentPosY = toF(0.0), parentPosZ = toF(0.0),
                orientX = toF(0.0), orientY = toF(0.0), orientZ = toF(0.0), orientW = toF(0.0),
                parentOrientX = toF(0.0), parentOrientY = toF(0.0), parentOrientZ = toF(0.0), parentOrientW = toF(0.0),
                ix = toF(0.0), iy = toF(0.0), iz = toF(0.0), iw = toF(0.0),
                jointsOffset = 0,
                temp = toF(0.0);
            
            hierarchyBase = i32Array[((animationBase + 0)<<2)>>2]|0;
            hierarchyLength = i32Array[((animationBase + 1)<<2)>>2]|0;
            baseFrameBase = i32Array[((animationBase + 2)<<2)>>2]|0;
            baseFrameLength = i32Array[((animationBase + 3)<<2)>>2]|0;
            framesArrayBase = i32Array[((animationBase + 4)<<2)>>2]|0;
            framesArrayLength = i32Array[((animationBase + 5)<<2)>>2]|0;
            
            frame = ((frame|0) % (framesArrayLength|0))|0;
            framesBase = i32Array[((framesArrayBase + (imul(frame, 2)|0)|0)<<2)>>2]|0;
            
            for (i = 0; (i|0) < (baseFrameLength|0); i = (i + 1)|0) {
                baseJointOffset = ((baseFrameBase|0) + (imul(i, BASEFRAME_ELEMENTS)|0))|0;
                posX = toF(f32Array[((baseJointOffset + 0)<<2)>>2]);
                posY = toF(f32Array[((baseJointOffset + 1)<<2)>>2]);
                posZ = toF(f32Array[((baseJointOffset + 2)<<2)>>2]);
                orientX = toF(f32Array[((baseJointOffset + 4)<<2)>>2]);
                orientY = toF(f32Array[((baseJointOffset + 5)<<2)>>2]);
                orientZ = toF(f32Array[((baseJointOffset + 6)<<2)>>2]);
                
                hierarchyOffset = ((hierarchyBase|0) + (imul(i, HIERARCHY_ELEMENTS)|0))|0;
                parentIndex = i32Array[((hierarchyOffset + 0)<<2)>>2]|0;
                flags = i32Array[((hierarchyOffset + 1)<<2)>>2]|0;
                frameIndex = i32Array[((hierarchyOffset + 2)<<2)>>2]|0;
                
                j = 0|0;
                
                if (flags & 1) { // Translate X
                    posX = toF(f32Array[((framesBase + frameIndex + j)<<2)>>2]);
                    j = (j + 1)|0;
                }
    
                if (flags & 2) { // Translate Y
                    posY = toF(f32Array[((framesBase + frameIndex + j)<<2)>>2]);
                    j = (j + 1)|0;
                }
    
                if (flags & 4) { // Translate Z
                    posZ = toF(f32Array[((framesBase + frameIndex + j)<<2)>>2]);
                    j = (j + 1)|0;
                }
    
                if (flags & 8) { // Orient X
                    orientX = toF(f32Array[((framesBase + frameIndex + j)<<2)>>2]);
                    j = (j + 1)|0;
                }
    
                if (flags & 16) { // Orient Y
                    orientY = toF(f32Array[((framesBase + frameIndex + j)<<2)>>2]);
                    j = (j + 1)|0;
                }
    
                if (flags & 32) { // Orient Z
                    orientZ = toF(f32Array[((framesBase + frameIndex + j)<<2)>>2]);
                    j = (j + 1)|0;
                }
                
                temp = toF(toF(toF(toF(1.0) - toF(orientX*orientX)) - toF(orientY*orientY)) - toF(orientZ*orientZ));
                orientW = toF(-sqrt(abs(+temp)));
                    
                if ((parentIndex|0) >= (0|0)) {
                    jointsOffset = ((jointsBase|0) + (imul(parentIndex, JOINT_ELEMENTS)|0))|0;
                    parentPosX = toF(f32Array[((jointsOffset + 0)<<2)>>2]);
                    parentPosY = toF(f32Array[((jointsOffset + 1)<<2)>>2]);
                    parentPosZ = toF(f32Array[((jointsOffset + 2)<<2)>>2]);
                    parentOrientX = toF(f32Array[((jointsOffset + 4)<<2)>>2]);
                    parentOrientY = toF(f32Array[((jointsOffset + 5)<<2)>>2]);
                    parentOrientZ = toF(f32Array[((jointsOffset + 6)<<2)>>2]);
                    parentOrientW = toF(f32Array[((jointsOffset + 7)<<2)>>2]);
                    
                    ix = toF(toF(toF(toF(parentOrientW) * toF(posX)) + toF(toF(parentOrientY) * toF(posZ))) - toF(toF(parentOrientZ) * toF(posY)));
                    iy = toF(toF(toF(toF(parentOrientW) * toF(posY)) + toF(toF(parentOrientZ) * toF(posX))) - toF(toF(parentOrientX) * toF(posZ)));
                    iz = toF(toF(toF(toF(parentOrientW) * toF(posZ)) + toF(toF(parentOrientX) * toF(posY))) - toF(toF(parentOrientY) * toF(posX)));
                    iw = toF(toF(toF(toF(-parentOrientX) * toF(posX)) - toF(toF(parentOrientY) * toF(posY))) - toF(toF(parentOrientZ) * toF(posZ)));

                    posX = toF(toF(toF(toF(ix) * toF(parentOrientW)) + toF(toF(iw) * toF(-parentOrientX))) + toF(toF(toF(iy) * toF(-parentOrientZ)) - toF(toF(iz) * toF(-parentOrientY))));
                    posY = toF(toF(toF(toF(iy) * toF(parentOrientW)) + toF(toF(iw) * toF(-parentOrientY))) + toF(toF(toF(iz) * toF(-parentOrientX)) - toF(toF(ix) * toF(-parentOrientZ))));
                    posZ = toF(toF(toF(toF(iz) * toF(parentOrientW)) + toF(toF(iw) * toF(-parentOrientZ))) + toF(toF(toF(ix) * toF(-parentOrientY)) - toF(toF(iy) * toF(-parentOrientX))));

                    posX = toF(posX + parentPosX);
                    posY = toF(posY + parentPosY);
                    posZ = toF(posZ + parentPosZ);
                    
                    ix = toF(toF(toF(toF(parentOrientX * orientW) + toF(parentOrientW * orientX)) + toF(parentOrientY * orientZ)) - toF(parentOrientZ * orientY));
                    iy = toF(toF(toF(toF(parentOrientY * orientW) + toF(parentOrientW * orientY)) + toF(parentOrientZ * orientX)) - toF(parentOrientX * orientZ));
                    iz = toF(toF(toF(toF(parentOrientZ * orientW) + toF(parentOrientW * orientZ)) + toF(parentOrientX * orientY)) - toF(parentOrientY * orientX));
                    iw = toF(toF(toF(toF(parentOrientW * orientW) - toF(parentOrientX * orientX)) - toF(parentOrientY * orientY)) - toF(parentOrientZ * orientZ));
                    orientX = ix;
                    orientY = iy;
                    orientZ = iz;
                    orientW = iw;
                }
                
                jointsOffset = ((jointsBase|0) + (imul(i, JOINT_ELEMENTS)|0))|0;
                f32Array[((jointsOffset + 0)<<2)>>2] = posX;
                f32Array[((jointsOffset + 1)<<2)>>2] = posY;
                f32Array[((jointsOffset + 2)<<2)>>2] = posZ;
                f32Array[((jointsOffset + 4)<<2)>>2] = orientX;
                f32Array[((jointsOffset + 5)<<2)>>2] = orientY;
                f32Array[((jointsOffset + 6)<<2)>>2] = orientZ;
                f32Array[((jointsOffset + 7)<<2)>>2] = orientW;
            }
        }

        return {
            asmSkin: asmSkin,
            asmSkinSIMD: asmSkinSIMD,
            asmGetFrameJoints: asmGetFrameJoints
        }
    }
    
    Md5Mesh.prototype.setAnimation = function(anim) {
        var i32Array = this.i32Array;
        var f32Array = this.f32Array;
        var offset = this.animationBase;
        
        const HIERARCHY_ELEMENTS = 3;
        const BASEFRAME_ELEMENTS = 8;
        const FRAME_ELEMENTS = 1;
        
        const HEADER = 6;
        const HIERARCHY_BASE = 0;
        const BASEFRAME_BASE = 2;
        const FRAMES_BASE = 4;
        
        i32Array[offset++] = 0; // hierarchy base
        i32Array[offset++] = anim.hierarchy.length;
        i32Array[offset++] = 0; // baseFrame base
        i32Array[offset++] = anim.baseFrame.length;
        i32Array[offset++] = 0; // frames base
        i32Array[offset++] = anim.frames.length;

        i32Array[this.animationBase + HIERARCHY_BASE] = offset;
        var i = 0;
        for (i = 0; i < anim.hierarchy.length; ++i) {
            i32Array[offset++] = anim.hierarchy[i].parent;
            i32Array[offset++] = anim.hierarchy[i].flags;
            i32Array[offset++] = anim.hierarchy[i].index;
        }
        i32Array[this.animationBase + BASEFRAME_BASE] = offset;
        for (i = 0; i < anim.baseFrame.length; ++i) {
            f32Array[offset++] = anim.baseFrame[i].pos[0];
            f32Array[offset++] = anim.baseFrame[i].pos[1];
            f32Array[offset++] = anim.baseFrame[i].pos[2];
            f32Array[offset++] = 0;
            f32Array[offset++] = anim.baseFrame[i].orient[0];
            f32Array[offset++] = anim.baseFrame[i].orient[1];
            f32Array[offset++] = anim.baseFrame[i].orient[2];
            f32Array[offset++] = 0;
        }
        i32Array[this.animationBase + FRAMES_BASE] = offset;
        var framesBase = offset;
        for (i = 0; i < anim.frames.length; ++i) {
            i32Array[offset++] = 0;
            i32Array[offset++] = anim.frames[i].length;
        }
        for (i = 0; i < anim.frames.length; ++i) {
            var frames = anim.frames[i];
            i32Array[framesBase + i * 2] = offset;
            for (var j = 0; j < frames.length; ++j) {
                f32Array[offset++] = frames[j];       
            }
        }
    }

    Md5Mesh.prototype.setAnimationFrame = function(gl, animation, frame) {
        this.asmGetFrameJoints(frame, this.animationBase, this.jointsArrayOffset);
        if (!useSIMD) {
            this.asmSkin();
        } else {
            this.asmSkinSIMD();
        }
        this._bindBuffers(gl);
    };
    
    Md5Mesh.prototype._bindBuffers = function(gl) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.vertArray, gl.STATIC_DRAW);
    }
        
    Md5Mesh.prototype.draw =function(gl, shader) {
        if(!this.vertBuffer || !this.indexBuffer) { return; }
        
        // Bind the appropriate buffers
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertBuffer);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);

        var meshes = this.meshes;
        var meshCount = meshes.length;
        for(var i = 0; i < meshCount; ++i) {
            var mesh = meshes[i];
            var meshOffset = mesh.offset * 4;

            // Set Textures
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, mesh.diffuseMap);
            gl.uniform1i(shader.uniform.diffuse, 0);

            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, mesh.specularMap);
            gl.uniform1i(shader.uniform.specular, 1);

            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, mesh.normalMap);
            gl.uniform1i(shader.uniform.normalMap, 2);

            // Enable vertex arrays
            gl.enableVertexAttribArray(shader.attribute.position);
            gl.enableVertexAttribArray(shader.attribute.texture);
            gl.enableVertexAttribArray(shader.attribute.normal);
            gl.enableVertexAttribArray(shader.attribute.tangent);

            // Draw the mesh
            gl.vertexAttribPointer(shader.attribute.position, 3, gl.FLOAT, false, VERTEX_STRIDE, meshOffset+0);
            gl.vertexAttribPointer(shader.attribute.texture, 2, gl.FLOAT, false, VERTEX_STRIDE, meshOffset+12);
            gl.vertexAttribPointer(shader.attribute.normal, 3, gl.FLOAT, false, VERTEX_STRIDE, meshOffset+20);
            gl.vertexAttribPointer(shader.attribute.tangent, 3, gl.FLOAT, false, VERTEX_STRIDE, meshOffset+32);

            gl.uniform3fv(shader.uniform.meshPos, this.pos);
            
            gl.drawElements(gl.TRIANGLES, mesh.elementCount, gl.UNSIGNED_SHORT, mesh.indexOffset*2);
        }
    };

    /*
     * Md5Anim
     */

    var Md5Anim = function() {
        this.frameRate = 24;
        this.frameTime = 1000.0 / this.frameRate;
        this.hierarchy = null;
        this.baseFrame = null;
        this.frames = null;
        this.buffer = new ArrayBuffer(1 * 1024 * 1024);
        this.f32Array = new Float32Array(this.buffer);
        this.i32Array = new Int32Array(this.buffer);
        this.asmGetFrameJoints = _asmjsModule(window, null, this.buffer).asmGetFrameJoints;
    };
        
    Md5Anim.prototype.load = function(url, callback) {
        this.hierarchy = new Array();
        this.baseFrame = new Array();
        this.frames = new Array();
        
        var self = this;
        
        var request = new XMLHttpRequest();
        request.addEventListener("load", function() {
            self._parse(request.responseText);
            if(callback) { callback(self); }
        });
        
        request.open('GET', BASE_PATH + url, true);
        request.overrideMimeType('text/plain');
        request.setRequestHeader('Content-Type', 'text/plain');
        request.send(null);

        return this;
    };
        
    Md5Anim.prototype._parse = function(src) {
        var anim = this;
        
        src.replace(/frameRate (.+)/, function($0, frameRate) {
            anim.frameRate = parseInt(frameRate);
            anim.frameTime = 1000 / frameRate;
        });

        src.replace(/hierarchy \{([^}]*)\}/m, function($0, hierarchySrc) {
            hierarchySrc.replace(/\"(.+)\"\s([-\d]+) (\d+) (\d+)\s/g, function($0, name, parent, flags, index) {
                anim.hierarchy.push({
                    name: name,
                    parent: parseInt(parent), 
                    flags: parseInt(flags), 
                    index: parseInt(index)
                });
            });
        });

        src.replace(/baseframe \{([^}]*)\}/m, function($0, baseframeSrc) {
            var offset = 0;
            baseframeSrc.replace(/\( (.+) (.+) (.+) \) \( (.+) (.+) (.+) \)/g, function($0, x, y, z, ox, oy, oz) {
                anim.baseFrame.push({
                    pos: [parseFloat(x), parseFloat(y), parseFloat(z)], 
                    orient: [parseFloat(ox), parseFloat(oy), parseFloat(oz)]
                });
            });
        });


        src.replace(/frame \d+ \{([^}]*)\}/mg, function($0, frameSrc) {
            var frame = new Array();
            var offset = 0;

            frameSrc.replace(/([-\.\d]+)/g, function($0, value) {
                frame.push(parseFloat(value));
            });

            anim.frames.push(frame);
        });
    };

    return {
        Md5Mesh: Md5Mesh,
        Md5Anim: Md5Anim,
        setSIMD: setSIMD
    };
});
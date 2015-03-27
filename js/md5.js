/* 
 * md5Mesh.js - Parses MD5 Mesh and Animation files (idTech 4) for use in WebGL
 */
 
/*
 * Copyright (c) 2011 Brandon Jones
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
    
    var Md5Mesh = function() {
        this.joints = null;
        this.jointsData = null;
        this.meshes = null;
        this.pos = vec3.create([0.0, 0.0, 0.0]);
        this.mesh_texture_loaded = 0;
    };

    Md5Mesh.prototype.load = function(gl, url, callback) {
        this.joints = new Array();
        this.jointsData = new Float32Array(4000);
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
                if (useSIMD) {
                    model.jointsData[jointsOffset++] = parseFloat(x);
                    model.jointsData[jointsOffset++] = parseFloat(y);
                    model.jointsData[jointsOffset++] = parseFloat(z);
                    model.jointsData[jointsOffset++] = 0;
                    model.jointsData[jointsOffset++] = parseFloat(ox);
                    model.jointsData[jointsOffset++] = parseFloat(oy);
                    model.jointsData[jointsOffset++] = parseFloat(oz);
                    model.jointsData[jointsOffset++] = 0;
                }
            });
        });

        src.replace(/mesh \{([^}]*)\}/mg, function($0, meshSrc) {
            var mesh = {
                shader: '',
                verts: new Array(),
                tris: new Array(),
                weights: new Array(),
                weightsData: new Float32Array(50000),
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
                    texCoord: [parseFloat(u), parseFloat(v)],
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
                mesh.weightsData[weightsOffset++] = parseFloat(bias);
                // pos
                mesh.weightsData[weightsOffset++] = parseFloat(x);
                mesh.weightsData[weightsOffset++] = parseFloat(y);
                mesh.weightsData[weightsOffset++] = parseFloat(z);
                mesh.weightsData[weightsOffset++] = 0;
                // normal
                mesh.weightsData[weightsOffset++] = 0;
                mesh.weightsData[weightsOffset++] = 0;
                mesh.weightsData[weightsOffset++] = 0;
                mesh.weightsData[weightsOffset++] = 0;
                // tangent
                mesh.weightsData[weightsOffset++] = 0;
                mesh.weightsData[weightsOffset++] = 0;
                mesh.weightsData[weightsOffset++] = 0;
                mesh.weightsData[weightsOffset++] = 0;
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

                    if (useSIMD) {
                        mesh.weightsData[(vert.weight.index + j) * 13 + 5] = weight.normal[0];
                        mesh.weightsData[(vert.weight.index + j) * 13 + 6] = weight.normal[1];
                        mesh.weightsData[(vert.weight.index + j) * 13 + 7] = weight.normal[2];
                        mesh.weightsData[(vert.weight.index + j) * 13 + 8] = weight.normal[3];
                        mesh.weightsData[(vert.weight.index + j) * 13 + 9] = weight.tangent[0];
                        mesh.weightsData[(vert.weight.index + j) * 13 + 10] = weight.tangent[1];
                        mesh.weightsData[(vert.weight.index + j) * 13 + 11] = weight.tangent[2];
                        mesh.weightsData[(vert.weight.index + j) * 13 + 12] = weight.tangent[3];
                    }
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
        glUtil.loadTexture(gl, BASE_PATH + mesh.shader + '.png', function(texture) {
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
        
    // Creates the model's gl buffers and populates them with the bind-pose mesh
    Md5Mesh.prototype._initializeBuffers = function(gl) {
        var meshes = this.meshes;
        var i;
        
        var vertBufferLength = 0;
        var indexBufferLength = 0;
        for(i = 0; i < meshes.length; ++i) {
            var mesh = meshes[i];
            mesh.vertOffset = vertBufferLength;
            vertBufferLength += VERTEX_ELEMENTS * mesh.verts.length;
            
            mesh.indexOffset = indexBufferLength;
            indexBufferLength += mesh.elementCount;
        }
        
        // Fill the vertex buffer
        // Append 1 byte for using SIMD.float32x4.store.
        this.vertArray = new Float32Array(vertBufferLength + 1);
        if (!useSIMD)
            this._skin();
        else
            this._skinSIMD();
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
    
    // Skins the vertexArray with the given joint set
    // Passing null to joints results in the bind pose
    Md5Mesh.prototype._skin = function(joints, vertArray, arrayOffset) {
        if(!joints) { joints = this.joints; }
        if(!vertArray) { vertArray = this.vertArray }
        if(!arrayOffset) { arrayOffset = 0; }

        var rotatedPos = [0, 0, 0];

        var vx, vy, vz;
        var nx, ny, nz;
        var tx, ty, tz;
        
        var meshes = this.meshes;
        
        for(var i = 0; i < meshes.length; ++i) {
            var mesh = meshes[i];
            var meshOffset = mesh.vertOffset + arrayOffset;

            // Calculate transformed vertices in the bind pose
            for(var j = 0; j < mesh.verts.length; ++j) {
                var vertOffset = (j * VERTEX_ELEMENTS) + meshOffset;
                var vert = mesh.verts[j];

                vx = 0; vy = 0; vz = 0;
                nx = 0; ny = 0; nz = 0;
                tx = 0; ty = 0; tz = 0;

                vert.pos = [0, 0, 0];

                for (var k = 0; k < vert.weight.count; ++k) {
                    var weight = mesh.weights[vert.weight.index + k];
                    var joint = joints[weight.joint];

                    // Rotate position
                    quat4.multiplyVec3(joint.orient, weight.pos, rotatedPos);

                    // Translate position
                    vert.pos[0] += (joint.pos[0] + rotatedPos[0]) * weight.bias;
                    vert.pos[1] += (joint.pos[1] + rotatedPos[1]) * weight.bias;
                    vert.pos[2] += (joint.pos[2] + rotatedPos[2]) * weight.bias;
                    vx += (joint.pos[0] + rotatedPos[0]) * weight.bias;
                    vy += (joint.pos[1] + rotatedPos[1]) * weight.bias;
                    vz += (joint.pos[2] + rotatedPos[2]) * weight.bias;

                    // Rotate Normal
                    quat4.multiplyVec3(joint.orient, weight.normal, rotatedPos);
                    nx += rotatedPos[0] * weight.bias;
                    ny += rotatedPos[1] * weight.bias;
                    nz += rotatedPos[2] * weight.bias;

                    // Rotate Tangent
                    quat4.multiplyVec3(joint.orient, weight.tangent, rotatedPos);
                    tx += rotatedPos[0] * weight.bias;
                    ty += rotatedPos[1] * weight.bias;
                    tz += rotatedPos[2] * weight.bias;
                }

                // Position
                vertArray[vertOffset] = vx;
                vertArray[vertOffset+1] = vy;
                vertArray[vertOffset+2] = vz;

                // TexCoord
                vertArray[vertOffset+3] = vert.texCoord[0];
                vertArray[vertOffset+4] = vert.texCoord[1];

                // Normal
                vertArray[vertOffset+5] = nx;
                vertArray[vertOffset+6] = ny;
                vertArray[vertOffset+7] = nz;

                // Tangent
                vertArray[vertOffset+8] = tx;
                vertArray[vertOffset+9] = ty;
                vertArray[vertOffset+10] = tz;
            }
        }
    };

    Md5Mesh.prototype._skinSIMD = function(jointsData, vertArray, arrayOffset) {
        // joints holds pos4f and orient4f
        if(!jointsData) { jointsData = this.jointsData; }
        if(!vertArray) { vertArray = this.vertArray }
        if(!arrayOffset) { arrayOffset = 0; }

        var rotatedPos = SIMD.float32x4.splat(0);
        var tempx4 = SIMD.float32x4(1, 1, 1, -1);
        
        var meshes = this.meshes;
        
        for(var i = 0; i < meshes.length; ++i) {
            var mesh = meshes[i];
            var meshOffset = mesh.vertOffset + arrayOffset;

            // Calculate transformed vertices in the bind pose
            for(var j = 0; j < mesh.verts.length; ++j) {
                var vertOffset = (j * VERTEX_ELEMENTS) + meshOffset;
                var vert = mesh.verts[j];

                var vx4 = SIMD.float32x4.splat(0);
                var nx4 = SIMD.float32x4.splat(0);
                var tx4 = SIMD.float32x4.splat(0);

                var vert_pos = SIMD.float32x4.splat(0);

                for (var k = 0; k < vert.weight.count; ++k) {
                    var weight = mesh.weights[vert.weight.index + k];
                    var weigthsData = mesh.weightsData;
                    var weightsOffset = (vert.weight.index + k) * 13;

                    // Rotate position
                    var jointOrient = SIMD.float32x4.load(jointsData, weight.joint * 8 + 4);
                    var weightPos = SIMD.float32x4.load(weigthsData, weightsOffset + 1);
                    var ix4 = SIMD.float32x4.sub(
                        SIMD.float32x4.add(
                            SIMD.float32x4.mul(SIMD.float32x4.mul(SIMD.float32x4.swizzle(jointOrient, 3, 3, 3, 0), tempx4),
                                               SIMD.float32x4.swizzle(weightPos, 0, 1, 2, 0)),
                            SIMD.float32x4.mul(SIMD.float32x4.mul(SIMD.float32x4.swizzle(jointOrient, 1, 2, 0, 1), tempx4),
                                               SIMD.float32x4.swizzle(weightPos, 2, 0, 1, 1))),
                        SIMD.float32x4.mul(SIMD.float32x4.swizzle(jointOrient, 2, 0, 1, 2),
                                           SIMD.float32x4.swizzle(weightPos, 1, 2, 0, 2)));

                    var rotatedPos = SIMD.float32x4.add(
                        SIMD.float32x4.sub(SIMD.float32x4.mul(ix4, SIMD.float32x4.swizzle(jointOrient, 3, 3, 3, 0)),
                                           SIMD.float32x4.mul(SIMD.float32x4.swizzle(ix4, 3, 3, 3, 0), jointOrient)),
                        SIMD.float32x4.sub(SIMD.float32x4.mul(SIMD.float32x4.swizzle(ix4, 2, 0, 1, 0), SIMD.float32x4.swizzle(jointOrient, 1, 2, 0, 0)),
                                           SIMD.float32x4.mul(SIMD.float32x4.swizzle(ix4, 1, 2, 0, 0), SIMD.float32x4.swizzle(jointOrient, 2, 0, 1, 0))));

                    var jointPos = SIMD.float32x4.load(jointsData, weight.joint * 8);
                    var weightBias = SIMD.float32x4.swizzle(SIMD.float32x4.loadX(weigthsData, weightsOffset), 0, 0, 0, 0);

                    // Translate position
                    vx4 = SIMD.float32x4.add(vx4, SIMD.float32x4.mul(SIMD.float32x4.add(jointPos, rotatedPos), weightBias));

                    // Rotate Normal
                    var weightNormal = SIMD.float32x4.load(weigthsData, weightsOffset + 5);
                    ix4 = SIMD.float32x4.sub(
                        SIMD.float32x4.add(
                            SIMD.float32x4.mul(SIMD.float32x4.mul(SIMD.float32x4.swizzle(jointOrient, 3, 3, 3, 0), tempx4),
                                               SIMD.float32x4.swizzle(weightNormal, 0, 1, 2, 0)),
                            SIMD.float32x4.mul(SIMD.float32x4.mul(SIMD.float32x4.swizzle(jointOrient, 1, 2, 0, 1), tempx4),
                                               SIMD.float32x4.swizzle(weightNormal, 2, 0, 1, 1))),
                        SIMD.float32x4.mul(SIMD.float32x4.swizzle(jointOrient, 2, 0, 1, 2),
                                           SIMD.float32x4.swizzle(weightNormal, 1, 2, 0, 2)));

                    rotatedPos = SIMD.float32x4.add(
                        SIMD.float32x4.sub(SIMD.float32x4.mul(ix4, SIMD.float32x4.swizzle(jointOrient, 3, 3, 3, 0)),
                                           SIMD.float32x4.mul(SIMD.float32x4.swizzle(ix4, 3, 3, 3, 0), jointOrient)),
                        SIMD.float32x4.sub(SIMD.float32x4.mul(SIMD.float32x4.swizzle(ix4, 2, 0, 1, 0), SIMD.float32x4.swizzle(jointOrient, 1, 2, 0, 0)),
                                           SIMD.float32x4.mul(SIMD.float32x4.swizzle(ix4, 1, 2, 0, 0), SIMD.float32x4.swizzle(jointOrient, 2, 0, 1, 0))));

                    nx4 = SIMD.float32x4.add(nx4, SIMD.float32x4.mul(rotatedPos, weightBias))

                    // Rotate Tangent
                    var weightTangent = SIMD.float32x4.load(weigthsData, weightsOffset + 9);
                    ix4 = SIMD.float32x4.sub(
                        SIMD.float32x4.add(
                            SIMD.float32x4.mul(SIMD.float32x4.mul(SIMD.float32x4.swizzle(jointOrient, 3, 3, 3, 0), tempx4),
                                               SIMD.float32x4.swizzle(weightTangent, 0, 1, 2, 0)),
                            SIMD.float32x4.mul(SIMD.float32x4.mul(SIMD.float32x4.swizzle(jointOrient, 1, 2, 0, 1), tempx4),
                                               SIMD.float32x4.swizzle(weightTangent, 2, 0, 1, 1))),
                        SIMD.float32x4.mul(SIMD.float32x4.swizzle(jointOrient, 2, 0, 1, 2),
                                           SIMD.float32x4.swizzle(weightTangent, 1, 2, 0, 2)));

                    rotatedPos = SIMD.float32x4.add(
                        SIMD.float32x4.sub(SIMD.float32x4.mul(ix4, SIMD.float32x4.swizzle(jointOrient, 3, 3, 3, 0)),
                                           SIMD.float32x4.mul(SIMD.float32x4.swizzle(ix4, 3, 3, 3, 0), jointOrient)),
                        SIMD.float32x4.sub(SIMD.float32x4.mul(SIMD.float32x4.swizzle(ix4, 2, 0, 1, 0), SIMD.float32x4.swizzle(jointOrient, 1, 2, 0, 0)),
                                           SIMD.float32x4.mul(SIMD.float32x4.swizzle(ix4, 1, 2, 0, 0), SIMD.float32x4.swizzle(jointOrient, 2, 0, 1, 0))));

                    tx4 = SIMD.float32x4.add(tx4, SIMD.float32x4.mul(rotatedPos, weightBias))
                }

                // Position
                SIMD.float32x4.store(vertArray, vertOffset, vx4);

                // TexCoord
                SIMD.float32x4.store(vertArray, vertOffset + 3, SIMD.float32x4.load(vert.texCoord, 0));

                // Normal
                SIMD.float32x4.store(vertArray, vertOffset + 5, nx4);

                // Tangent
                SIMD.float32x4.store(vertArray, vertOffset + 8, tx4);
            }
        }
    };
        
    Md5Mesh.prototype.setAnimationFrame = function(gl, animation, frame) {
        if (!useSIMD) {
            var joints = animation.getFrameJoints(frame);
            this._skin(joints);
        } else {
            var joints = animation.getFrameJointsSIMD(frame);
            this._skinSIMD(joints);
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.vertArray, gl.STATIC_DRAW);
    };
        
    Md5Mesh.prototype.draw =function(gl, shader) {
        if(!this.vertBuffer || !this.indexBuffer) { return; }
        
        // Bind the appropriate buffers
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertBuffer);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);

        var meshes = this.meshes;
        var meshCount = meshes.length;
        for(var i = 0; i < meshCount; ++i) {
            var mesh = meshes[i];
            var meshOffset = mesh.vertOffset * 4;

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
        this.baseFrameJointsData = null;
        this.jointsData = null;
        this.frames = null;
    };
        
    Md5Anim.prototype.load = function(url, callback) {
        this.hierarchy = new Array();
        this.baseFrame = new Array();
        this.baseFrameJointsData = new Float32Array(4000);
        this.jointsData = new Float32Array(4000);
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

                if (useSIMD) {
                    anim.baseFrameJointsData[offset++] = parseFloat(x);
                    anim.baseFrameJointsData[offset++] = parseFloat(y);
                    anim.baseFrameJointsData[offset++] = parseFloat(z);
                    anim.baseFrameJointsData[offset++] = 0;
                    anim.baseFrameJointsData[offset++] = parseFloat(ox);
                    anim.baseFrameJointsData[offset++] = parseFloat(oy);
                    anim.baseFrameJointsData[offset++] = parseFloat(oz);
                    anim.baseFrameJointsData[offset++] = 0;
                }
            });
        });


        src.replace(/frame \d+ \{([^}]*)\}/mg, function($0, frameSrc) {
            var frame = new Float32Array(4000);
            var offset = 0;

            frameSrc.replace(/([-\.\d]+)/g, function($0, value) {
                frame[offset++] = parseFloat(value);
            });

            anim.frames.push(frame);
        });
    };
        
    Md5Anim.prototype.getFrameJoints = function(frame) {
        frame = frame % this.frames.length;
    
        var frameData = this.frames[frame]; 
        var joints = new Array();

        for (var i = 0; i < this.baseFrame.length; ++i) {
            var baseJoint = this.baseFrame[i];
            var offset = this.hierarchy[i].index;
            var flags = this.hierarchy[i].flags;

            var aPos = [baseJoint.pos[0], baseJoint.pos[1], baseJoint.pos[2]];
            var aOrient = [baseJoint.orient[0], baseJoint.orient[1], baseJoint.orient[2], 0];

            var j = 0;

            if (flags & 1) { // Translate X
                aPos[0] = frameData[offset + j];
                ++j;
            }

            if (flags & 2) { // Translate Y
                aPos[1] = frameData[offset + j];
                ++j;
            }

            if (flags & 4) { // Translate Z
                aPos[2] = frameData[offset + j];
                ++j;
            }

            if (flags & 8) { // Orient X
                aOrient[0] = frameData[offset + j];
                ++j;
            }

            if (flags & 16) { // Orient Y
                aOrient[1] = frameData[offset + j];
                ++j;
            }

            if (flags & 32) { // Orient Z
                aOrient[2] = frameData[offset + j];
                ++j;
            }

            // Recompute W value
            quat4.calculateW(aOrient);

            // Multiply against parent 
            //(assumes parents always have a lower index than their children)
            var parentIndex = this.hierarchy[i].parent;

            if(parentIndex >= 0) {
                var parentJoint = joints[parentIndex];

                quat4.multiplyVec3(parentJoint.orient, aPos);
                vec3.add(aPos, parentJoint.pos);
                quat4.multiply(parentJoint.orient, aOrient, aOrient);
            }

            joints.push({pos: aPos, orient: aOrient}); // This could be so much better!
        }

        return joints;
    };

    Md5Anim.prototype.getFrameJointsSIMD = function(frame) {
        frame = frame % this.frames.length;
    
        var frameData = this.frames[frame]; 

        // jointsData holds pos4f and orient4f
        var jointsData = this.jointsData;
        var jointsOffset = 0;

        var tempx4 = SIMD.float32x4(1, 1, 1, -1);

        for (var i = 0; i < this.baseFrame.length; ++i) {
            var offset = this.hierarchy[i].index;
            var flags = this.hierarchy[i].flags;

            var aPos = SIMD.float32x4.load(this.baseFrameJointsData, i * 8);
            var aOrient = SIMD.float32x4.load(this.baseFrameJointsData, i * 8 + 4);

            var j = 0;

            if (flags & 7) {
                aPos = SIMD.float32x4.loadXYZ(frameData, offset + j);
                j += 3;
            } else {
                if (flags & 1) { // Translate X
                    aPos = SIMD.float32x4.withX(aPos, frameData[offset + j]);
                    ++j;
                }
                if (flags & 2) { // Translate Y
                    aPos = SIMD.float32x4.withY(aPos, frameData[offset + j]);
                    ++j;
                }
                if (flags & 4) { // Translate Z
                    aPos = SIMD.float32x4.withZ(aPos, frameData[offset + j]);
                    ++j;
                }
            }

            if (flags & 56) {
                aOrient = SIMD.float32x4.loadXYZ(frameData, offset + j);
            } else {
                if (flags & 8) { // Orient X
                    aOrient = SIMD.float32x4.withX(aOrient, frameData[offset + j]);
                    ++j;
                }
                if (flags & 16) { // Orient Y
                    aOrient = SIMD.float32x4.withY(aOrient, frameData[offset + j]);
                    ++j;
                }
                if (flags & 32) { // Orient Z
                    aOrient = SIMD.float32x4.withZ(aOrient, frameData[offset + j]);
                    ++j;
                }
            }

            // Recompute W value
            // This is slow.
            var w = -Math.sqrt(Math.abs(1.0 - aOrient.x * aOrient.x - aOrient.y * aOrient.y - aOrient.z * aOrient.z));
            aOrient = SIMD.float32x4.withW(aOrient, w);

            // Multiply against parent 
            //(assumes parents always have a lower index than their children)
            var parentIndex = this.hierarchy[i].parent;

            if(parentIndex >= 0) {
                var pOrient = SIMD.float32x4.load(jointsData, parentIndex * 8 + 4);
                
                var ix4 = SIMD.float32x4.sub(
                    SIMD.float32x4.add(
                        SIMD.float32x4.mul(SIMD.float32x4.mul(SIMD.float32x4.swizzle(pOrient, 3, 3, 3, 0), tempx4),
                                           SIMD.float32x4.swizzle(aPos, 0, 1, 2, 0)),
                        SIMD.float32x4.mul(SIMD.float32x4.mul(SIMD.float32x4.swizzle(pOrient, 1, 2, 0, 1), tempx4),
                                           SIMD.float32x4.swizzle(aPos, 2, 0, 1, 1))),
                    SIMD.float32x4.mul(SIMD.float32x4.swizzle(pOrient, 2, 0, 1, 2),
                                       SIMD.float32x4.swizzle(aPos, 1, 2, 0, 2)));

                aPos = SIMD.float32x4.add(
                    SIMD.float32x4.sub(SIMD.float32x4.mul(ix4, SIMD.float32x4.swizzle(pOrient, 3, 3, 3, 0)),
                                       SIMD.float32x4.mul(SIMD.float32x4.swizzle(ix4, 3, 3, 3, 0), pOrient)),
                    SIMD.float32x4.sub(SIMD.float32x4.mul(SIMD.float32x4.swizzle(ix4, 2, 0, 1, 0), SIMD.float32x4.swizzle(pOrient, 1, 2, 0, 0)),
                                       SIMD.float32x4.mul(SIMD.float32x4.swizzle(ix4, 1, 2, 0, 0), SIMD.float32x4.swizzle(pOrient, 2, 0, 1, 0))));

                var pPos = SIMD.float32x4.load(jointsData, parentIndex * 8);
                aPos = SIMD.float32x4.add(aPos, pPos);

                aOrient = SIMD.float32x4.add(
                    SIMD.float32x4.add(
                        SIMD.float32x4.mul(pOrient, SIMD.float32x4.swizzle(aOrient, 3, 3, 3, 3)),
                        SIMD.float32x4.mul(SIMD.float32x4.mul(tempx4, SIMD.float32x4.swizzle(pOrient, 3, 3, 3, 0)), SIMD.float32x4.swizzle(aOrient, 0, 1, 2, 0))),
                    SIMD.float32x4.sub(
                        SIMD.float32x4.mul(SIMD.float32x4.mul(tempx4, SIMD.float32x4.swizzle(pOrient, 1, 2, 0, 1)), SIMD.float32x4.swizzle(aOrient, 2, 0, 1, 1)),
                        SIMD.float32x4.mul(SIMD.float32x4.swizzle(pOrient, 2, 0, 1, 2), SIMD.float32x4.swizzle(aOrient, 1, 2, 0, 2))));
            }

            SIMD.float32x4.store(jointsData, jointsOffset * 8, aPos);
            SIMD.float32x4.store(jointsData, jointsOffset * 8 + 4, aOrient);
            jointsOffset++;
        }

        return jointsData;
    };

    return {
        Md5Mesh: Md5Mesh,
        Md5Anim: Md5Anim
    };
});
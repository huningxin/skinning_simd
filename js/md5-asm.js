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
        this.buffer = new ArrayBuffer(512 * 1024);
        this.end = 0;
        this.asmSkin = _asmjsModule(window, null, this.buffer).asmSkin;
        if (typeof SIMD !== 'undefined')
            this.asmSkinSIMD = _asmjsModuleSIMD(window, null, this.buffer).asmSkinSIMD;
        else
            this.asmSkinSIMD = function() {};
        this.asmGetFrameJoints = _asmjsModule(window, null, this.buffer).asmGetFrameJoints;
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
    
    // Memory Layout
        var HEAP_BASE = 0;
        // Header
        var HEADER_SIZE = 12;
        var i_MODEL_STRUCT_PTR_OFFSET = 0;
        var i_VERT_ARRAY_PTR_OFFSET = 4;
        var i_ANIMATION_STRUCT_PTR_OFFSET = 8;
        
        // Model struct
        var MODEL_STRUCT_SIZE = 16;
        var i_MODEL_MESHES_PTR_OFFSET = 0;
        var i_MODEL_MESHES_LENGTH_OFFSET = 4;
        var i_MODEL_JOINTS_PTR_OFFSET = 8;
        var i_MODEL_JOINTS_LENGTH_OFFSET = 12; 
        
        // Mesh struct
        var MESH_STRUCT_SIZE = 20;
        var i_MESH_VERT_OFFSET_OFFSET = 0;
        var i_MESH_VERTS_PTR_OFFSET = 4;
        var i_MESH_VERTS_LENGTH_OFFSET = 8;
        var i_MESH_WEIGHTS_PTR_OFFSET = 12;
        var i_MESH_WEIGHTS_LENGTH_OFFSET = 16;
        
        // Vert struct
        var VERT_STRUCT_SIZE = 16;
        var f_VERT_TEXCOORD_0_OFFSET = 0;
        var f_VERT_TEXCOORD_1_OFFSET = 4;
        var i_VERT_WEIGHT_INDEX_OFFSET = 8;
        var i_VERT_WEIGHT_COUNT_OFFSET = 12;
        
        // Weight struct
        var WEIGHT_STRUCT_SIZE = 56;
        var i_WEIGHT_JOINT_INDEX_OFFSET = 0;
        var f_WEIGHT_BIAS_OFFSET = 4;
        var f_WEIGHT_POS_0_OFFSET = 8;
        var f_WEIGHT_POS_1_OFFSET = 12;
        var f_WEIGHT_POS_2_OFFSET = 16;
        var f_WEIGHT_POS_3_OFFSET = 20;
        var f_WEIGHT_NORMAL_0_OFFSET = 24;
        var f_WEIGHT_NORMAL_1_OFFSET = 28;
        var f_WEIGHT_NORMAL_2_OFFSET = 32;
        var f_WEIGHT_NORMAL_3_OFFSET = 36;
        var f_WEIGHT_TANGENT_0_OFFSET = 40;
        var f_WEIGHT_TANGENT_1_OFFSET = 44;
        var f_WEIGHT_TANGENT_2_OFFSET = 48;
        var f_WEIGHT_TANGENT_3_OFFSET = 52;
        
        // Joint struct
        var JOINT_STRUCT_SIZE = 32;
        var f_JOINT_POS_0_OFFSET = 0;
        var f_JOINT_POS_1_OFFSET = 4;
        var f_JOINT_POS_2_OFFSET = 8;
        var f_JOINT_POS_3_OFFSET = 12;
        var f_JOINT_ORIENT_0_OFFSET = 16;
        var f_JOINT_ORIENT_1_OFFSET = 20;
        var f_JOINT_ORIENT_2_OFFSET = 24;
        var f_JOINT_ORIENT_3_OFFSET = 28;
        
        // Animation Struct
        var ANIMATION_STRUCT_SIZE = 24;
        var i_ANIMATION_HIERARCHY_PTR_OFFSET = 0;
        var i_ANIMATION_HIERARCHY_LENGTH_OFFSET = 4;
        var i_ANIMATION_BASEFRAME_PTR_OFFSET = 8;
        var i_ANIMATION_BASEFRAME_LENGTH_OFFSET = 12;
        var i_ANIMATION_FRAMES_PTR_OFFSET = 16;
        var i_ANIMATION_FRAMES_LENGTH_OFFSET = 20;
        
        // Hierarchy Struct
        var HIERARCHY_STRUCT_SIZE = 12;
        var i_HIERARCHY_PARENT_OFFSET = 0;
        var i_HIERARCHY_FLAGS_OFFSET = 4;
        var i_HIERARCHY_INDEX_OFFSET = 8;
        
        // BaseFrame Struct
        var BASEFRAME_STRUCT_SIZE = 32;
        var f_BASEFRAME_POS_0_OFFSET = 0;
        var f_BASEFRAME_POS_1_OFFSET = 4;
        var f_BASEFRAME_POS_2_OFFSET = 8;
        var f_BASEFRAME_POS_3_OFFSET = 12;
        var f_BASEFRAME_ORIENT_0_OFFSET = 16;
        var f_BASEFRAME_ORIENT_1_OFFSET = 20;
        var f_BASEFRAME_ORIENT_2_OFFSET = 24;
        var f_BASEFRAME_ORIENT_3_OFFSET = 28;
        
        // Frames Struct
        var FRAMES_STRUCT_SIZE = 8;
        var i_FRAMES_PTR_OFFSET = 0;
        var i_FRAMES_LENGTH_OFFSET = 4;
        
        // Frame
        var FRAME_STRUCT_SIZE = 4;
        var f_FRAME_VALUE_OFFSET = 0;

    Md5Mesh.prototype._initializeArrayBuffer = function() {
        var HEAPF32 = new Float32Array(this.buffer);
        var HEAP32 = new Int32Array(this.buffer);
        var model = this;
        var numOfVerts = 0;
        var ptr = HEAP_BASE;
        
        // Allocate Header
        var header_ptr = ptr;
        ptr += HEADER_SIZE;
        HEAP32[(header_ptr + i_MODEL_STRUCT_PTR_OFFSET)>>2] = 0;
        HEAP32[(header_ptr + i_VERT_ARRAY_PTR_OFFSET)>>2] = 0;
        HEAP32[(header_ptr + i_ANIMATION_STRUCT_PTR_OFFSET)>>2] = 0;
        // Allocate Model struct
        HEAP32[(header_ptr + i_MODEL_STRUCT_PTR_OFFSET)>>2] = ptr;
        var model_ptr = ptr;
        ptr += MODEL_STRUCT_SIZE;
        HEAP32[(model_ptr + i_MODEL_MESHES_PTR_OFFSET)>>2] = 0;
        HEAP32[(model_ptr + i_MODEL_MESHES_LENGTH_OFFSET)>>2] = model.meshes.length;
        HEAP32[(model_ptr + i_MODEL_JOINTS_PTR_OFFSET)>>2] = 0;
        HEAP32[(model_ptr + i_MODEL_JOINTS_LENGTH_OFFSET)>>2] = model.joints.length;
        
        // Allocate mesh struct arrays
        HEAP32[(model_ptr + i_MODEL_MESHES_PTR_OFFSET)>>2] = ptr;
        var meshes_ptr = ptr;
        ptr += MESH_STRUCT_SIZE * model.meshes.length;
        for(var i = 0; i < model.meshes.length; ++i) {
            var mesh = model.meshes[i];
        
            HEAP32[(meshes_ptr + i * MESH_STRUCT_SIZE + i_MESH_VERT_OFFSET_OFFSET)>>2] = mesh.offset;
            HEAP32[(meshes_ptr + i * MESH_STRUCT_SIZE + i_MESH_VERTS_PTR_OFFSET)>>2] = 0;
            HEAP32[(meshes_ptr + i * MESH_STRUCT_SIZE + i_MESH_VERTS_LENGTH_OFFSET)>>2] = mesh.verts.length;
            HEAP32[(meshes_ptr + i * MESH_STRUCT_SIZE + i_MESH_WEIGHTS_PTR_OFFSET)>>2] = 0;
            HEAP32[(meshes_ptr + i * MESH_STRUCT_SIZE + i_MESH_WEIGHTS_LENGTH_OFFSET)>>2] = mesh.weights.length;
           
           // Allocate vert array of mesh
           var verts_array_ptr = ptr;
           HEAP32[(meshes_ptr + i * MESH_STRUCT_SIZE + i_MESH_VERTS_PTR_OFFSET)>>2] = ptr;
           ptr += VERT_STRUCT_SIZE * mesh.verts.length;
            for(var j = 0; j < mesh.verts.length; ++j) {
                numOfVerts++;
                var vert = mesh.verts[j];
                HEAPF32[(verts_array_ptr + j * VERT_STRUCT_SIZE + f_VERT_TEXCOORD_0_OFFSET)>>2] = vert.texCoord[0];
                HEAPF32[(verts_array_ptr + j * VERT_STRUCT_SIZE + f_VERT_TEXCOORD_1_OFFSET)>>2] = vert.texCoord[1];
                HEAP32[(verts_array_ptr + j * VERT_STRUCT_SIZE + i_VERT_WEIGHT_INDEX_OFFSET)>>2] = vert.weight.index;
                HEAP32[(verts_array_ptr + j * VERT_STRUCT_SIZE + i_VERT_WEIGHT_COUNT_OFFSET)>>2] = vert.weight.count;
            }
            // Allocate weight array of mesh
            var weights_array_ptr = ptr;
            HEAP32[(meshes_ptr + i * MESH_STRUCT_SIZE + i_MESH_WEIGHTS_PTR_OFFSET)>>2] = weights_array_ptr;
            ptr += WEIGHT_STRUCT_SIZE * mesh.weights.length;
            for (var j = 0; j < mesh.weights.length; ++j) {
                var weight = mesh.weights[j];
                HEAP32[(weights_array_ptr + j * WEIGHT_STRUCT_SIZE + i_WEIGHT_JOINT_INDEX_OFFSET)>>2] = weight.joint;
                HEAPF32[(weights_array_ptr + j * WEIGHT_STRUCT_SIZE + f_WEIGHT_BIAS_OFFSET)>>2] = weight.bias;
                HEAPF32[(weights_array_ptr + j * WEIGHT_STRUCT_SIZE + f_WEIGHT_POS_0_OFFSET)>>2] = weight.pos[0];
                HEAPF32[(weights_array_ptr + j * WEIGHT_STRUCT_SIZE + f_WEIGHT_POS_1_OFFSET)>>2] = weight.pos[1];
                HEAPF32[(weights_array_ptr + j * WEIGHT_STRUCT_SIZE + f_WEIGHT_POS_2_OFFSET)>>2] = weight.pos[2];
                HEAPF32[(weights_array_ptr + j * WEIGHT_STRUCT_SIZE + f_WEIGHT_POS_3_OFFSET)>>2] = 0;
                HEAPF32[(weights_array_ptr + j * WEIGHT_STRUCT_SIZE + f_WEIGHT_NORMAL_0_OFFSET)>>2] = weight.normal[0];
                HEAPF32[(weights_array_ptr + j * WEIGHT_STRUCT_SIZE + f_WEIGHT_NORMAL_1_OFFSET)>>2] = weight.normal[1];
                HEAPF32[(weights_array_ptr + j * WEIGHT_STRUCT_SIZE + f_WEIGHT_NORMAL_2_OFFSET)>>2] = weight.normal[2];
                HEAPF32[(weights_array_ptr + j * WEIGHT_STRUCT_SIZE + f_WEIGHT_NORMAL_3_OFFSET)>>2] = 0;
                HEAPF32[(weights_array_ptr + j * WEIGHT_STRUCT_SIZE + f_WEIGHT_TANGENT_0_OFFSET)>>2] = weight.tangent[0];
                HEAPF32[(weights_array_ptr + j * WEIGHT_STRUCT_SIZE + f_WEIGHT_TANGENT_1_OFFSET)>>2] = weight.tangent[1];
                HEAPF32[(weights_array_ptr + j * WEIGHT_STRUCT_SIZE + f_WEIGHT_TANGENT_2_OFFSET)>>2] = weight.tangent[2];
                HEAPF32[(weights_array_ptr + j * WEIGHT_STRUCT_SIZE + f_WEIGHT_TANGENT_3_OFFSET)>>2] = 0;
            }
        }

        // Allocate joints
        var joints_ptr = ptr;
        HEAP32[(model_ptr + i_MODEL_JOINTS_PTR_OFFSET)>>2] = ptr;
        ptr += JOINT_STRUCT_SIZE * model.joints.length;
        for (var i = 0; i < model.joints.length; ++i) {
            var joint = this.joints[i];
            HEAPF32[(joints_ptr + i * JOINT_STRUCT_SIZE + f_JOINT_POS_0_OFFSET)>>2] = joint.pos[0];
            HEAPF32[(joints_ptr + i * JOINT_STRUCT_SIZE + f_JOINT_POS_1_OFFSET)>>2] = joint.pos[1];
            HEAPF32[(joints_ptr + i * JOINT_STRUCT_SIZE + f_JOINT_POS_2_OFFSET)>>2] = joint.pos[2];
            HEAPF32[(joints_ptr + i * JOINT_STRUCT_SIZE + f_JOINT_POS_3_OFFSET)>>2] = 0;
            HEAPF32[(joints_ptr + i * JOINT_STRUCT_SIZE + f_JOINT_ORIENT_0_OFFSET)>>2] = joint.orient[0];
            HEAPF32[(joints_ptr + i * JOINT_STRUCT_SIZE + f_JOINT_ORIENT_1_OFFSET)>>2] = joint.orient[1];
            HEAPF32[(joints_ptr + i * JOINT_STRUCT_SIZE + f_JOINT_ORIENT_2_OFFSET)>>2] = joint.orient[2];
            HEAPF32[(joints_ptr + i * JOINT_STRUCT_SIZE + f_JOINT_ORIENT_3_OFFSET)>>2] = joint.orient[3];
        }

        // Allocate vert Array
        var vertex_array_ptr = ptr;
        HEAP32[(header_ptr + i_VERT_ARRAY_PTR_OFFSET)>>2] = ptr;
        ptr += numOfVerts * VERTEX_STRIDE;
        this.vertArray = new Float32Array(this.buffer, vertex_array_ptr, numOfVerts * VERTEX_ELEMENTS);
        ptr += 4; // padding
        
        var animation_ptr = ptr;
        HEAP32[(header_ptr + i_ANIMATION_STRUCT_PTR_OFFSET)>>2] = ptr;
    };
    
    Md5Mesh.prototype._initializeArrayBufferForAnimation = function(anim) {
        var HEAP32 = new Int32Array(this.buffer);
        var HEAPF32 = new Float32Array(this.buffer);
        var header_ptr = 0;
        var anim_ptr = HEAP32[(header_ptr + i_ANIMATION_STRUCT_PTR_OFFSET)>>2];
        var ptr = 0;

        // Allocate Animation struct
        ptr = anim_ptr + ANIMATION_STRUCT_SIZE;        
        HEAP32[(anim_ptr + i_ANIMATION_HIERARCHY_PTR_OFFSET)>>2] = 0;
        HEAP32[(anim_ptr + i_ANIMATION_HIERARCHY_LENGTH_OFFSET)>>2] = anim.hierarchy.length;
        HEAP32[(anim_ptr + i_ANIMATION_BASEFRAME_PTR_OFFSET)>>2] = 0;
        HEAP32[(anim_ptr + i_ANIMATION_BASEFRAME_LENGTH_OFFSET)>>2] = anim.baseFrame.length;
        HEAP32[(anim_ptr + i_ANIMATION_FRAMES_PTR_OFFSET)>>2] = 0;
        HEAP32[(anim_ptr + i_ANIMATION_FRAMES_LENGTH_OFFSET)>>2] = anim.frames.length;

        // Allocate Hierarchy array
        HEAP32[(anim_ptr + i_ANIMATION_HIERARCHY_PTR_OFFSET)>>2] = ptr;
        var hierarchy_array_ptr = ptr;
        ptr += anim.hierarchy.length * HIERARCHY_STRUCT_SIZE;
        for (var i = 0; i < anim.hierarchy.length; ++i) {
            var hierarchy = anim.hierarchy[i];
            HEAP32[(hierarchy_array_ptr + i * HIERARCHY_STRUCT_SIZE + i_HIERARCHY_PARENT_OFFSET)>>2] = hierarchy.parent;
            HEAP32[(hierarchy_array_ptr + i * HIERARCHY_STRUCT_SIZE + i_HIERARCHY_FLAGS_OFFSET)>>2] = hierarchy.flags;
            HEAP32[(hierarchy_array_ptr + i * HIERARCHY_STRUCT_SIZE + i_HIERARCHY_INDEX_OFFSET)>>2] = hierarchy.index;
        }
        // Allocate BaseFrame array
        HEAP32[(anim_ptr + i_ANIMATION_BASEFRAME_PTR_OFFSET)>>2] = ptr;
        var baseframe_array_ptr = ptr;
        ptr += anim.baseFrame.length * BASEFRAME_STRUCT_SIZE;
        for (var i = 0; i < anim.baseFrame.length; ++i) {
            var baseframe = anim.baseFrame[i];
            HEAPF32[(baseframe_array_ptr + i * BASEFRAME_STRUCT_SIZE + f_BASEFRAME_POS_0_OFFSET)>>2] = baseframe.pos[0];
            HEAPF32[(baseframe_array_ptr + i * BASEFRAME_STRUCT_SIZE + f_BASEFRAME_POS_1_OFFSET)>>2] = baseframe.pos[1];
            HEAPF32[(baseframe_array_ptr + i * BASEFRAME_STRUCT_SIZE + f_BASEFRAME_POS_2_OFFSET)>>2] = baseframe.pos[2];
            HEAPF32[(baseframe_array_ptr + i * BASEFRAME_STRUCT_SIZE + f_BASEFRAME_POS_3_OFFSET)>>2] = 0;
            HEAPF32[(baseframe_array_ptr + i * BASEFRAME_STRUCT_SIZE + f_BASEFRAME_ORIENT_0_OFFSET)>>2] = baseframe.orient[0];
            HEAPF32[(baseframe_array_ptr + i * BASEFRAME_STRUCT_SIZE + f_BASEFRAME_ORIENT_1_OFFSET)>>2] = baseframe.orient[1];
            HEAPF32[(baseframe_array_ptr + i * BASEFRAME_STRUCT_SIZE + f_BASEFRAME_ORIENT_2_OFFSET)>>2] = baseframe.orient[2];
            HEAPF32[(baseframe_array_ptr + i * BASEFRAME_STRUCT_SIZE + f_BASEFRAME_ORIENT_3_OFFSET)>>2] = 0;
        }
        // Allocate Frames array
        HEAP32[(anim_ptr + i_ANIMATION_FRAMES_PTR_OFFSET)>>2] = ptr;
        var frames_array_ptr = ptr;
        ptr += anim.frames.length * FRAMES_STRUCT_SIZE;
        for (var i = 0; i < anim.frames.length; ++i) {
            var frames = anim.frames[i];
            HEAP32[(frames_array_ptr + i * FRAMES_STRUCT_SIZE +  i_FRAMES_PTR_OFFSET)>>2] = 0;
            HEAP32[(frames_array_ptr + i * FRAMES_STRUCT_SIZE +  i_FRAMES_LENGTH_OFFSET)>>2] = frames.length;
            // Allocate Frame array
            HEAP32[(frames_array_ptr + i * FRAMES_STRUCT_SIZE +  i_FRAMES_PTR_OFFSET)>>2] = ptr;
            var frames_ptr = ptr;
            ptr += frames.length * FRAME_STRUCT_SIZE;
            for (var j = 0; j < frames.length; ++j) {
                HEAPF32[(frames_ptr + j * FRAME_STRUCT_SIZE + f_FRAME_VALUE_OFFSET)>>2] = frames[j];       
            }
        }
        this.end = ptr;
    };

    Md5Mesh.prototype.setAnimation = function(anim) {
        this._initializeArrayBufferForAnimation(anim);
    };
        
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
        var HEAPF32 = new global.Float32Array(buffer);
        var HEAP32 = new global.Int32Array(buffer);
        var HEAPU8 = new global.Uint8Array(buffer);
        var imul = global.Math.imul;
        var toF = global.Math.fround;
        var sqrt = global.Math.sqrt;
        var abs = global.Math.abs;
        var VERTEX_ELEMENTS = 11; // 3 Pos, 2 UV, 3 Norm, 3 Tangent
        var VERTEX_STRIDE = 44;
        var f_VERTEX_POS_0_OFFSET = 0;
        var f_VERTEX_POS_1_OFFSET = 4;
        var f_VERTEX_POS_2_OFFSET = 8;
        var f_VERTEX_UV_0_OFFSET =  12;
        var f_VERTEX_UV_1_OFFSET = 16;
        var f_VERTEX_NORMAL_0_OFFSET = 20;
        var f_VERTEX_NORMAL_1_OFFSET = 24;
        var f_VERTEX_NORMAL_2_OFFSET = 28;
        var f_VERTEX_TANGENT_0_OFFSET = 32;
        var f_VERTEX_TANGENT_1_OFFSET = 36;
        var f_VERTEX_TANGENT_2_OFFSET = 40;
        
        // Memory Layout
        var HEAP_BASE = 0;
        // Header
        var HEADER_SIZE = 12;
        var i_MODEL_STRUCT_PTR_OFFSET = 0;
        var i_VERT_ARRAY_PTR_OFFSET = 4;
        var i_ANIMATION_STRUCT_PTR_OFFSET = 8;
        
        // Model struct
        var MODEL_STRUCT_SIZE = 16;
        var i_MODEL_MESHES_PTR_OFFSET = 0;
        var i_MODEL_MESHES_LENGTH_OFFSET = 4;
        var i_MODEL_JOINTS_PTR_OFFSET = 8;
        var i_MODEL_JOINTS_LENGTH_OFFSET = 12; 
        
        // Mesh struct
        var MESH_STRUCT_SIZE = 20;
        var i_MESH_VERT_OFFSET_OFFSET = 0;
        var i_MESH_VERTS_PTR_OFFSET = 4;
        var i_MESH_VERTS_LENGTH_OFFSET = 8;
        var i_MESH_WEIGHTS_PTR_OFFSET = 12;
        var i_MESH_WEIGHTS_LENGTH_OFFSET = 16;
        
        // Vert struct
        var VERT_STRUCT_SIZE = 16;
        var f_VERT_TEXCOORD_0_OFFSET = 0;
        var f_VERT_TEXCOORD_1_OFFSET = 4;
        var i_VERT_WEIGHT_INDEX_OFFSET = 8;
        var i_VERT_WEIGHT_COUNT_OFFSET = 12;
        
        // Weight struct
        var WEIGHT_STRUCT_SIZE = 56;
        var i_WEIGHT_JOINT_INDEX_OFFSET = 0;
        var f_WEIGHT_BIAS_OFFSET = 4;
        var f_WEIGHT_POS_0_OFFSET = 8;
        var f_WEIGHT_POS_1_OFFSET = 12;
        var f_WEIGHT_POS_2_OFFSET = 16;
        var f_WEIGHT_POS_3_OFFSET = 20;
        var f_WEIGHT_NORMAL_0_OFFSET = 24;
        var f_WEIGHT_NORMAL_1_OFFSET = 28;
        var f_WEIGHT_NORMAL_2_OFFSET = 32;
        var f_WEIGHT_NORMAL_3_OFFSET = 36;
        var f_WEIGHT_TANGENT_0_OFFSET = 40;
        var f_WEIGHT_TANGENT_1_OFFSET = 44;
        var f_WEIGHT_TANGENT_2_OFFSET = 48;
        var f_WEIGHT_TANGENT_3_OFFSET = 52;
        
        // Joint struct
        var JOINT_STRUCT_SIZE = 32;
        var f_JOINT_POS_0_OFFSET = 0;
        var f_JOINT_POS_1_OFFSET = 4;
        var f_JOINT_POS_2_OFFSET = 8;
        var f_JOINT_POS_3_OFFSET = 12;
        var f_JOINT_ORIENT_0_OFFSET = 16;
        var f_JOINT_ORIENT_1_OFFSET = 20;
        var f_JOINT_ORIENT_2_OFFSET = 24;
        var f_JOINT_ORIENT_3_OFFSET = 28;
        
        // Animation Struct
        var ANIMATION_STRUCT_SIZE = 24;
        var i_ANIMATION_HIERARCHY_PTR_OFFSET = 0;
        var i_ANIMATION_HIERARCHY_LENGTH_OFFSET = 4;
        var i_ANIMATION_BASEFRAME_PTR_OFFSET = 8;
        var i_ANIMATION_BASEFRAME_LENGTH_OFFSET = 12;
        var i_ANIMATION_FRAMES_PTR_OFFSET = 16;
        var i_ANIMATION_FRAMES_LENGTH_OFFSET = 20;
        
        // Hierarchy Struct
        var HIERARCHY_STRUCT_SIZE = 12;
        var i_HIERARCHY_PARENT_OFFSET = 0;
        var i_HIERARCHY_FLAGS_OFFSET = 4;
        var i_HIERARCHY_INDEX_OFFSET = 8;
        
        // BaseFrame Struct
        var BASEFRAME_STRUCT_SIZE = 32;
        var f_BASEFRAME_POS_0_OFFSET = 0;
        var f_BASEFRAME_POS_1_OFFSET = 4;
        var f_BASEFRAME_POS_2_OFFSET = 8;
        var f_BASEFRAME_POS_3_OFFSET = 12;
        var f_BASEFRAME_ORIENT_0_OFFSET = 16;
        var f_BASEFRAME_ORIENT_1_OFFSET = 20;
        var f_BASEFRAME_ORIENT_2_OFFSET = 24;
        var f_BASEFRAME_ORIENT_3_OFFSET = 28;
        
        // Frames Struct
        var FRAMES_STRUCT_SIZE = 8;
        var i_FRAMES_PTR_OFFSET = 0;
        var i_FRAMES_LENGTH_OFFSET = 4;
        
        // Frame
        var FRAME_STRUCT_SIZE = 4;
        var f_FRAME_VALUE_OFFSET = 0;

        function asmGetFrameJoints(frame) {
            frame = frame|0;
            
            var i = 0, j = 0,
                animationPtr = 0, modelPtr = 0, jointsPtr = 0,
                baseFrameLength = 0, baseFramePtr = 0,
                hierarchyLength = 0, hierarchyArrayPtr = 0,
                framesArrayLength = 0, framesArrayPtr = 0, framesStructPtr = 0, framesPtr = 0,
                baseJointPtr = 0, hierarchyPtr = 0, frameIndex = 0, parentIndex = 0,
                flags = 0,
                posX = 0.0, posY = 0.0, posZ = 0.0, parentPosX = 0.0, parentPosY = 0.0, parentPosZ = 0.0,
                orientX = 0.0, orientY = 0.0, orientZ = 0.0, orientW = 0.0,
                parentOrientX = 0.0, parentOrientY = 0.0, parentOrientZ = 0.0, parentOrientW = 0.0,
                ix = 0.0, iy = 0.0, iz = 0.0, iw = 0.0,
                parentJointPtr = 0, jointPtr = 0,
                temp = 0.0;
            
            animationPtr = HEAP32[(HEAP_BASE + i_ANIMATION_STRUCT_PTR_OFFSET)>>2]|0;
            modelPtr = HEAP32[(HEAP_BASE + i_MODEL_STRUCT_PTR_OFFSET)>>2]|0;
            jointsPtr = HEAP32[(modelPtr + i_MODEL_JOINTS_PTR_OFFSET)>>2]|0;
            
            hierarchyArrayPtr = HEAP32[(animationPtr + i_ANIMATION_HIERARCHY_PTR_OFFSET)>>2]|0;
            hierarchyLength = HEAP32[(animationPtr + i_ANIMATION_HIERARCHY_LENGTH_OFFSET)>>2]|0;
            baseFramePtr = HEAP32[(animationPtr + i_ANIMATION_BASEFRAME_PTR_OFFSET)>>2]|0;
            baseFrameLength = HEAP32[(animationPtr + i_ANIMATION_BASEFRAME_LENGTH_OFFSET)>>2]|0;
            framesArrayPtr = HEAP32[(animationPtr + i_ANIMATION_FRAMES_PTR_OFFSET)>>2]|0;
            framesArrayLength = HEAP32[(animationPtr + i_ANIMATION_FRAMES_LENGTH_OFFSET)>>2]|0;
            
            frame = ((frame|0) % (framesArrayLength|0))|0;
            framesStructPtr = (framesArrayPtr + (imul(frame, FRAMES_STRUCT_SIZE)|0))|0;
            framesPtr = HEAP32[(framesStructPtr + i_FRAMES_PTR_OFFSET)>>2]|0;
            
            for (i = 0; (i|0) < (baseFrameLength|0); i = (i + 1)|0) {
                baseJointPtr = (baseFramePtr + (imul(i, BASEFRAME_STRUCT_SIZE)|0))|0;
                posX = +(HEAPF32[(baseJointPtr + f_BASEFRAME_POS_0_OFFSET)>>2]);
                posY = +(HEAPF32[(baseJointPtr + f_BASEFRAME_POS_1_OFFSET)>>2]);
                posZ = +(HEAPF32[(baseJointPtr + f_BASEFRAME_POS_2_OFFSET)>>2]);
                orientX = +(HEAPF32[(baseJointPtr + f_BASEFRAME_ORIENT_0_OFFSET)>>2]);
                orientY = +(HEAPF32[(baseJointPtr + f_BASEFRAME_ORIENT_1_OFFSET)>>2]);
                orientZ = +(HEAPF32[(baseJointPtr + f_BASEFRAME_ORIENT_2_OFFSET)>>2]);
                
                hierarchyPtr = (hierarchyArrayPtr + (imul(i, HIERARCHY_STRUCT_SIZE)|0))|0;
                parentIndex = HEAP32[(hierarchyPtr + i_HIERARCHY_PARENT_OFFSET)>>2]|0;
                flags = HEAP32[(hierarchyPtr + i_HIERARCHY_FLAGS_OFFSET)>>2]|0;
                frameIndex = HEAP32[(hierarchyPtr + i_HIERARCHY_INDEX_OFFSET)>>2]|0;
                
                j = 0|0;
                
                if (flags & 1) { // Translate X
                    posX = +(HEAPF32[(framesPtr + (imul(frameIndex, FRAME_STRUCT_SIZE)|0) + j)>>2]);
                    j = (j + FRAME_STRUCT_SIZE)|0;
                }
    
                if (flags & 2) { // Translate Y
                    posY = +(HEAPF32[(framesPtr + (imul(frameIndex, FRAME_STRUCT_SIZE)|0) + j)>>2]);
                    j = (j + FRAME_STRUCT_SIZE)|0;
                }
    
                if (flags & 4) { // Translate Z
                    posZ = +(HEAPF32[(framesPtr + (imul(frameIndex, FRAME_STRUCT_SIZE)|0) + j)>>2]);
                    j = (j + FRAME_STRUCT_SIZE)|0;
                }
    
                if (flags & 8) { // Orient X
                    orientX = +(HEAPF32[(framesPtr + (imul(frameIndex, FRAME_STRUCT_SIZE)|0) + j)>>2]);
                    j = (j + FRAME_STRUCT_SIZE)|0;
                }
    
                if (flags & 16) { // Orient Y
                    orientY = +(HEAPF32[(framesPtr + (imul(frameIndex, FRAME_STRUCT_SIZE)|0) + j)>>2]);
                    j = (j + FRAME_STRUCT_SIZE)|0;
                }
    
                if (flags & 32) { // Orient Z
                    orientZ = +(HEAPF32[(framesPtr + (imul(frameIndex, FRAME_STRUCT_SIZE)|0) + j)>>2]);
                    j = (j + FRAME_STRUCT_SIZE)|0;
                }
                
                temp = 1.0 - orientX * orientX - orientY * orientY - orientZ * orientZ;
                orientW = -sqrt(abs(temp));
                    
                if ((parentIndex|0) >= (0|0)) {
                    parentJointPtr = (jointsPtr + (imul(parentIndex, JOINT_STRUCT_SIZE)|0))|0;
                    parentPosX = +(HEAPF32[(parentJointPtr + f_JOINT_POS_0_OFFSET)>>2]);
                    parentPosY = +(HEAPF32[(parentJointPtr + f_JOINT_POS_1_OFFSET)>>2]);
                    parentPosZ = +(HEAPF32[(parentJointPtr + f_JOINT_POS_2_OFFSET)>>2]);
                    parentOrientX = +(HEAPF32[(parentJointPtr + f_JOINT_ORIENT_0_OFFSET)>>2]);
                    parentOrientY = +(HEAPF32[(parentJointPtr + f_JOINT_ORIENT_1_OFFSET)>>2]);
                    parentOrientZ = +(HEAPF32[(parentJointPtr + f_JOINT_ORIENT_2_OFFSET)>>2]);
                    parentOrientW = +(HEAPF32[(parentJointPtr + f_JOINT_ORIENT_3_OFFSET)>>2]);
                    
                    ix = parentOrientW * posX + parentOrientY * posZ - parentOrientZ * posY;
                    iy = parentOrientW * posY + parentOrientZ * posX - parentOrientX * posZ;
                    iz = parentOrientW * posZ + parentOrientX * posY - parentOrientY * posX;
                    iw = -parentOrientX * posX - parentOrientY * posY - parentOrientZ * posZ;

                    posX = ix * parentOrientW + iw * -parentOrientX + iy * -parentOrientZ - iz * -parentOrientY;
                    posY = iy * parentOrientW + iw * -parentOrientY + iz * -parentOrientX - ix * -parentOrientZ;
                    posZ = iz * parentOrientW + iw * -parentOrientZ + ix * -parentOrientY - iy * -parentOrientX;

                    posX = posX + parentPosX;
                    posY = posY + parentPosY;
                    posZ = posZ + parentPosZ;
                    
                    ix = parentOrientX * orientW + parentOrientW * orientX + parentOrientY * orientZ - parentOrientZ * orientY;
                    iy = parentOrientY * orientW + parentOrientW * orientY + parentOrientZ * orientX - parentOrientX * orientZ;
                    iz = parentOrientZ * orientW + parentOrientW * orientZ + parentOrientX * orientY - parentOrientY * orientX;
                    iw = parentOrientW * orientW - parentOrientX * orientX - parentOrientY * orientY - parentOrientZ * orientZ;
                    orientX = ix;
                    orientY = iy;
                    orientZ = iz;
                    orientW = iw;
                }
                
                jointPtr = (jointsPtr + (imul(i, JOINT_STRUCT_SIZE)|0))|0;
                HEAPF32[(jointPtr + f_JOINT_POS_0_OFFSET)>>2] = posX;
                HEAPF32[(jointPtr + f_JOINT_POS_1_OFFSET)>>2] = posY;
                HEAPF32[(jointPtr + f_JOINT_POS_2_OFFSET)>>2] = posZ;
                HEAPF32[(jointPtr + f_JOINT_ORIENT_0_OFFSET)>>2] = orientX;
                HEAPF32[(jointPtr + f_JOINT_ORIENT_1_OFFSET)>>2] = orientY;
                HEAPF32[(jointPtr + f_JOINT_ORIENT_2_OFFSET)>>2] = orientZ;
                HEAPF32[(jointPtr + f_JOINT_ORIENT_3_OFFSET)>>2] = orientW;
            }
        }

        function asmSkin() {
            var i = 0, j = 0, k = 0;
            var vx = 0.0, vy = 0.0, vz = 0.0,
                nx = 0.0, ny = 0.0, nz = 0.0,
                tx = 0.0, ty = 0.0, tz = 0.0,
                rx = 0.0, ry = 0.0, rz = 0.0,
                x = 0.0, y = 0.0, z = 0.0,
                qx = 0.0, qy = 0.0, qz = 0.0, qw = 0.0,
                ix = 0.0, iy = 0.0, iz = 0.0, iw = 0.0,
                weightBias = 0.0;

            var modelPtr = 0,
                meshesPtr = 0, meshesLength = 0,
                jointsPtr = 0, jointsLength = 0,
                vertexArrayPtr = 0;

            var meshPtr = 0, vertsPtr = 0, vertsLength = 0,
                weightsPtr = 0, weightsLength = 0, vertPtr = 0, vertWeightsCount = 0,
                vertWeightsIndex = 0, weightPtr = 0, jointPtr = 0, vertexPtr = 0,
                jointIndex = 0, meshOffset = 0;

            modelPtr = HEAP32[(HEAP_BASE + i_MODEL_STRUCT_PTR_OFFSET)>>2]|0;
            meshesPtr = HEAP32[(modelPtr + i_MODEL_MESHES_PTR_OFFSET)>>2]|0; 
            meshesLength = HEAP32[(modelPtr + i_MODEL_MESHES_LENGTH_OFFSET)>>2]|0;
            jointsPtr = HEAP32[(modelPtr + i_MODEL_JOINTS_PTR_OFFSET)>>2]|0;
            jointsLength = HEAP32[(modelPtr + i_MODEL_JOINTS_LENGTH_OFFSET)>>2]|0;
            vertexArrayPtr = HEAP32[(HEAP_BASE + i_VERT_ARRAY_PTR_OFFSET)>>2]|0;
            
            for(i = 0; (i|0) < (meshesLength|0); i = (i + 1)|0) {
                meshPtr = (meshesPtr + (imul(i, MESH_STRUCT_SIZE)|0))|0;
                meshOffset = (HEAP32[(meshPtr + i_MESH_VERT_OFFSET_OFFSET)>>2]|0)<<2;
                meshOffset = (meshOffset + vertexArrayPtr)|0;
                vertsPtr = HEAP32[(meshPtr + i_MESH_VERTS_PTR_OFFSET)>>2]|0;
                vertsLength = HEAP32[(meshPtr + i_MESH_VERTS_LENGTH_OFFSET)>>2]|0;
                weightsPtr = HEAP32[(meshPtr + i_MESH_WEIGHTS_PTR_OFFSET)>>2]|0;
                weightsLength = HEAP32[(meshPtr + i_MESH_WEIGHTS_LENGTH_OFFSET)>>2]|0;

                // Calculate transformed vertices in the bind pose
                for(j = 0; (j|0) < (vertsLength|0); j = (j + 1)|0) {
                    vertexPtr = ((imul(j, VERTEX_STRIDE)|0) + meshOffset)|0;
                    vertPtr = (vertsPtr + (imul(j, VERT_STRUCT_SIZE)|0))|0;

                    vx = 0.0; vy = 0.0; vz = 0.0;
                    nx = 0.0; ny = 0.0; nz = 0.0;
                    tx = 0.0; ty = 0.0; tz = 0.0;

                    vertWeightsIndex = HEAP32[(vertPtr + i_VERT_WEIGHT_INDEX_OFFSET)>>2]|0;
                    vertWeightsCount = HEAP32[(vertPtr + i_VERT_WEIGHT_COUNT_OFFSET)>>2]|0;
                    for (k = 0; (k|0) < (vertWeightsCount|0); k = (k + 1)|0) {
                        weightPtr = (weightsPtr + imul((k + vertWeightsIndex|0)|0, WEIGHT_STRUCT_SIZE)|0)|0;
                        jointIndex = HEAP32[(weightPtr + i_WEIGHT_JOINT_INDEX_OFFSET)>>2]|0;
                        jointPtr = (jointsPtr + (imul(jointIndex, JOINT_STRUCT_SIZE)|0)|0);

                        // Rotate position
                        x = +(HEAPF32[(weightPtr + f_WEIGHT_POS_0_OFFSET)>>2]);
                        y = +(HEAPF32[(weightPtr + f_WEIGHT_POS_1_OFFSET)>>2]);
                        z = +(HEAPF32[(weightPtr + f_WEIGHT_POS_2_OFFSET)>>2]);
                        qx = +(HEAPF32[(jointPtr + f_JOINT_ORIENT_0_OFFSET)>>2]);
                        qy = +(HEAPF32[(jointPtr + f_JOINT_ORIENT_1_OFFSET)>>2]);
                        qz = +(HEAPF32[(jointPtr + f_JOINT_ORIENT_2_OFFSET)>>2]);
                        qw = +(HEAPF32[(jointPtr + f_JOINT_ORIENT_3_OFFSET)>>2]);

                        // calculate quat * vec
                        ix = qw * x + qy * z - qz * y;
                        iy = qw * y + qz * x - qx * z;
                        iz = qw * z + qx * y - qy * x;
                        iw = -qx * x - qy * y - qz * z;

                        // calculate result * inverse quat
                        rx = ix * qw + iw * -qx + iy * -qz - iz * -qy;
                        ry = iy * qw + iw * -qy + iz * -qx - ix * -qz;
                        rz = iz * qw + iw * -qz + ix * -qy - iy * -qx;

                        // Translate position
                        weightBias = +(HEAPF32[(weightPtr + f_WEIGHT_BIAS_OFFSET)>>2]);
                        vx = (+(HEAPF32[(jointPtr + f_JOINT_POS_0_OFFSET)>>2]) + rx) * weightBias + vx;
                        vy = (+(HEAPF32[(jointPtr + f_JOINT_POS_1_OFFSET)>>2]) + ry) * weightBias + vy;
                        vz = (+(HEAPF32[(jointPtr + f_JOINT_POS_2_OFFSET)>>2]) + rz) * weightBias + vz;

                        // Rotate Normal
                        x = +(HEAPF32[(weightPtr + f_WEIGHT_NORMAL_0_OFFSET)>>2]);
                        y = +(HEAPF32[(weightPtr + f_WEIGHT_NORMAL_1_OFFSET)>>2]);
                        z = +(HEAPF32[(weightPtr + f_WEIGHT_NORMAL_2_OFFSET)>>2]);

                        // calculate quat * vec
                        ix = qw * x + qy * z - qz * y;
                        iy = qw * y + qz * x - qx * z;
                        iz = qw * z + qx * y - qy * x;
                        iw = -qx * x - qy * y - qz * z;

                        // calculate result * inverse quat
                        rx = ix * qw + iw * -qx + iy * -qz - iz * -qy;
                        ry = iy * qw + iw * -qy + iz * -qx - ix * -qz;
                        rz = iz * qw + iw * -qz + ix * -qy - iy * -qx;

                        nx = rx * weightBias + nx;
                        ny = ry * weightBias + ny;
                        nz = rz * weightBias + nz;

                        // Rotate Tangent
                        x = +(HEAPF32[(weightPtr + f_WEIGHT_TANGENT_0_OFFSET)>>2]);
                        y = +(HEAPF32[(weightPtr + f_WEIGHT_TANGENT_1_OFFSET)>>2]);
                        z = +(HEAPF32[(weightPtr + f_WEIGHT_TANGENT_2_OFFSET)>>2]);

                        // calculate quat * vec
                        ix = qw * x + qy * z - qz * y;
                        iy = qw * y + qz * x - qx * z;
                        iz = qw * z + qx * y - qy * x;
                        iw = -qx * x - qy * y - qz * z;

                        // calculate result * inverse quat
                        rx = ix * qw + iw * -qx + iy * -qz - iz * -qy;
                        ry = iy * qw + iw * -qy + iz * -qx - ix * -qz;
                        rz = iz * qw + iw * -qz + ix * -qy - iy * -qx;

                        tx = rx * weightBias + tx;
                        ty = ry * weightBias + ty;
                        tz = rz * weightBias + tz;
                    }
                    // Position
                    HEAPF32[(vertexPtr + f_VERTEX_POS_0_OFFSET)>>2] = vx;
                    HEAPF32[(vertexPtr + f_VERTEX_POS_1_OFFSET)>>2] = vy;
                    HEAPF32[(vertexPtr + f_VERTEX_POS_2_OFFSET)>>2] = vz;

                    // TexCoord
                    HEAPF32[(vertexPtr + f_VERTEX_UV_0_OFFSET)>>2] = HEAPF32[(vertPtr + f_VERT_TEXCOORD_0_OFFSET)>>2];
                    HEAPF32[(vertexPtr + f_VERTEX_UV_1_OFFSET)>>2] = HEAPF32[(vertPtr + f_VERT_TEXCOORD_1_OFFSET)>>2];

                    // Normal
                    HEAPF32[(vertexPtr + f_VERTEX_NORMAL_0_OFFSET)>>2] = nx;
                    HEAPF32[(vertexPtr + f_VERTEX_NORMAL_1_OFFSET)>>2] = ny;
                    HEAPF32[(vertexPtr + f_VERTEX_NORMAL_2_OFFSET)>>2] = nz;

                    // Tangent
                    HEAPF32[(vertexPtr + f_VERTEX_TANGENT_0_OFFSET)>>2] = tx;
                    HEAPF32[(vertexPtr + f_VERTEX_TANGENT_1_OFFSET)>>2] = ty;
                    HEAPF32[(vertexPtr + f_VERTEX_TANGENT_2_OFFSET)>>2] = tz;
                }
            }
        }

        return {
            asmSkin: asmSkin,
            asmGetFrameJoints: asmGetFrameJoints
        };
    }
    
    function _asmjsModuleSIMD (global, imp, buffer) {
        "use asm";
        var HEAPF32 = new global.Float32Array(buffer);
        var HEAP32 = new global.Int32Array(buffer);
        var HEAPU8 = new global.Uint8Array(buffer);
        var imul = global.Math.imul;
        var toF = global.Math.fround;
        var sqrt = global.Math.sqrt;
        var abs = global.Math.abs;
        var SIMD_float32x4 = global.SIMD.float32x4;
        var SIMD_float32x4_load = SIMD_float32x4.load;
        var SIMD_float32x4_store = SIMD_float32x4.store;
        var SIMD_float32x4_mul = SIMD_float32x4.mul;
        var SIMD_float32x4_add = SIMD_float32x4.add;
        var SIMD_float32x4_sub = SIMD_float32x4.sub;
        var SIMD_float32x4_swizzle = SIMD_float32x4.swizzle;
        var SIMD_float32x4_splat = SIMD_float32x4.splat;
        var VERTEX_ELEMENTS = 11; // 3 Pos, 2 UV, 3 Norm, 3 Tangent
        var VERTEX_STRIDE = 44;
        var f_VERTEX_POS_0_OFFSET = 0;
        var f_VERTEX_POS_1_OFFSET = 4;
        var f_VERTEX_POS_2_OFFSET = 8;
        var f_VERTEX_UV_0_OFFSET =  12;
        var f_VERTEX_UV_1_OFFSET = 16;
        var f_VERTEX_NORMAL_0_OFFSET = 20;
        var f_VERTEX_NORMAL_1_OFFSET = 24;
        var f_VERTEX_NORMAL_2_OFFSET = 28;
        var f_VERTEX_TANGENT_0_OFFSET = 32;
        var f_VERTEX_TANGENT_1_OFFSET = 36;
        var f_VERTEX_TANGENT_2_OFFSET = 40;
        
        // Memory Layout
        var HEAP_BASE = 0;
        // Header
        var HEADER_SIZE = 12;
        var i_MODEL_STRUCT_PTR_OFFSET = 0;
        var i_VERT_ARRAY_PTR_OFFSET = 4;
        var i_ANIMATION_STRUCT_PTR_OFFSET = 8;
        
        // Model struct
        var MODEL_STRUCT_SIZE = 16;
        var i_MODEL_MESHES_PTR_OFFSET = 0;
        var i_MODEL_MESHES_LENGTH_OFFSET = 4;
        var i_MODEL_JOINTS_PTR_OFFSET = 8;
        var i_MODEL_JOINTS_LENGTH_OFFSET = 12; 
        
        // Mesh struct
        var MESH_STRUCT_SIZE = 20;
        var i_MESH_VERT_OFFSET_OFFSET = 0;
        var i_MESH_VERTS_PTR_OFFSET = 4;
        var i_MESH_VERTS_LENGTH_OFFSET = 8;
        var i_MESH_WEIGHTS_PTR_OFFSET = 12;
        var i_MESH_WEIGHTS_LENGTH_OFFSET = 16;
        
        // Vert struct
        var VERT_STRUCT_SIZE = 16;
        var f_VERT_TEXCOORD_0_OFFSET = 0;
        var f_VERT_TEXCOORD_1_OFFSET = 4;
        var i_VERT_WEIGHT_INDEX_OFFSET = 8;
        var i_VERT_WEIGHT_COUNT_OFFSET = 12;
        
        // Weight struct
        var WEIGHT_STRUCT_SIZE = 56;
        var i_WEIGHT_JOINT_INDEX_OFFSET = 0;
        var f_WEIGHT_BIAS_OFFSET = 4;
        var f_WEIGHT_POS_0_OFFSET = 8;
        var f_WEIGHT_POS_1_OFFSET = 12;
        var f_WEIGHT_POS_2_OFFSET = 16;
        var f_WEIGHT_POS_3_OFFSET = 20;
        var f_WEIGHT_NORMAL_0_OFFSET = 24;
        var f_WEIGHT_NORMAL_1_OFFSET = 28;
        var f_WEIGHT_NORMAL_2_OFFSET = 32;
        var f_WEIGHT_NORMAL_3_OFFSET = 36;
        var f_WEIGHT_TANGENT_0_OFFSET = 40;
        var f_WEIGHT_TANGENT_1_OFFSET = 44;
        var f_WEIGHT_TANGENT_2_OFFSET = 48;
        var f_WEIGHT_TANGENT_3_OFFSET = 52;
        
        // Joint struct
        var JOINT_STRUCT_SIZE = 32;
        var f_JOINT_POS_0_OFFSET = 0;
        var f_JOINT_POS_1_OFFSET = 4;
        var f_JOINT_POS_2_OFFSET = 8;
        var f_JOINT_POS_3_OFFSET = 12;
        var f_JOINT_ORIENT_0_OFFSET = 16;
        var f_JOINT_ORIENT_1_OFFSET = 20;
        var f_JOINT_ORIENT_2_OFFSET = 24;
        var f_JOINT_ORIENT_3_OFFSET = 28;
        
        // Animation Struct
        var ANIMATION_STRUCT_SIZE = 24;
        var i_ANIMATION_HIERARCHY_PTR_OFFSET = 0;
        var i_ANIMATION_HIERARCHY_LENGTH_OFFSET = 4;
        var i_ANIMATION_BASEFRAME_PTR_OFFSET = 8;
        var i_ANIMATION_BASEFRAME_LENGTH_OFFSET = 12;
        var i_ANIMATION_FRAMES_PTR_OFFSET = 16;
        var i_ANIMATION_FRAMES_LENGTH_OFFSET = 20;
        
        // Hierarchy Struct
        var HIERARCHY_STRUCT_SIZE = 12;
        var i_HIERARCHY_PARENT_OFFSET = 0;
        var i_HIERARCHY_FLAGS_OFFSET = 4;
        var i_HIERARCHY_INDEX_OFFSET = 8;
        
        // BaseFrame Struct
        var BASEFRAME_STRUCT_SIZE = 32;
        var f_BASEFRAME_POS_0_OFFSET = 0;
        var f_BASEFRAME_POS_1_OFFSET = 4;
        var f_BASEFRAME_POS_2_OFFSET = 8;
        var f_BASEFRAME_POS_3_OFFSET = 12;
        var f_BASEFRAME_ORIENT_0_OFFSET = 16;
        var f_BASEFRAME_ORIENT_1_OFFSET = 20;
        var f_BASEFRAME_ORIENT_2_OFFSET = 24;
        var f_BASEFRAME_ORIENT_3_OFFSET = 28;
        
        // Frames Struct
        var FRAMES_STRUCT_SIZE = 8;
        var i_FRAMES_PTR_OFFSET = 0;
        var i_FRAMES_LENGTH_OFFSET = 4;
        
        // Frame
        var FRAME_STRUCT_SIZE = 4;
        var f_FRAME_VALUE_OFFSET = 0;
        
        function asmSkinSIMD() {
            var i = 0, j = 0, k = 0;
            var modelPtr = 0,
                meshesPtr = 0, meshesLength = 0,
                jointsPtr = 0, jointsLength = 0,
                vertexArrayPtr = 0;

            var meshPtr = 0, vertsPtr = 0, vertsLength = 0,
                weightsPtr = 0, weightsLength = 0, vertPtr = 0, vertWeightsCount = 0,
                vertWeightsIndex = 0, weightPtr = 0, jointPtr = 0, vertexPtr = 0,
                jointIndex = 0, meshOffset = 0;
                
            var rotatedPos = SIMD_float32x4(0, 0, 0, 0), jointOrient = SIMD_float32x4(0, 0, 0, 0),
                weightPos = SIMD_float32x4(0, 0, 0, 0), ix4 = SIMD_float32x4(0, 0, 0, 0),
                jointPos = SIMD_float32x4(0, 0, 0, 0), weightBias = SIMD_float32x4(0, 0, 0, 0),
                vx4 = SIMD_float32x4(0, 0, 0, 0), weightNormal = SIMD_float32x4(0, 0, 0, 0),
                nx4 = SIMD_float32x4(0, 0, 0, 0), weightTangent = SIMD_float32x4(0, 0, 0, 0),
                tempx4 = SIMD_float32x4(1, 1, 1, -1), tx4 = SIMD_float32x4(0, 0, 0, 0);
                

            modelPtr = HEAP32[(HEAP_BASE + i_MODEL_STRUCT_PTR_OFFSET)>>2]|0;
            meshesPtr = HEAP32[(modelPtr + i_MODEL_MESHES_PTR_OFFSET)>>2]|0; 
            meshesLength = HEAP32[(modelPtr + i_MODEL_MESHES_LENGTH_OFFSET)>>2]|0;
            jointsPtr = HEAP32[(modelPtr + i_MODEL_JOINTS_PTR_OFFSET)>>2]|0;
            jointsLength = HEAP32[(modelPtr + i_MODEL_JOINTS_LENGTH_OFFSET)>>2]|0;
            vertexArrayPtr = HEAP32[(HEAP_BASE + i_VERT_ARRAY_PTR_OFFSET)>>2]|0;
            
            for(i = 0; (i|0) < (meshesLength|0); i = (i + 1)|0) {
                meshPtr = (meshesPtr + (imul(i, MESH_STRUCT_SIZE)|0))|0;
                meshOffset = (HEAP32[(meshPtr + i_MESH_VERT_OFFSET_OFFSET)>>2]|0)<<2;
                meshOffset = (meshOffset + vertexArrayPtr)|0;
                vertsPtr = HEAP32[(meshPtr + i_MESH_VERTS_PTR_OFFSET)>>2]|0;
                vertsLength = HEAP32[(meshPtr + i_MESH_VERTS_LENGTH_OFFSET)>>2]|0;
                weightsPtr = HEAP32[(meshPtr + i_MESH_WEIGHTS_PTR_OFFSET)>>2]|0;
                weightsLength = HEAP32[(meshPtr + i_MESH_WEIGHTS_LENGTH_OFFSET)>>2]|0;
                
                // Calculate transformed vertices in the bind pose
                for(j = 0; (j|0) < (vertsLength|0); j = (j + 1)|0) {
                    vertexPtr = ((imul(j, VERTEX_STRIDE)|0) + meshOffset)|0;
                    vertPtr = (vertsPtr + (imul(j, VERT_STRUCT_SIZE)|0))|0;
                    
                    vx4 = SIMD_float32x4_splat(toF(0));
                    nx4 = SIMD_float32x4_splat(toF(0));
                    tx4 = SIMD_float32x4_splat(toF(0));

                    vertWeightsIndex = HEAP32[(vertPtr + i_VERT_WEIGHT_INDEX_OFFSET)>>2]|0;
                    vertWeightsCount = HEAP32[(vertPtr + i_VERT_WEIGHT_COUNT_OFFSET)>>2]|0;
                    for (k = 0; (k|0) < (vertWeightsCount|0); k = (k + 1)|0) {
                        weightPtr = (weightsPtr + imul((k + vertWeightsIndex|0)|0, WEIGHT_STRUCT_SIZE)|0)|0;
                        jointIndex = HEAP32[(weightPtr + i_WEIGHT_JOINT_INDEX_OFFSET)>>2]|0;
                        jointPtr = (jointsPtr + (imul(jointIndex, JOINT_STRUCT_SIZE)|0)|0);

                        // Rotate position
                        jointOrient = SIMD_float32x4_load(HEAPU8, (jointPtr + f_JOINT_ORIENT_0_OFFSET)|0);
                        weightPos = SIMD_float32x4_load(HEAPU8, (weightPtr + f_WEIGHT_POS_0_OFFSET)|0);
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
    
                        jointPos = SIMD_float32x4_load(HEAPU8, (jointPtr + f_JOINT_POS_0_OFFSET)|0);
                        weightBias = SIMD_float32x4_swizzle(SIMD_float32x4_load(HEAPU8, (weightPtr + f_WEIGHT_BIAS_OFFSET)|0), 0, 0, 0, 0);
    
                        // Translate position
                        vx4 = SIMD_float32x4_add(vx4, SIMD_float32x4_mul(SIMD_float32x4_add(jointPos, rotatedPos), weightBias));
    
                        // Rotate Normal
                        weightNormal = SIMD_float32x4_load(HEAPU8, (weightPtr + f_WEIGHT_NORMAL_0_OFFSET)|0);
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
                        weightTangent = SIMD_float32x4_load(HEAPU8, (weightPtr + f_WEIGHT_TANGENT_0_OFFSET)|0);
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
                    SIMD_float32x4_store(HEAPU8, (vertexPtr + f_VERTEX_POS_0_OFFSET)|0, vx4);
    
                    // TexCoord
                    SIMD_float32x4_store(HEAPU8, (vertexPtr + f_VERTEX_UV_0_OFFSET)|0, SIMD_float32x4_load(HEAPU8, (vertPtr + f_VERT_TEXCOORD_0_OFFSET)|0));
    
                    // Normal
                    SIMD_float32x4_store(HEAPU8, (vertexPtr + f_VERTEX_NORMAL_0_OFFSET)|0, nx4);
    
                    // Tangent
                    SIMD_float32x4_store(HEAPU8, (vertexPtr + f_VERTEX_TANGENT_0_OFFSET)|0, tx4);
                }
            }
        }
        
        return {
            asmSkinSIMD: asmSkinSIMD,
        };
    }

    Md5Mesh.prototype.setAnimationFrame = function(gl, animation, frame) {
        this.asmGetFrameJoints(frame);
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
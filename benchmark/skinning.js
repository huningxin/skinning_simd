
(function () {

  // Kernel configuration
  var kernelConfig = {
    kernelName:       "Skinning",
    kernelInit:       init,
    kernelCleanup:    cleanup,
    kernelSimd:       simd,
    kernelNonSimd:    nonSimd,
    kernelIterations: 100000000
  };

  // Hook up to the harness
  benchmarks.add (new Benchmark (kernelConfig));

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
  
  var VERTEX_ELEMENTS = 11;
  var VERTEX_STRIDE = 44;

  var MODEL_MESHES_LENGTH = 4;
  var MODEL_JOINTS_LENGTH = 100;
  var MESH_VERTS_LENGTH = 100;
  var MESH_WEIGHTS_LENGTH = 100;
  var VERT_WEIGHT_COUNT = 100;

  function initializeArrayBuffer(buffer) {
      var HEAPF32 = new Float32Array(buffer);
      var HEAP32 = new Int32Array(buffer);
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
      HEAP32[(model_ptr + i_MODEL_MESHES_LENGTH_OFFSET)>>2] = MODEL_MESHES_LENGTH;//model.meshes.length;
      HEAP32[(model_ptr + i_MODEL_JOINTS_PTR_OFFSET)>>2] = 0;
      HEAP32[(model_ptr + i_MODEL_JOINTS_LENGTH_OFFSET)>>2] = MODEL_JOINTS_LENGTH;//model.joints.length;
      
      // Allocate mesh struct arrays
      HEAP32[(model_ptr + i_MODEL_MESHES_PTR_OFFSET)>>2] = ptr;
      var meshes_ptr = ptr;
      ptr += MESH_STRUCT_SIZE * MODEL_MESHES_LENGTH;//model.meshes.length;
      for(var i = 0; i < MODEL_MESHES_LENGTH; ++i) {
          HEAP32[(meshes_ptr + i * MESH_STRUCT_SIZE + i_MESH_VERT_OFFSET_OFFSET)>>2] = 0;
          HEAP32[(meshes_ptr + i * MESH_STRUCT_SIZE + i_MESH_VERTS_PTR_OFFSET)>>2] = 0;
          HEAP32[(meshes_ptr + i * MESH_STRUCT_SIZE + i_MESH_VERTS_LENGTH_OFFSET)>>2] = MESH_VERTS_LENGTH;
          HEAP32[(meshes_ptr + i * MESH_STRUCT_SIZE + i_MESH_WEIGHTS_PTR_OFFSET)>>2] = 0;
          HEAP32[(meshes_ptr + i * MESH_STRUCT_SIZE + i_MESH_WEIGHTS_LENGTH_OFFSET)>>2] = MESH_WEIGHTS_LENGTH;
         
         // Allocate vert array of mesh
         var verts_array_ptr = ptr;
         HEAP32[(meshes_ptr + i * MESH_STRUCT_SIZE + i_MESH_VERTS_PTR_OFFSET)>>2] = ptr;
         ptr += VERT_STRUCT_SIZE * MESH_VERTS_LENGTH;
          for(var j = 0; j < MESH_VERTS_LENGTH; ++j) {
              numOfVerts++;
              HEAPF32[(verts_array_ptr + j * VERT_STRUCT_SIZE + f_VERT_TEXCOORD_0_OFFSET)>>2] = 0.1;
              HEAPF32[(verts_array_ptr + j * VERT_STRUCT_SIZE + f_VERT_TEXCOORD_1_OFFSET)>>2] = 0.1;
              HEAP32[(verts_array_ptr + j * VERT_STRUCT_SIZE + i_VERT_WEIGHT_INDEX_OFFSET)>>2] = 0;//vert.weight.index;
              HEAP32[(verts_array_ptr + j * VERT_STRUCT_SIZE + i_VERT_WEIGHT_COUNT_OFFSET)>>2] = VERT_WEIGHT_COUNT;
          }
          // Allocate weight array of mesh
          var weights_array_ptr = ptr;
          HEAP32[(meshes_ptr + i * MESH_STRUCT_SIZE + i_MESH_WEIGHTS_PTR_OFFSET)>>2] = weights_array_ptr;
          ptr += WEIGHT_STRUCT_SIZE * MESH_WEIGHTS_LENGTH;
          for (var j = 0; j < MESH_WEIGHTS_LENGTH; ++j) {
              HEAP32[(weights_array_ptr + j * WEIGHT_STRUCT_SIZE + i_WEIGHT_JOINT_INDEX_OFFSET)>>2] = 0;//weight.joint;
              HEAPF32[(weights_array_ptr + j * WEIGHT_STRUCT_SIZE + f_WEIGHT_BIAS_OFFSET)>>2] = 0.1;//weight.bias;
              HEAPF32[(weights_array_ptr + j * WEIGHT_STRUCT_SIZE + f_WEIGHT_POS_0_OFFSET)>>2] = 0.1;//weight.pos[0];
              HEAPF32[(weights_array_ptr + j * WEIGHT_STRUCT_SIZE + f_WEIGHT_POS_1_OFFSET)>>2] = 0.1;//weight.pos[1];
              HEAPF32[(weights_array_ptr + j * WEIGHT_STRUCT_SIZE + f_WEIGHT_POS_2_OFFSET)>>2] = 0.1;//weight.pos[2];
              HEAPF32[(weights_array_ptr + j * WEIGHT_STRUCT_SIZE + f_WEIGHT_POS_3_OFFSET)>>2] = 0;
              HEAPF32[(weights_array_ptr + j * WEIGHT_STRUCT_SIZE + f_WEIGHT_NORMAL_0_OFFSET)>>2] = 0.1;//weight.normal[0];
              HEAPF32[(weights_array_ptr + j * WEIGHT_STRUCT_SIZE + f_WEIGHT_NORMAL_1_OFFSET)>>2] = 0.1;//weight.normal[1];
              HEAPF32[(weights_array_ptr + j * WEIGHT_STRUCT_SIZE + f_WEIGHT_NORMAL_2_OFFSET)>>2] = 0.1;//weight.normal[2];
              HEAPF32[(weights_array_ptr + j * WEIGHT_STRUCT_SIZE + f_WEIGHT_NORMAL_3_OFFSET)>>2] = 0;
              HEAPF32[(weights_array_ptr + j * WEIGHT_STRUCT_SIZE + f_WEIGHT_TANGENT_0_OFFSET)>>2] = 0.1;//weight.tangent[0];
              HEAPF32[(weights_array_ptr + j * WEIGHT_STRUCT_SIZE + f_WEIGHT_TANGENT_1_OFFSET)>>2] = 0.1;//weight.tangent[1];
              HEAPF32[(weights_array_ptr + j * WEIGHT_STRUCT_SIZE + f_WEIGHT_TANGENT_2_OFFSET)>>2] = 0.1;//weight.tangent[2];
              HEAPF32[(weights_array_ptr + j * WEIGHT_STRUCT_SIZE + f_WEIGHT_TANGENT_3_OFFSET)>>2] = 0;
          }
      }

      // Allocate joints
      var joints_ptr = ptr;
      HEAP32[(model_ptr + i_MODEL_JOINTS_PTR_OFFSET)>>2] = ptr;
      ptr += JOINT_STRUCT_SIZE * MODEL_JOINTS_LENGTH;
      for (var i = 0; i < MODEL_JOINTS_LENGTH; ++i) {
          HEAPF32[(joints_ptr + i * JOINT_STRUCT_SIZE + f_JOINT_POS_0_OFFSET)>>2] = 0.1;
          HEAPF32[(joints_ptr + i * JOINT_STRUCT_SIZE + f_JOINT_POS_1_OFFSET)>>2] = 0.1;
          HEAPF32[(joints_ptr + i * JOINT_STRUCT_SIZE + f_JOINT_POS_2_OFFSET)>>2] = 0.1;
          HEAPF32[(joints_ptr + i * JOINT_STRUCT_SIZE + f_JOINT_POS_3_OFFSET)>>2] = 0;
          HEAPF32[(joints_ptr + i * JOINT_STRUCT_SIZE + f_JOINT_ORIENT_0_OFFSET)>>2] = 0.1;
          HEAPF32[(joints_ptr + i * JOINT_STRUCT_SIZE + f_JOINT_ORIENT_1_OFFSET)>>2] = 0.1;
          HEAPF32[(joints_ptr + i * JOINT_STRUCT_SIZE + f_JOINT_ORIENT_2_OFFSET)>>2] = 0.1;
          HEAPF32[(joints_ptr + i * JOINT_STRUCT_SIZE + f_JOINT_ORIENT_3_OFFSET)>>2] = 0.1;
      }

      // Allocate vert Array
      var vertex_array_ptr = ptr;
      HEAP32[(header_ptr + i_VERT_ARRAY_PTR_OFFSET)>>2] = ptr;
      ptr += numOfVerts * VERTEX_STRIDE;
      ptr += 4; // padding
      
      var animation_ptr = ptr;
      HEAP32[(header_ptr + i_ANIMATION_STRUCT_PTR_OFFSET)>>2] = ptr;
  };

  var buffer = new ArrayBuffer(512 * 1024);

  // Kernel Initializer
  function init () {
    initializeArrayBuffer(buffer);
    return simd (1) === nonSimd (1);
  }

  // Kernel Cleanup
  function cleanup () {
    return simd (1) === nonSimd (1);
  }

  function asmjsModule (global, imp, buffer) {
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

  function asmjsModuleSIMD (global, imp, buffer) {
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

  var skin = asmjsModule(this, {}, buffer).asmSkin;
  var skinSIMD = asmjsModuleSIMD(this, {}, buffer).asmSkinSIMD;

  // SIMD version of the kernel
  function simd (n) {
    for (var i = 0; i < n; ++i) {
      skinSIMD();
    }
    return true;
  }

  // Non SIMD version of the kernel
  function nonSimd (n) {
    for (var i = 0; i < n; ++i) {
      skin();
    }
    return true;
  }

} ());
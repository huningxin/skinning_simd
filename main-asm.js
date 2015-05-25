require.config({
    baseUrl: "js"
});

require([
    "util/gl-context-helper",
    "util/camera",
    "util/gl-util",
    "md5-asm",
    "util/gl-matrix-min",
    "js/util/game-shim.js",
    "js/util/Stats.js"
], function(GLContextHelper, Camera, GLUtil, MD5) {
    "use strict";

    // Shader
    var meshVS = [
        "attribute vec3 position;",
        "attribute vec2 texture;",
        "attribute vec3 normal;",
        "attribute vec3 tangent;",

        "uniform vec3 meshPos;",
        "uniform vec3 lightPos;",

        "uniform mat4 modelViewMat;",
        "uniform mat4 projectionMat;",
        "uniform mat3 modelViewInvMat;",

        "varying vec2 vTexCoord;",
        "varying vec3 tangentLightDir;",
        "varying vec3 tangentEyeDir;",

        "void main(void) {",
        " vec4 vPosition = modelViewMat * vec4(position + meshPos, 1.0);",
        " gl_Position = projectionMat * vPosition;",
        " vTexCoord = texture;",

        " vec3 n = normalize(normal * modelViewInvMat);",
        " vec3 t = normalize(tangent * modelViewInvMat);",
        " vec3 b = cross (n, t);",

        " mat3 tbnMat = mat3(t.x, b.x, n.x,",
        "                    t.y, b.y, n.y,",
        "                    t.z, b.z, n.z);",

        " vec3 lightDir = lightPos - vPosition.xyz;",
        " tangentLightDir = lightDir * tbnMat;",

        " vec3 eyeDir = normalize(-vPosition.xyz);",
        " tangentEyeDir = eyeDir * tbnMat;",
        "}"
    ].join("\n");

    // Fragment Shader
    var meshFS = [
        "precision mediump float;",

        "varying vec2 vTexCoord;",
        "varying vec3 tangentLightDir;",
        "varying vec3 tangentEyeDir;",

        "uniform sampler2D diffuse;",
        "uniform sampler2D specular;",
        "uniform sampler2D normalMap;",

        "uniform vec3 ambientLight;",
        "uniform vec3 lightColor;",
        "uniform vec3 specularColor;",
        "uniform float shininess;",

        "void main(void) {",
        " vec3 lightDir = normalize(tangentLightDir);",
        " vec3 normal = normalize(2.0 * (texture2D(normalMap, vTexCoord.st).rgb - 0.5));",
        " vec4 diffuseColor = texture2D(diffuse, vTexCoord.st);",

        " float specularLevel = texture2D(specular, vTexCoord.st).r;",

        " vec3 eyeDir = normalize(tangentEyeDir);",
        " vec3 reflectDir = reflect(-lightDir, normal);",
        " float specularFactor = pow(clamp(dot(reflectDir, eyeDir), 0.0, 1.0), shininess) * specularLevel;",

        " float lightFactor = max(dot(lightDir, normal), 0.0);",
        " vec3 lightValue = ambientLight + (lightColor * lightFactor) + (specularColor * specularFactor);",

        " gl_FragColor = vec4(diffuseColor.rgb * lightValue, diffuseColor.a);",
        "}"
    ].join("\n");

    var ambientLight = vec3.create([0.2, 0.2, 0.2]);
    var lightPos = vec3.create([3, 3, 3]);
    var lightColor = vec3.create([1, 1, 1]);
    var specularColor = vec3.create([1, 1, 1]);
    var shininess = 8;
    var meshIndex = 0;

    var meshNumber = document.getElementById("meshes");

    var Renderer = function (gl, canvas) {
        this.camera = new Camera.OrbitCamera(canvas);
        this.camera.setCenter([0, 0, 64]);
        this.camera.orbit(-Math.PI * 0.5, 0);
        this.camera.maxDistance = 1024;
        this.camera.setDistance(390);
        this.camera.minDistance = 32;
        
        this.projectionMat = mat4.create();
        this.modelViewInvMat = mat3.create();
        
        gl.clearColor(0.0, 0.0, 0.1, 1.0);
        gl.clearDepth(1.0);
        gl.enable(gl.DEPTH_TEST);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        
        this.handle = null;
        this.meshCount = 0;
        this.animations = [];
        this.meshShader = GLUtil.createProgram(gl, meshVS, meshFS);
        this.models = [];
        this.isLoading = false;
        this.allocateMeshes(gl, 200);
        if (this.handle === null) {
            var interval = 1000 / 24;
            var self = this;
            this.handle = setInterval(function() {
                for (var i = 0; i < self.meshCount; ++i) {
                    var model = self.models[i];
                    var anim = model.anim;
                    if (anim !== null) {
                        anim.currentFrame++;
                        model.setAnimationFrame(gl, anim.currentFrame);
                    }
                }
                bindVertexBuffer(gl);
            }, interval);
        }
    };

    Renderer.prototype.resize = function (gl, canvas) {
        var fov = 45;
        gl.viewport(0, 0, canvas.width, canvas.height);
        mat4.perspective(fov, canvas.width/canvas.height, 1.0, 4096.0, this.projectionMat);
    };

    Renderer.prototype.draw = function (gl, timing) {
        this.camera.update(timing.frameTime);

        var viewMat = this.camera.getViewMat();
        mat4.toInverseMat3(viewMat, this.modelViewInvMat);
        
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        var shader = this.meshShader;
        gl.useProgram(shader.program);

        gl.uniformMatrix4fv(shader.uniform.modelViewMat, false, viewMat);
        gl.uniformMatrix4fv(shader.uniform.projectionMat, false, this.projectionMat);
        gl.uniformMatrix3fv(shader.uniform.modelViewInvMat, false, this.modelViewInvMat);

        // Lighting
        gl.uniform3fv(shader.uniform.ambientLight, ambientLight);
        gl.uniform3fv(shader.uniform.lightPos, lightPos);
        gl.uniform3fv(shader.uniform.lightColor, lightColor);
        gl.uniform3fv(shader.uniform.specularColor, specularColor);
        gl.uniform1f(shader.uniform.shininess, shininess);

        gl.bindBuffer(gl.ARRAY_BUFFER, vertBuffer);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, diffuseMap);
        gl.uniform1i(shader.uniform.diffuse, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, specularMap);
        gl.uniform1i(shader.uniform.specular, 1);

        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, normalMap);
        gl.uniform1i(shader.uniform.normalMap, 2);

        gl.enableVertexAttribArray(shader.attribute.position);
        gl.enableVertexAttribArray(shader.attribute.texture);
        gl.enableVertexAttribArray(shader.attribute.normal);
        gl.enableVertexAttribArray(shader.attribute.tangent);

        for (var i = 0; i < this.meshCount; ++i) {
            this.models[i].draw(gl, shader);
        }
    };

    Renderer.prototype.addMesh = function(gl) {
        if (this.meshCount == 200)
            return;
        this.meshCount++;
        meshNumber.innerHTML = this.meshCount;
    }

    Renderer.prototype.removeMesh = function(gl) {
        if (this.meshCount == 1)
            return;
        this.meshCount--;
        meshNumber.innerHTML = this.meshCount;
    }

    Renderer.prototype.allocateMeshes = function(gl, count) {
        var self = this;
        var model = new MD5.Md5Mesh(meshIndex++);
        if (autoAdjust && useSimd)
            model.simd = true;
        model.load(gl, 'models/md5/monsters/hellknight/hellknight.md5mesh', function(mesh) {
            var x = 0;
            var y = 0;
            if (self.models.length != 0) {
                x = 0 - Math.random() * 400;
                y = 200 - Math.random() * 400;
            }
            mesh.pos = vec3.create([x, y, 0.0]);
            self.models.push(mesh);

            createVertexBuffer(gl,self.models.length);

            if (self.models.length == 1) {
                var loading = document.getElementById('loading');
                loading.style.visibility = 'hidden';
            }

            //meshNumber.innerHTML = self.models.length;

            var currentFrame = Math.round(Math.random() * 120);
            var anim = new MD5.Md5Anim(currentFrame);
            anim.load('models/md5/monsters/hellknight/idle2.md5anim', function(anim) {
                model.setAnimation(anim);
                self.animations.push(anim);
                if (self.models.length == count) {
                    // start
                    self.addMesh(gl);
                    return;
                }
                var func = self.allocateMeshes.bind(self, gl, count);
                setTimeout(func, 0);
            });
        });
    };

    Renderer.prototype.destoryMesh = function(gl) {
        if (this.models.length == 1) {
            //console.log('Only 1 model');
            return;
        }
        meshIndex--;
        this.animations.pop();
        this.models.pop();
        createVertexBuffer(gl, this.models.length);
        //meshNumber.innerHTML = this.models.length;
    }

    // Setup the canvas and GL context, initialize the scene 
    var canvas = document.getElementById("webgl-canvas");
    var contextHelper = new GLContextHelper(canvas, document.getElementById("content"));
    var renderer = new Renderer(contextHelper.gl, canvas);

    var stats = new Stats();
    document.getElementById("fpsMeter").appendChild(stats.domElement);

    var addBtn = document.getElementById("addBtn");
    if (addBtn) {
      addBtn.addEventListener("click", function () {
        renderer.addMesh(contextHelper.gl);
      });
    }

    var removeBtn = document.getElementById("removeBtn");
    if (removeBtn) {
      removeBtn.addEventListener("click", function () {
        renderer.removeMesh(contextHelper.gl);
      });
    }

    var simdBtn = document.getElementById("simdBtn");
    if (typeof SIMD === "undefined") {
        alert('SIMD not implemented in this browser. SIMD speedup button is disabled');
        simdBtn.disabled = true;
        simdBtn.classList.add("btn-disable");
    }
    var useSimd = false;

    var simdInfo = document.getElementById("info");
    simdBtn.addEventListener("click", function() {
        if (!useSimd) {
            useSimd = true;
            adjuster.reset(parseInt(targetFps.value));
            simdBtn.innerHTML = "Don't use SIMD";
            info.innerHTML = 'SIMD';
        } else {
            useSimd = false;
            adjuster.reset(parseInt(targetFps.value));
            simdBtn.innerHTML = 'Use SIMD';
            info.innerHTML = 'No SIMD';
        }
        MD5.setSIMD(useSimd);
    });

    var adjuster = MeshAdjuster(renderer, contextHelper.gl, stats);

    var autoBtn = document.getElementById("autoBtn");
    var autoBtnLabel = document.getElementById("autoBtnLable");
    var autoAdjust = false;
    if (addBtn) addBtn.disabled = false;
    if (removeBtn) removeBtn.disabled = false;

    autoBtn.addEventListener("click", function() {
        if (!autoAdjust) {
            autoAdjust = true;
            if (addBtn) {
                addBtn.disabled = true;
                addBtn.classList.add("btn-disable");
            }
            if (removeBtn) {
                removeBtn.disabled = true;
                removeBtn.classList.add("btn-disable");
            }
            adjuster.reset(parseInt(targetFps.value));
            adjuster.start();
            autoBtnLabel.innerHTML = 'Stop';
        } else {
            autoAdjust = false;
            if (addBtn) {
                addBtn.disabled = false;
                addBtn.classList.remove("btn-disable");
            }
            if (removeBtn) {
                removeBtn.disabled = false;
                removeBtn.classList.remove("btn-disable");
            }
            adjuster.stop();
            autoBtnLabel.innerHTML = 'Start';
        }
    });

    var targetFps = document.getElementById("targetFpsInput");

    targetFps.addEventListener("click", function(event) {
        event.stopPropagation();
    });

    targetFps.addEventListener("change", function() {
        //console.log(parseInt(targetFps.value));
        adjuster.reset(parseInt(targetFps.value));
    })
    
    // Get the render loop going
    contextHelper.start(renderer, stats);
});

var MeshAdjuster = function (renderer, gl, stats) {
    var renderer = renderer;
    var gl = gl;
    var stats = stats;
    var targetFps = 60.0;
    var max = renderer.meshCount;
    var min = renderer.meshCount;
    var handle = null;
    var marginFpsDec1 = 5.0;
    var marginFpsDec5 = 10.0;
    var marginFpsInc1 = 2.0;
    var marginFpsInc5 = 1.0;
    var reset = function(fps) {
        //console.log(fps);
        targetFps = fps;
    };

    function addMeshCount(count) {
      for (var i = 0; i < count; ++i) {
        renderer.addMesh(gl)
      }
    }

    function removeMeshCount(count) {
      for (var i = 0; i < count; ++i) {
        renderer.removeMesh(gl)
      }
    }

    var start = function() {
        handle = setInterval(function() {
            var fps = stats.getFps();
            if (fps >= targetFps - marginFpsInc5) {
              addMeshCount(5);
            }
            else if (fps >= targetFps - marginFpsInc1) {
              addMeshCount(1);
            }
            else if (fps < targetFps - marginFpsDec5) {
              removeMeshCount(5);
            }
            else if (fps < targetFps - marginFpsDec1) {
              renderer.removeMesh(gl);
            }
        }, 1000);
    }

    var stop = function() {
        clearInterval(handle);
    }

    return {
        start: start,
        stop: stop,
        reset: reset
    };
}
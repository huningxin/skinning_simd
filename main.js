require.config({
    baseUrl: "js"
});

require([
    "util/gl-context-helper",
    "util/camera",
    "util/gl-util",
    "md5",
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

    var Renderer = function (gl, canvas) {
        this.camera = new Camera.OrbitCamera(canvas);
        this.camera.setCenter([0, 0, 64]);
        this.camera.orbit(-Math.PI * 0.5, 0);
        this.camera.setDistance(390);
        this.camera.minDistance = 32;
        
        this.projectionMat = mat4.create();
        this.modelViewInvMat = mat3.create();
        
        gl.clearColor(0.0, 0.0, 0.1, 1.0);
        gl.clearDepth(1.0);
        gl.enable(gl.DEPTH_TEST);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        
        this.animations = [];
        this.meshShader = GLUtil.createProgram(gl, meshVS, meshFS);
        this.models = [];
        this.isLoading = false;
        this.addMesh(gl);
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

        for (var i = 0; i < this.models.length; ++i) {
            this.models[i].draw(gl, shader);
        }
    };

    Renderer.prototype.addMesh = function(gl) {
        var self = this;
        var model = new MD5.Md5Mesh();
        model.load(gl, 'models/md5/monsters/hellknight/hellknight.md5mesh', function(mesh) {
            var x = 0;
            var y = 0;
            if (self.models.length != 0) {
                x = 200 - Math.random() * 400;
                y = 200 - Math.random() * 400;
            }
            mesh.pos = vec3.create([x, y, 0.0]);
            self.models.push(mesh);

            if (self.models.length == 1) {
                var loading = document.getElementById('loading');
                loading.style.visibility = 'hidden';
            }

            meshNumber.innerHTML = self.models.length;

            var anim = new MD5.Md5Anim();
            anim.load('models/md5/monsters/hellknight/idle2.md5anim', function(anim) {
                var currentFrame = Math.round(Math.random() * 120);
                var interval = 1000 / anim.frameRate;

                var handle = setInterval(function() {
                    currentFrame++;
                    model.setAnimationFrame(gl, anim, currentFrame);
                }, interval);

                self.animations.push({anim: anim, handle: handle});
            });
        });
    };

    Renderer.prototype.removeMesh = function() {
        if (this.models.length == 1) {
            //console.log('Only 1 model');
            return;
        }
        var anim = this.animations.pop();
        clearInterval(anim.handle);
        this.models.pop();
        meshNumber.innerHTML = this.models.length;
    }

    // Setup the canvas and GL context, initialize the scene 
    var canvas = document.getElementById("webgl-canvas");
    var contextHelper = new GLContextHelper(canvas, document.getElementById("content"));
    var renderer = new Renderer(contextHelper.gl, canvas);

    var stats = new Stats();
    document.getElementById("content").appendChild(stats.domElement);

    var addBtn = document.getElementById("addBtn");
    addBtn.addEventListener("click", function() {
        renderer.addMesh(contextHelper.gl);
    });

    var removeBtn = document.getElementById("removeBtn");
    removeBtn.addEventListener("click", function() {
        renderer.removeMesh();
    });

    var meshNumber = document.getElementById("meshes");

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

    var adjuster = new MeshAdjuster(renderer, contextHelper.gl, stats);

    var autoBtn = document.getElementById("autoBtn");
    var autoBtnLabel = document.getElementById("autoBtnLable");
    var autoAdjust = false;
    addBtn.disabled = false;
    removeBtn.disabled = false;

    autoBtn.addEventListener("click", function() {
        if (!autoAdjust) {
            autoAdjust = true;
            addBtn.disabled = true;
            addBtn.classList.add("btn-disable");
            removeBtn.disabled = true;
            removeBtn.classList.add("btn-disable");
            adjuster.reset(parseInt(targetFps.value));
            adjuster.start();
            autoBtnLabel.innerHTML = 'Stop';
        } else {
            autoAdjust = false;
            addBtn.disabled = false;
            addBtn.classList.remove("btn-disable");
            removeBtn.disabled = false;
            removeBtn.classList.remove("btn-disable");
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
    var meetTarget = 0;
    var missTarget = 0;
    var unstable = 0;
    var meetNumber = 1;
    var missNumber = 3;
    var max = renderer.models.length;
    var min = renderer.models.length;
    var handle = null;

    var reset = function(fps) {
        //console.log(fps);
        targetFps = fps;
        meetTarget = 0;
        missTarget = 0;
        meetNumber = 1;
        missNumber = 1;
        max = renderer.models.length;
        min = renderer.models.length;
    };

    var start = function() {
        handle = setInterval(function() {
            if (unstable > 0) {
                unstable--;
                return;
            }
            var fps = stats.getFps();
            if (fps >= targetFps) {
                meetTarget++;
                if (missTarget > 0)
                    missTarget--;
            } else {
                missTarget++;
                if (meetTarget > 0)
                    meetTarget--;
            }

            //console.log(fps, targetFps, renderer.models.length, min, max, meetTarget, meetNumber, missTarget, missNumber);

            if (max < renderer.models.length) {
                //console.log('reset meetNumber.');
                max = renderer.models.length;
                meetNumber = 1;
            }

            if (min > renderer.models.length) {
                //console.log('reset missNumber.');
                min = renderer.models.length;
                missNumber = 1;
            }

            if (meetTarget >= meetNumber && missTarget == 0) {
                renderer.addMesh(gl);
                meetNumber+=1;
                //console.log('addMesh');
                meetTarget = 0;
            }

            if (missTarget >= missNumber && meetTarget == 0) {
                renderer.removeMesh();
                unstable = 1;
                missNumber+=1;
                //console.log('removeMesh');
                missTarget = 0;
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
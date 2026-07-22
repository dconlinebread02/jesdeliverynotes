/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';

interface SilkProps {
  speed?: number;
  scale?: number;
  color?: string;
  noiseIntensity?: number;
  rotation?: number;
}

export function Silk({
  speed = 5,
  scale = 1,
  color = "#A855F7",
  noiseIntensity = 1.5,
  rotation = -28
}: SilkProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Try to get WebGL context
    const gl = (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) {
      console.warn('WebGL not supported, falling back to 2D context');
      return;
    }

    let animationId: number;
    let startTime = Date.now();

    // Vertex Shader Source
    const vsSource = `
      attribute vec2 position;
      varying vec2 vUv;
      void main() {
        vUv = position * 0.5 + 0.5;
        gl_Position = vec4(position, 0.0, 1.0);
      }
    `;

    // Fragment Shader Source
    const fsSource = `
      precision mediump float;
      varying vec2 vUv;
      
      uniform vec2 u_resolution;
      uniform float u_time;
      uniform vec3 u_color;
      uniform float u_noiseIntensity;
      uniform float u_speed;
      uniform float u_scale;
      uniform float u_rotation;

      // Pseudo-random generator for noise and grain
      float hash(vec2 p) {
        p = fract(p * vec2(123.4, 234.5));
        p += dot(p, p + 34.33);
        return fract(p.x * p.y);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        
        float a = hash(i + vec2(0.0, 0.0));
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }

      // Fractional Brownian Motion
      float fbm(vec2 p) {
        float value = 0.0;
        float amplitude = 0.5;
        for (int i = 0; i < 3; i++) {
          value += amplitude * noise(p);
          p *= 2.0;
          amplitude *= 0.5;
        }
        return value;
      }

      float getHeight(vec2 uv) {
        float t = u_time * u_speed * 0.03;
        
        // Dynamic rotation from prop
        float angle = u_rotation * 3.14159265 / 180.0;
        mat2 rot = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
        vec2 rp = rot * (uv - 0.5);
        
        // Scale coordinate space
        rp *= u_scale * 2.2;
        
        // Domain warping with fBm for rich organic satin flows
        vec2 warp = vec2(
          fbm(rp * 1.8 + vec2(t * 0.3, t * 0.2)),
          fbm(rp * 1.8 - vec2(t * 0.25, t * 0.35))
        );
        
        rp += warp * 0.42;
        
        // Primary diagonal rolling waves
        float w = sin(rp.y * 3.2 - t * 0.7);
        // Secondary delicate fabric folds
        w += sin(rp.y * 6.5 + t * 1.1) * 0.18;
        w += cos(rp.x * 1.8 + rp.y * 3.6) * 0.12;
        
        return w * 0.5 + 0.5;
      }

      void main() {
        vec2 uv = gl_FragCoord.xy / u_resolution.xy;
        
        // Numerical derivative calculation for normals
        vec2 eps = vec2(0.003, 0.0);
        float h = getHeight(uv);
        float hx = getHeight(uv + eps.xy) - h;
        float hy = getHeight(uv + eps.yx) - h;
        
        // High steepness modifier driven by noiseIntensity
        vec3 normal = normalize(vec3(-hx * u_noiseIntensity * 32.0, -hy * u_noiseIntensity * 32.0, 1.0));
        
        // Realistic studio lighting direction
        vec3 lightDir = normalize(vec3(0.35, 0.55, 0.75));
        float diff = dot(normal, lightDir);
        diff = diff * 0.5 + 0.5; // Half-Lambert shading
        
        // Specular satin reflections (essential for silk material look)
        vec3 viewDir = vec3(0.0, 0.0, 1.0);
        vec3 reflectDir = reflect(-lightDir, normal);
        float spec = pow(max(dot(viewDir, reflectDir), 0.0), 16.0);
        
        // Beautiful rich silk color gradients
        vec3 colDeep = vec3(0.04, 0.01, 0.11);       // Rich dark shadow valleys
        vec3 colMid = u_color * 0.62;                 // Core royal fabric color
        vec3 colHighlight = mix(u_color, vec3(1.0), 0.5); // Lavender/soft magenta highlights
        
        // Gradient color blending
        vec3 color = mix(colDeep, colMid, diff);
        color += colHighlight * spec * 0.42;
        
        // Elegant rim lighting along fold edges
        float rim = 1.0 - max(dot(normal, viewDir), 0.0);
        rim = pow(rim, 3.0);
        color += colHighlight * rim * 0.14 * diff;
        
        // Monochromatic textile noise (matching the texture grain from the image)
        float grain = hash(vUv * 1450.0 + fract(u_time * 0.002)) * 0.085;
        color += vec3(grain - 0.0425);
        
        gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
      }
    `;

    // Helper to compile shaders
    const compileShader = (source: string, type: number) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compile error:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const vs = compileShader(vsSource, gl.VERTEX_SHADER);
    const fs = compileShader(fsSource, gl.FRAGMENT_SHADER);
    if (!vs || !fs) return;

    // Create shader program
    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(program));
      return;
    }

    gl.useProgram(program);

    // Uniform locations
    const uResolutionLoc = gl.getUniformLocation(program, 'u_resolution');
    const uTimeLoc = gl.getUniformLocation(program, 'u_time');
    const uColorLoc = gl.getUniformLocation(program, 'u_color');
    const uNoiseIntensityLoc = gl.getUniformLocation(program, 'u_noiseIntensity');
    const uSpeedLoc = gl.getUniformLocation(program, 'u_speed');
    const uScaleLoc = gl.getUniformLocation(program, 'u_scale');
    const uRotationLoc = gl.getUniformLocation(program, 'u_rotation');

    // Quad Vertices Buffer
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    const vertices = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
      -1,  1,
       1, -1,
       1,  1,
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    const positionAttributeLocation = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(positionAttributeLocation);
    gl.vertexAttribPointer(positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);

    const resizeCanvas = () => {
      const parent = canvas.parentElement;
      const width = parent ? parent.clientWidth : window.innerWidth;
      const height = parent ? parent.clientHeight : window.innerHeight;
      
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    };

    resizeCanvas();

    // Set up ResizeObserver to handle full screen scale changes gracefully
    let resizeObserver: ResizeObserver | null = null;
    if (canvas.parentElement) {
      resizeObserver = new ResizeObserver(() => {
        resizeCanvas();
      });
      resizeObserver.observe(canvas.parentElement);
    }

    // Convert hex color to normalized RGB
    const hexToRgbNormalized = (hex: string): [number, number, number] => {
      const cleanHex = hex.replace('#', '');
      const num = parseInt(cleanHex, 16);
      if (!isNaN(num)) {
        const r = ((num >> 16) & 255) / 255;
        const g = ((num >> 8) & 255) / 255;
        const b = (num & 255) / 255;
        return [r, g, b];
      }
      return [168 / 255, 85 / 255, 247 / 255]; // default purple
    };

    const rgb = hexToRgbNormalized(color);

    // Render loop
    const render = () => {
      const elapsed = (Date.now() - startTime) / 1000;

      gl.clearColor(0.0, 0.0, 0.0, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      // Pass uniforms
      gl.uniform2f(uResolutionLoc, canvas.width, canvas.height);
      gl.uniform1f(uTimeLoc, elapsed);
      gl.uniform3f(uColorLoc, rgb[0], rgb[1], rgb[2]);
      gl.uniform1f(uNoiseIntensityLoc, noiseIntensity);
      gl.uniform1f(uSpeedLoc, speed);
      gl.uniform1f(uScaleLoc, scale);
      gl.uniform1f(uRotationLoc, rotation);

      gl.drawArrays(gl.TRIANGLES, 0, 6);

      animationId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationId);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      // Clean up buffers and program
      gl.deleteBuffer(positionBuffer);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteProgram(program);
    };
  }, [speed, scale, color, noiseIntensity, rotation]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full block z-0"
    />
  );
}

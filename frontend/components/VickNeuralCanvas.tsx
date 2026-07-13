"use client";

import { useEffect, useRef } from "react";

type VickNeuralCanvasProps = {
  speaking: boolean;
  thinking: boolean;
};

const vertexShaderSource = `
  attribute vec2 a_position;
  varying vec2 v_uv;

  void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

const fragmentShaderSource = `
  precision highp float;

  uniform sampler2D u_idle;
  uniform sampler2D u_speaking;
  uniform float u_time;
  uniform float u_mix;
  uniform float u_energy;
  uniform vec2 u_resolution;
  varying vec2 v_uv;

  float hash(vec2 point) {
    point = fract(point * vec2(123.34, 456.21));
    point += dot(point, point + 45.32);
    return fract(point.x * point.y);
  }

  float noise(vec2 point) {
    vec2 cell = floor(point);
    vec2 local = fract(point);
    local = local * local * (3.0 - 2.0 * local);
    return mix(
      mix(hash(cell), hash(cell + vec2(1.0, 0.0)), local.x),
      mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0)), local.x),
      local.y
    );
  }

  vec3 sourceAt(vec2 uv) {
    vec3 idle = texture2D(u_idle, uv).rgb;
    vec3 speaking = texture2D(u_speaking, uv).rgb;
    return mix(idle, speaking, u_mix);
  }

  float luminance(vec3 color) {
    return dot(color, vec3(0.2126, 0.7152, 0.0722));
  }

  float filamentMask(vec3 color) {
    float bright = luminance(color);
    float highest = max(color.r, max(color.g, color.b));
    float lowest = min(color.r, min(color.g, color.b));
    float chroma = highest - lowest;
    return smoothstep(0.12, 0.58, bright) * smoothstep(0.035, 0.24, chroma + bright * 0.34);
  }

  void main() {
    vec2 uv = v_uv;
    vec3 original = sourceAt(uv);
    float originalLight = luminance(original);
    float branches = filamentMask(original);

    // O deslocamento atua somente nos filamentos luminosos da fotografia.
    float slowFlow = noise(uv * 7.0 + vec2(u_time * 0.17, -u_time * 0.13));
    float fineFlow = noise(uv.yx * 16.0 + vec2(-u_time * 0.31, u_time * 0.22));
    vec2 direction = vec2(slowFlow - 0.5, fineFlow - 0.5);
    float displacementStrength = (0.0025 + u_energy * 0.0022) * branches;
    vec2 liveUv = clamp(uv + direction * displacementStrength, vec2(0.002), vec2(0.998));
    vec3 liveImage = sourceAt(liveUv);
    float liveLight = luminance(liveImage);
    float liveBranches = filamentMask(liveImage);

    // Faixas estreitas percorrem as ramificações existentes como corrente elétrica.
    float routeNoise = noise(uv * 13.0 + vec2(u_time * 0.08, 0.0));
    float currentA = pow(0.5 + 0.5 * sin(uv.x * 92.0 + uv.y * 31.0 + routeNoise * 18.0 - u_time * (4.2 + u_energy)), 14.0);
    float currentB = pow(0.5 + 0.5 * sin(uv.y * 108.0 - uv.x * 27.0 + routeNoise * 13.0 - u_time * (5.1 + u_energy * 1.4)), 18.0);
    float currentC = pow(0.5 + 0.5 * sin((uv.x + uv.y) * 76.0 + routeNoise * 22.0 + u_time * 3.7), 20.0);
    float movingCurrent = max(currentA, max(currentB, currentC)) * liveBranches;

    // Cintilação irregular preserva a geometria original, sem desenhar novas linhas.
    float flickerCell = hash(floor(uv * 42.0) + floor(u_time * vec2(7.0, 9.0)));
    float electricalFlicker = mix(0.72, 1.28, flickerCell) * (0.72 + 0.28 * noise(uv * 28.0 + u_time));

    // Bloom amostrado da própria textura faz as sinapses originais respirarem.
    vec2 pixel = 1.0 / u_resolution;
    float nearbyLight = 0.0;
    nearbyLight += luminance(sourceAt(clamp(liveUv + vec2(pixel.x * 3.0, 0.0), vec2(0.0), vec2(1.0))));
    nearbyLight += luminance(sourceAt(clamp(liveUv - vec2(pixel.x * 3.0, 0.0), vec2(0.0), vec2(1.0))));
    nearbyLight += luminance(sourceAt(clamp(liveUv + vec2(0.0, pixel.y * 3.0), vec2(0.0), vec2(1.0))));
    nearbyLight += luminance(sourceAt(clamp(liveUv - vec2(0.0, pixel.y * 3.0), vec2(0.0), vec2(1.0))));
    nearbyLight *= 0.25;
    float synapse = smoothstep(0.48, 0.9, max(liveLight, nearbyLight));
    float synapseRhythm = 0.5 + 0.5 * sin(u_time * (2.4 + u_energy) + noise(uv * 19.0) * 18.0);
    float synapsePulse = synapse * pow(synapseRhythm, 5.0);

    float branchBreath = 0.5 + 0.5 * sin(u_time * 1.35 + noise(uv * 9.0) * 10.0);
    float activation = liveBranches * (0.08 + branchBreath * 0.14 * u_energy);
    activation += movingCurrent * electricalFlicker * (0.72 + u_energy * 0.48);

    vec3 electricColor = normalize(liveImage + vec3(0.025));
    vec3 alive = liveImage * (1.0 + activation);
    alive += electricColor * movingCurrent * (0.22 + u_energy * 0.12);
    alive += electricColor * synapsePulse * (0.2 + u_energy * 0.1);

    // O fundo escuro permanece estável; só a rede luminosa recebe movimento.
    float protectedBackground = smoothstep(0.02, 0.18, originalLight);
    vec3 finalColor = mix(original, alive, max(liveBranches, protectedBackground * movingCurrent));

    // Fundo escuro da foto vira transparente; so a rede luminosa fica visivel.
    float outLum = luminance(finalColor);
    float alpha = smoothstep(0.02, 0.16, outLum);
    gl_FragColor = vec4(finalColor, alpha);
  }
`;

function compileShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Não foi possível criar o shader da Vick.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const reason = gl.getShaderInfoLog(shader) ?? "erro desconhecido";
    gl.deleteShader(shader);
    throw new Error(`Falha ao compilar shader da Vick: ${reason}`);
  }
  return shader;
}

function createProgram(gl: WebGLRenderingContext) {
  const program = gl.createProgram();
  if (!program) throw new Error("Não foi possível criar o programa WebGL da Vick.");
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const reason = gl.getProgramInfoLog(program) ?? "erro desconhecido";
    gl.deleteProgram(program);
    throw new Error(`Falha ao vincular shader da Vick: ${reason}`);
  }
  return program;
}

function loadTexture(gl: WebGLRenderingContext, source: string) {
  return new Promise<WebGLTexture>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => {
      const texture = gl.createTexture();
      if (!texture) {
        reject(new Error("Não foi possível criar a textura da Vick."));
        return;
      }
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      resolve(texture);
    };
    image.onerror = () => reject(new Error(`Falha ao carregar textura: ${source}`));
    image.src = source;
  });
}

export default function VickNeuralCanvas({ speaking, thinking }: VickNeuralCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef({ speaking, thinking });
  stateRef.current = { speaking, thinking };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
    });
    if (!gl) return undefined;

    let disposed = false;
    let animationFrame = 0;
    let blend = stateRef.current.speaking ? 1 : 0;
    let previousTime = performance.now();
    let lastReducedState = "";
    let loadedTextures: WebGLTexture[] = [];
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const program = createProgram(gl);
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const timeLocation = gl.getUniformLocation(program, "u_time");
    const mixLocation = gl.getUniformLocation(program, "u_mix");
    const energyLocation = gl.getUniformLocation(program, "u_energy");
    const resolutionLocation = gl.getUniformLocation(program, "u_resolution");
    const idleLocation = gl.getUniformLocation(program, "u_idle");
    const speakingLocation = gl.getUniformLocation(program, "u_speaking");

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(bounds.width * ratio));
      const height = Math.max(1, Math.round(bounds.height * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    void Promise.all([
      loadTexture(gl, "/vick-neural-idle.png"),
      loadTexture(gl, "/vick-neural-speaking.png"),
    ]).then(([idleTexture, speakingTexture]) => {
      if (disposed) {
        gl.deleteTexture(idleTexture);
        gl.deleteTexture(speakingTexture);
        return;
      }
      loadedTextures = [idleTexture, speakingTexture];

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, idleTexture);
      gl.uniform1i(idleLocation, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, speakingTexture);
      gl.uniform1i(speakingLocation, 1);

      const render = (time: number) => {
        if (disposed) return;
        const delta = Math.min(50, time - previousTime);
        previousTime = time;
        const state = stateRef.current;
        const reduced = reducedMotion.matches;
        const target = state.speaking ? 1 : 0;
        if (reduced) {
          blend = target;
          const reducedState = `${state.speaking}-${state.thinking}-${canvas.width}-${canvas.height}`;
          if (lastReducedState === reducedState) {
            animationFrame = window.requestAnimationFrame(render);
            return;
          }
          lastReducedState = reducedState;
        } else {
          blend += (target - blend) * (1 - Math.exp(-delta / 420));
        }

        const energy = reduced ? 0 : state.speaking ? 1.45 : state.thinking ? 1.2 : 0.78;
        gl.uniform1f(timeLocation, reduced ? 0 : time * 0.001);
        gl.uniform1f(mixLocation, blend);
        gl.uniform1f(energyLocation, energy);
        gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        animationFrame = window.requestAnimationFrame(render);
      };

      animationFrame = window.requestAnimationFrame(render);
    }).catch(() => {
      canvas.classList.add("unavailable");
    });

    return () => {
      disposed = true;
      observer.disconnect();
      window.cancelAnimationFrame(animationFrame);
      loadedTextures.forEach((texture) => gl.deleteTexture(texture));
      loadedTextures = [];
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    };
  }, []);

  return <canvas className="vick-neural-canvas" ref={canvasRef} />;
}

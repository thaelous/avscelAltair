/**
 * WebGL/WebGL2 Hardware-Accelerated Video Shader Engine
 * Procesa filtros y transiciones a 60 FPS en GPU sin CPU-bound bottlenecks.
 */

export interface ShaderUniforms {
  time: number;
  brightness: number; // 0.5 - 1.7 (1.0 = normal)
  contrast: number;   // 0.5 - 1.7 (1.0 = normal)
  fxWave: boolean;
  waveAmp: number;
  fxFisheye: boolean;
  fisheyeStrength: number;
  fxSepia: boolean;
  sepiaVal: number;
  fxGlitch: boolean;
  glitchShift: number;
  fxPixelate: boolean;
  pixelSize: number;
  fxBw: boolean;
  fxInvert: boolean;
  fxVignette: boolean;
  transType: number;     // 0: none, 1: fade-black, 2: flash, 3: wipe, 4: crossfade
  transProgress: number; // 0.0 - 1.0
}

const VERTEX_SHADER_SRC = `
attribute vec2 a_position;
attribute vec2 a_texCoord;
varying vec2 v_texCoord;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord;
}
`;

const FRAGMENT_SHADER_SRC = `
precision mediump float;
uniform sampler2D u_image;
uniform vec2 u_resolution;
uniform float u_time;

uniform float u_brightness;
uniform float u_contrast;

uniform int u_fxWave;
uniform float u_waveAmp;

uniform int u_fxFisheye;
uniform float u_fisheyeStrength;

uniform int u_fxSepia;
uniform float u_sepiaVal;

uniform int u_fxGlitch;
uniform float u_glitchShift;

uniform int u_fxPixelate;
uniform float u_pixelSize;

uniform int u_fxBw;
uniform int u_fxInvert;
uniform int u_fxVignette;

uniform int u_transType;
uniform float u_transProgress;

varying vec2 v_texCoord;

void main() {
  vec2 uv = v_texCoord;

  // 1. Pixelado GPU
  if (u_fxPixelate == 1 && u_pixelSize > 1.0) {
    vec2 pSize = vec2(u_pixelSize / u_resolution.x, u_pixelSize / u_resolution.y);
    uv = floor(uv / pSize) * pSize;
  }

  // 2. Efecto Onda (Wave) GPU
  if (u_fxWave == 1) {
    float shift = sin(uv.y * 32.0 + u_time * 6.0) * (u_waveAmp / u_resolution.x);
    uv.x += shift;
  }

  // 3. Ojo de Pez (Fisheye Polar) GPU
  if (u_fxFisheye == 1) {
    vec2 p = uv - vec2(0.5, 0.5);
    float r = length(p) * 2.0;
    if (r < 1.0) {
      float theta = atan(p.y, p.x);
      float nr = pow(r, u_fisheyeStrength) * 0.5;
      uv = vec2(0.5) + vec2(nr * cos(theta), nr * sin(theta));
    }
  }

  uv = clamp(uv, 0.0, 1.0);

  // 4. Glitch VHS (Desfase de canales cromáticos)
  vec4 color;
  if (u_fxGlitch == 1) {
    float shift = u_glitchShift / u_resolution.x;
    float r = texture2D(u_image, clamp(vec2(uv.x + shift, uv.y), 0.0, 1.0)).r;
    float g = texture2D(u_image, uv).g;
    float b = texture2D(u_image, clamp(vec2(uv.x - shift, uv.y), 0.0, 1.0)).b;
    color = vec4(r, g, b, 1.0);
  } else {
    color = texture2D(u_image, uv);
  }

  // Ajustes de Contraste y Brillo
  color.rgb = (color.rgb - 0.5) * u_contrast + 0.5;
  color.rgb *= u_brightness;

  // 5. Sepia Vintage en GPU
  if (u_fxSepia == 1) {
    vec3 sepiaColor;
    sepiaColor.r = dot(color.rgb, vec3(0.393, 0.769, 0.189));
    sepiaColor.g = dot(color.rgb, vec3(0.349, 0.686, 0.168));
    sepiaColor.b = dot(color.rgb, vec3(0.272, 0.534, 0.131));
    color.rgb = mix(color.rgb, sepiaColor, u_sepiaVal);
  }

  // 6. Blanco y Negro Cine en GPU
  if (u_fxBw == 1) {
    float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    color.rgb = vec3(gray);
  }

  // 7. Inversión en GPU
  if (u_fxInvert == 1) {
    color.rgb = 1.0 - color.rgb;
  }

  // 8. Viñeta en GPU
  if (u_fxVignette == 1) {
    float dist = distance(uv, vec2(0.5, 0.5));
    float vig = smoothstep(0.72, 0.28, dist);
    color.rgb *= vig;
  }

  // 9. Transiciones de corte en GPU
  if (u_transType == 1) { // Fundido a Negro (Fade to Black)
    float alpha = u_transProgress < 0.5 ? u_transProgress * 2.0 : (1.0 - u_transProgress) * 2.0;
    color.rgb = mix(color.rgb, vec3(0.0), clamp(alpha, 0.0, 1.0));
  } else if (u_transType == 2) { // Destello Blanco (Flash)
    float alpha = u_transProgress < 0.5 ? u_transProgress * 2.0 : (1.0 - u_transProgress) * 2.0;
    color.rgb = mix(color.rgb, vec3(1.0), clamp(alpha * 0.95, 0.0, 1.0));
  } else if (u_transType == 3) { // Cortinilla (Wipe)
    float wipeEdge = u_transProgress;
    if (uv.x < wipeEdge) {
      color.rgb = mix(color.rgb, vec3(0.0, 0.94, 1.0), 0.22);
    }
    if (abs(uv.x - wipeEdge) < 0.005) {
      color.rgb = vec3(0.0, 0.94, 1.0);
    }
  } else if (u_transType == 4) { // Desvanecimiento / Crossfade suave
    float alpha = u_transProgress < 0.5 ? u_transProgress * 1.5 : (1.0 - u_transProgress) * 1.5;
    color.rgb = mix(color.rgb, vec3(0.04, 0.06, 0.1), clamp(alpha * 0.75, 0.0, 1.0));
  }

  gl_FragColor = color;
}
`;

export class WebGLVideoRenderer {
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private texture: WebGLTexture | null = null;
  private positionBuffer: WebGLBuffer | null = null;
  private texCoordBuffer: WebGLBuffer | null = null;

  // Uniform locations cache
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  public isReady: boolean = false;

  constructor(canvas: HTMLCanvasElement) {
    this.init(canvas);
  }

  private init(canvas: HTMLCanvasElement) {
    const gl =
      canvas.getContext('webgl2', { preserveDrawingBuffer: true, alpha: false }) ||
      canvas.getContext('webgl', { preserveDrawingBuffer: true, alpha: false });

    if (!gl) {
      console.warn('WebGL no disponible en este dispositivo. Fallback activo.');
      return;
    }

    this.gl = gl as WebGLRenderingContext;

    const vertShader = this.compileShader(this.gl.VERTEX_SHADER, VERTEX_SHADER_SRC);
    const fragShader = this.compileShader(this.gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SRC);

    if (!vertShader || !fragShader) return;

    const program = this.gl.createProgram();
    if (!program) return;

    this.gl.attachShader(program, vertShader);
    this.gl.attachShader(program, fragShader);
    this.gl.linkProgram(program);

    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      console.error('Error enlazando WebGL program:', this.gl.getProgramInfoLog(program));
      return;
    }

    this.program = program;
    this.gl.useProgram(program);

    // Configurar geometría de cuadrilátero a pantalla completa
    // TRIANGLE_STRIP: top-left, bottom-left, top-right, bottom-right
    const positions = new Float32Array([
      -1,  1,
      -1, -1,
       1,  1,
       1, -1,
    ]);

    const texCoords = new Float32Array([
      0, 0,
      0, 1,
      1, 0,
      1, 1,
    ]);

    const posAttr = this.gl.getAttribLocation(program, 'a_position');
    this.positionBuffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, positions, this.gl.STATIC_DRAW);
    this.gl.enableVertexAttribArray(posAttr);
    this.gl.vertexAttribPointer(posAttr, 2, this.gl.FLOAT, false, 0, 0);

    const texAttr = this.gl.getAttribLocation(program, 'a_texCoord');
    this.texCoordBuffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.texCoordBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, texCoords, this.gl.STATIC_DRAW);
    this.gl.enableVertexAttribArray(texAttr);
    this.gl.vertexAttribPointer(texAttr, 2, this.gl.FLOAT, false, 0, 0);

    // Configurar textura de video
    this.texture = this.gl.createTexture();
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);

    // Cachear ubicaciones de uniforms
    const uniformNames = [
      'u_image', 'u_resolution', 'u_time',
      'u_brightness', 'u_contrast',
      'u_fxWave', 'u_waveAmp',
      'u_fxFisheye', 'u_fisheyeStrength',
      'u_fxSepia', 'u_sepiaVal',
      'u_fxGlitch', 'u_glitchShift',
      'u_fxPixelate', 'u_pixelSize',
      'u_fxBw', 'u_fxInvert', 'u_fxVignette',
      'u_transType', 'u_transProgress'
    ];

    uniformNames.forEach((name) => {
      this.uniforms[name] = this.gl!.getUniformLocation(program, name);
    });

    this.isReady = true;
  }

  private compileShader(type: number, src: string): WebGLShader | null {
    if (!this.gl) return null;
    const shader = this.gl.createShader(type);
    if (!shader) return null;

    this.gl.shaderSource(shader, src);
    this.gl.compileShader(shader);

    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      console.error('Error compilando shader:', this.gl.getShaderInfoLog(shader));
      this.gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  public render(
    source: HTMLVideoElement | HTMLCanvasElement,
    width: number,
    height: number,
    uniforms: ShaderUniforms
  ): boolean {
    if (!this.gl || !this.program || !this.texture || !this.isReady) return false;

    const gl = this.gl;
    gl.viewport(0, 0, width, height);
    gl.useProgram(this.program);

    // Subir fotograma actual de video/canvas directamente a la textura de GPU
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

    // Asignar uniforms
    gl.uniform1i(this.uniforms['u_image'], 0);
    gl.uniform2f(this.uniforms['u_resolution'], width, height);
    gl.uniform1f(this.uniforms['u_time'], uniforms.time);

    gl.uniform1f(this.uniforms['u_brightness'], uniforms.brightness);
    gl.uniform1f(this.uniforms['u_contrast'], uniforms.contrast);

    gl.uniform1i(this.uniforms['u_fxWave'], uniforms.fxWave ? 1 : 0);
    gl.uniform1f(this.uniforms['u_waveAmp'], uniforms.waveAmp);

    gl.uniform1i(this.uniforms['u_fxFisheye'], uniforms.fxFisheye ? 1 : 0);
    gl.uniform1f(this.uniforms['u_fisheyeStrength'], uniforms.fisheyeStrength);

    gl.uniform1i(this.uniforms['u_fxSepia'], uniforms.fxSepia ? 1 : 0);
    gl.uniform1f(this.uniforms['u_sepiaVal'], uniforms.sepiaVal);

    gl.uniform1i(this.uniforms['u_fxGlitch'], uniforms.fxGlitch ? 1 : 0);
    gl.uniform1f(this.uniforms['u_glitchShift'], uniforms.glitchShift);

    gl.uniform1i(this.uniforms['u_fxPixelate'], uniforms.fxPixelate ? 1 : 0);
    gl.uniform1f(this.uniforms['u_pixelSize'], uniforms.pixelSize);

    gl.uniform1i(this.uniforms['u_fxBw'], uniforms.fxBw ? 1 : 0);
    gl.uniform1i(this.uniforms['u_fxInvert'], uniforms.fxInvert ? 1 : 0);
    gl.uniform1i(this.uniforms['u_fxVignette'], uniforms.fxVignette ? 1 : 0);

    gl.uniform1i(this.uniforms['u_transType'], uniforms.transType);
    gl.uniform1f(this.uniforms['u_transProgress'], uniforms.transProgress);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return true;
  }

  public destroy() {
    if (!this.gl) return;
    if (this.texture) this.gl.deleteTexture(this.texture);
    if (this.positionBuffer) this.gl.deleteBuffer(this.positionBuffer);
    if (this.texCoordBuffer) this.gl.deleteBuffer(this.texCoordBuffer);
    if (this.program) this.gl.deleteProgram(this.program);
    this.isReady = false;
  }
}
